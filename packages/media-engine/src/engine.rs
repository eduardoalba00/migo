use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use tokio::sync::mpsc;

use crate::capture::audio::{start_audio_capture, AudioCaptureConfig, AudioMode};
use crate::capture::wgc::{start_capture, CaptureConfig, CaptureTarget, CapturedFrame};
use crate::encode::config::EncoderConfig;
use crate::encode::pipeline::EncodePipeline;
use crate::error::EngineError;
use crate::transport::livekit::{LiveKitTransport, TransportConfig};

/// Configuration for starting a screen share.
#[derive(Clone, Debug)]
pub struct ScreenShareConfig {
    /// LiveKit server URL (e.g., "ws://localhost:7880").
    pub server_url: String,
    /// LiveKit access token.
    pub token: String,
    /// Capture target (display or window).
    pub target: CaptureTarget,
    /// Target FPS.
    pub fps: u32,
    /// Target bitrate in bits/sec.
    pub bitrate: u32,
    /// Whether to show the cursor in capture.
    pub show_cursor: bool,
    /// Whether to capture system audio.
    pub capture_audio: bool,
    /// Audio mode (system or process-specific).
    pub audio_mode: AudioMode,
}

/// Callbacks for engine events.
pub struct EngineCallbacks {
    pub on_error: Option<Box<dyn Fn(String) + Send + 'static>>,
    pub on_stopped: Option<Box<dyn Fn() + Send + 'static>>,
    pub on_stats: Option<Box<dyn Fn(EngineStats) + Send + 'static>>,
}

impl Default for EngineCallbacks {
    fn default() -> Self {
        Self {
            on_error: None,
            on_stopped: None,
            on_stats: None,
        }
    }
}

/// Live performance stats emitted periodically.
#[derive(Clone, Debug)]
pub struct EngineStats {
    pub fps: f64,
    pub encode_ms: f64,
    pub bitrate_mbps: f64,
    pub frames_encoded: u64,
    pub bytes_sent: u64,
}

/// Commands sent to the engine thread.
enum EngineCommand {
    ForceKeyframe,
    Stop,
}

/// Media engine that orchestrates capture, encode, and transport.
pub struct MediaEngine {
    cmd_tx: mpsc::UnboundedSender<EngineCommand>,
    stop_flag: Arc<AtomicBool>,
}

impl MediaEngine {
    /// Start a screen share session. Connects to LiveKit and begins
    /// capturing, encoding, and streaming.
    pub async fn start_screen_share(
        config: ScreenShareConfig,
        callbacks: EngineCallbacks,
    ) -> Result<Self, EngineError> {
        let stop_flag = Arc::new(AtomicBool::new(false));
        let (cmd_tx, cmd_rx) = mpsc::unbounded_channel();

        // Start capture
        let cap_config = CaptureConfig {
            target: config.target.clone(),
            show_cursor: config.show_cursor,
            show_border: false,
        };
        let (frame_rx, cap_stop) = start_capture(cap_config)?;

        // Wait for first frame to get dimensions
        let first_frame = frame_rx
            .recv_timeout(Duration::from_secs(5))
            .map_err(|_| EngineError::Capture("No frame received within 5s".into()))?;
        // NV12 format requires even dimensions — round up if the captured frame has odd size
        let width = (first_frame.width + 1) & !1;
        let height = (first_frame.height + 1) & !1;

        // Connect transport
        let transport_config = TransportConfig {
            server_url: config.server_url.clone(),
            token: config.token.clone(),
            width,
            height,
            fps: config.fps,
        };
        let transport = LiveKitTransport::connect(transport_config).await?;

        // Start audio capture if enabled
        let audio_stop = if config.capture_audio {
            let audio_config = AudioCaptureConfig {
                mode: config.audio_mode.clone(),
                sample_rate: 48000,
                channels: 2,
            };
            let (audio_rx, audio_stop) = start_audio_capture(audio_config)?;

            // Spawn audio forwarding thread
            let transport_ref = transport.clone_sender();
            let stop_clone = stop_flag.clone();
            std::thread::spawn(move || {
                audio_forward_thread(audio_rx, transport_ref, stop_clone);
            });

            Some(audio_stop)
        } else {
            None
        };

        // Spawn the main encode+publish thread
        let stop_clone = stop_flag.clone();
        std::thread::spawn(move || {
            encode_publish_thread(
                config,
                first_frame,
                frame_rx,
                transport,
                cmd_rx,
                stop_clone,
                callbacks,
                width,
                height,
            );

            // Cleanup
            cap_stop.stop();
            if let Some(a) = audio_stop {
                a.stop();
            }
        });

        Ok(Self { cmd_tx, stop_flag })
    }

