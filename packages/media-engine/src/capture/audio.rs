use std::sync::mpsc::{self, Receiver, SyncSender};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use wasapi::{AudioClient, DeviceEnumerator, Direction, SampleType, StreamMode, WaveFormat};

use crate::error::EngineError;

/// Audio mode — system loopback or process-specific.
#[derive(Clone, Debug)]
pub enum AudioMode {
    /// Capture all system audio output (loopback).
    System,
    /// Capture audio from a specific process.
    Process(u32),
}

/// Configuration for audio capture.
#[derive(Clone, Debug)]
pub struct AudioCaptureConfig {
    pub mode: AudioMode,
    pub sample_rate: u32,
    pub channels: u16,
}

impl Default for AudioCaptureConfig {
    fn default() -> Self {
        Self {
            mode: AudioMode::System,
            sample_rate: 48000,
            channels: 2,
        }
    }
}

/// A packet of captured audio data.
pub struct AudioPacket {
    /// Interleaved Float32 PCM samples.
    pub data: Vec<f32>,
    /// Number of frames (each frame = `channels` samples).
    pub frames: usize,
    /// Sample rate in Hz.
    pub sample_rate: u32,
    /// Number of channels.
    pub channels: u16,
}

/// Handle to stop audio capture.
pub struct AudioStopHandle {
    stop_flag: Arc<AtomicBool>,
}

impl AudioStopHandle {
    pub fn stop(&self) {
        self.stop_flag.store(true, Ordering::Relaxed);
    }
}

/// Start capturing audio. Returns a receiver for audio packets and a stop handle.
pub fn start_audio_capture(
    config: AudioCaptureConfig,
) -> Result<(Receiver<AudioPacket>, AudioStopHandle), EngineError> {
    let (tx, rx) = mpsc::sync_channel::<AudioPacket>(32);
    let stop_flag = Arc::new(AtomicBool::new(false));
    let stop_clone = stop_flag.clone();

    std::thread::spawn(move || {
        if let Err(e) = capture_thread(config, tx, stop_clone) {
            tracing::error!("Audio capture thread error: {e}");
        }
    });

    Ok((rx, AudioStopHandle { stop_flag }))
}

fn capture_thread(
    config: AudioCaptureConfig,
    tx: SyncSender<AudioPacket>,
    stop_flag: Arc<AtomicBool>,
) -> Result<(), EngineError> {
    wasapi::initialize_mta().ok()
        .map_err(|e| EngineError::Capture(format!("COM init: {e}")))?;

    let mut audio_client = match &config.mode {
        AudioMode::System => {
            let enumerator = DeviceEnumerator::new()
                .map_err(|e| EngineError::Capture(format!("device enumerator: {e}")))?;
            let device = enumerator.get_default_device(&Direction::Render)
                .map_err(|e| EngineError::Capture(format!("get default render device: {e}")))?;
            device.get_iaudioclient()
                .map_err(|e| EngineError::Capture(format!("get audio client: {e}")))?
        }
        AudioMode::Process(pid) => {
            AudioClient::new_application_loopback_client(*pid, true)
                .map_err(|e| EngineError::Capture(format!("process loopback client (pid={pid}): {e}")))?
        }
    };

    // Desired format: 48kHz stereo Float32
    let desired_format = WaveFormat::new(
        32,
        32,
        &SampleType::Float,
        config.sample_rate as usize,
        config.channels as usize,
        None,
    );

    // Use event-driven shared mode with autoconvert for format flexibility
    let stream_mode = StreamMode::EventsShared {
        autoconvert: true,
        buffer_duration_hns: 0, // Let the engine decide
    };

    audio_client
        .initialize_client(
            &desired_format,
            &Direction::Capture,
            &stream_mode,
        )
        .map_err(|e| EngineError::Capture(format!("initialize audio client: {e}")))?;

    let capture_client = audio_client.get_audiocaptureclient()
        .map_err(|e| EngineError::Capture(format!("get capture client: {e}")))?;

    let event_handle = audio_client.set_get_eventhandle()
        .map_err(|e| EngineError::Capture(format!("set event handle: {e}")))?;

    audio_client.start_stream()
        .map_err(|e| EngineError::Capture(format!("start stream: {e}")))?;

    let bytes_per_frame = config.channels as usize * 4; // Float32 = 4 bytes

    loop {
        if stop_flag.load(Ordering::Relaxed) {
            break;
        }

        // Wait for audio data (100ms timeout)
        if event_handle.wait_for_event(100).is_err() {
            continue;
        }

        // Read all available packets
        loop {
            let packet_size = match capture_client.get_next_packet_size() {
                Ok(Some(n)) if n > 0 => n as usize,
                Ok(_) => break,
                Err(_) => break,
            };

            let mut buffer = vec![0u8; packet_size * bytes_per_frame];
            match capture_client.read_from_device(&mut buffer) {
                Ok((frames, _info)) if frames > 0 => {
                    let actual_bytes = frames as usize * bytes_per_frame;
                    buffer.truncate(actual_bytes);

                    // Convert bytes to f32 samples
                    let samples: Vec<f32> = buffer
                        .chunks_exact(4)
                        .map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
                        .collect();

                    let packet = AudioPacket {
                        frames: frames as usize,
                        data: samples,
                        sample_rate: config.sample_rate,
                        channels: config.channels,
                    };

                    if tx.try_send(packet).is_err() {
                        if stop_flag.load(Ordering::Relaxed) {
                            break;
                        }
                    }
                }
                _ => break,
            }
        }
    }

    audio_client.stop_stream()
        .map_err(|e| EngineError::Capture(format!("stop stream: {e}")))?;

    Ok(())
}