    /// Force the encoder to produce a keyframe.
    pub fn force_keyframe(&self) -> Result<(), EngineError> {
        self.cmd_tx
            .send(EngineCommand::ForceKeyframe)
            .map_err(|_| EngineError::Encode("Engine thread stopped".into()))
    }

    /// Stop the screen share.
    pub fn stop(&self) {
        self.stop_flag.store(true, Ordering::Relaxed);
        let _ = self.cmd_tx.send(EngineCommand::Stop);
    }

    /// Check if the engine is still running.
    pub fn is_running(&self) -> bool {
        !self.stop_flag.load(Ordering::Relaxed)
    }
}

fn encode_publish_thread(
    config: ScreenShareConfig,
    first_frame: CapturedFrame,
    frame_rx: std::sync::mpsc::Receiver<CapturedFrame>,
    transport: LiveKitTransport,
    mut cmd_rx: mpsc::UnboundedReceiver<EngineCommand>,
    stop_flag: Arc<AtomicBool>,
    callbacks: EngineCallbacks,
    width: u32,
    height: u32,
) {
    // Create encoder
    let enc_config = EncoderConfig {
        width,
        height,
        fps: config.fps,
        bitrate: config.bitrate,
        prefer_hardware: true,
    };
    let mut pipeline = match EncodePipeline::new(enc_config) {
        Ok(p) => p,
        Err(e) => {
            if let Some(ref cb) = callbacks.on_error {
                cb(format!("Failed to create encoder: {e}"));
            }
            return;
        }
    };

    let mut total_frames = 0u64;
    let mut total_bytes = 0u64;
    let mut interval_frames = 0u64;
    let mut interval_bytes = 0u64;
    let mut stats_timer = Instant::now();
    let mut force_next_keyframe = false;

    // Helper to encode and send a frame
    let process_frame = |frame: &CapturedFrame,
                             pipeline: &mut EncodePipeline,
                             transport: &LiveKitTransport,
                             total_frames: &mut u64,
                             total_bytes: &mut u64,
                             interval_frames: &mut u64,
                             interval_bytes: &mut u64,
                             force_keyframe: &mut bool| {
        if *force_keyframe {
            let _ = pipeline.force_keyframe();
            *force_keyframe = false;
        }

        match pipeline.encode_frame(&frame.data, frame.width, frame.height, frame.row_pitch) {
            Ok(packets) => {
                for p in &packets {
                    let ts = (*total_frames as u32).wrapping_mul(90_000 / config.fps.max(1));
                    transport.send_video(p.data.clone(), ts, p.keyframe);
                    *total_bytes += p.data.len() as u64;
                    *interval_bytes += p.data.len() as u64;
                }
                *total_frames += 1;
                *interval_frames += 1;
            }
            Err(e) => {
                tracing::error!("Encode error: {e}");
            }
        }
    };

    // Frame rate limiter: only encode at the target FPS, drop excess frames
    let frame_interval = Duration::from_secs_f64(1.0 / config.fps.max(1) as f64);
    let mut last_encode_time = Instant::now();

    // Process first frame
    process_frame(
        &first_frame,
        &mut pipeline,
        &transport,
        &mut total_frames,
        &mut total_bytes,
        &mut interval_frames,
        &mut interval_bytes,
        &mut force_next_keyframe,
    );

    // Main loop
    loop {
        if stop_flag.load(Ordering::Relaxed) {
            break;
        }

        // Check commands (non-blocking)
        while let Ok(cmd) = cmd_rx.try_recv() {
            match cmd {
                EngineCommand::ForceKeyframe => force_next_keyframe = true,
                EngineCommand::Stop => {
                    stop_flag.store(true, Ordering::Relaxed);
                }
            }
        }

        if stop_flag.load(Ordering::Relaxed) {
            break;
        }

        // Wait until it's time for the next frame
        let elapsed = last_encode_time.elapsed();
        if elapsed < frame_interval {
            let remaining = frame_interval - elapsed;
            std::thread::sleep(remaining);
        }

        // Drain the capture channel, keeping only the most recent frame.
        // This prevents GPU-backed CapturedFrame objects from accumulating
        // in the channel while we sleep for rate limiting.
        let mut latest_frame = None;
        loop {
            match frame_rx.try_recv() {
                Ok(frame) => { latest_frame = Some(frame); }
                Err(std::sync::mpsc::TryRecvError::Empty) => break,
                Err(std::sync::mpsc::TryRecvError::Disconnected) => {
                    tracing::warn!("Capture channel disconnected");
                    stop_flag.store(true, Ordering::Relaxed);
                    break;
                }
            }
        }

        // If no frame was available, wait briefly for one
        if latest_frame.is_none() && !stop_flag.load(Ordering::Relaxed) {
            match frame_rx.recv_timeout(Duration::from_millis(100)) {
                Ok(frame) => { latest_frame = Some(frame); }
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => continue,
                Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                    tracing::warn!("Capture channel disconnected");
                    break;
                }
            }
        }

        if let Some(frame) = latest_frame {
            last_encode_time = Instant::now();
            process_frame(
                &frame,
                &mut pipeline,
                &transport,
                &mut total_frames,
                &mut total_bytes,
                &mut interval_frames,
                &mut interval_bytes,
                &mut force_next_keyframe,
            );
        }

        // Emit stats every second
        if stats_timer.elapsed() >= Duration::from_secs(1) {
            let elapsed = stats_timer.elapsed().as_secs_f64();
            if let Some(ref cb) = callbacks.on_stats {
                cb(EngineStats {
                    fps: interval_frames as f64 / elapsed,
                    encode_ms: 0.0,
                    bitrate_mbps: (interval_bytes as f64 * 8.0) / (elapsed * 1_000_000.0),
                    frames_encoded: total_frames,
                    bytes_sent: total_bytes,
                });
            }
            interval_frames = 0;
            interval_bytes = 0;
            stats_timer = Instant::now();
        }
    }

    // Flush encoder
    let _ = pipeline.flush();
    transport.stop();

    if let Some(ref cb) = callbacks.on_stopped {
        cb();
    }
}

fn audio_forward_thread(
    audio_rx: std::sync::mpsc::Receiver<crate::capture::audio::AudioPacket>,
    transport: LiveKitTransport,
    stop_flag: Arc<AtomicBool>,
) {
    let mut timestamp = 0u32;
    while !stop_flag.load(Ordering::Relaxed) {
        match audio_rx.recv_timeout(Duration::from_millis(100)) {
            Ok(packet) => {
                // Convert f32 samples to bytes for transport
                let bytes: Vec<u8> = packet
                    .data
                    .iter()
                    .flat_map(|s| s.to_le_bytes())
                    .collect();
                transport.send_audio(bytes, timestamp);
                timestamp = timestamp.wrapping_add(packet.frames as u32);
            }
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => continue,
            Err(_) => break,
        }
    }
}

