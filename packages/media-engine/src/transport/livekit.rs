use std::net::UdpSocket;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use str0m::change::{SdpAnswer, SdpOffer, SdpPendingOffer};
use str0m::format::Codec;
use str0m::media::{Direction, MediaKind, MediaTime, Mid};
use str0m::media::Frequency;
use str0m::net::{Protocol, Receive};
use str0m::{Candidate, Event, IceConnectionState, Input, Output, Rtc, RtcConfig};
use tokio::sync::mpsc;

use super::signal::{self, SignalEvent, SignalSender};
use crate::error::EngineError;

/// Configuration for the LiveKit transport.
#[derive(Clone, Debug)]
pub struct TransportConfig {
    pub server_url: String,
    pub token: String,
    pub width: u32,
    pub height: u32,
    pub fps: u32,
}

/// Commands sent from the main thread to the transport thread.
pub enum TransportCommand {
    /// Send an H.264 encoded video frame.
    VideoFrame {
        data: Vec<u8>,
        timestamp_90khz: u32,
        keyframe: bool,
    },
    /// Send Opus-encoded audio (or raw PCM to be forwarded).
    AudioFrame {
        data: Vec<u8>,
        timestamp_48khz: u32,
    },
    /// Force a keyframe on the next frame.
    ForceKeyframe,
    /// Disconnect and stop.
    Stop,
}

/// Handle to the running LiveKit transport.
pub struct LiveKitTransport {
    cmd_tx: mpsc::UnboundedSender<TransportCommand>,
    stop_flag: Arc<AtomicBool>,
}

impl LiveKitTransport {
    /// Connect to LiveKit and start the transport.
    /// Returns a handle for sending media and a receiver for events.
    pub async fn connect(
        config: TransportConfig,
    ) -> Result<Self, EngineError> {
        let stop_flag = Arc::new(AtomicBool::new(false));
        let (cmd_tx, cmd_rx) = mpsc::unbounded_channel();

        // Connect to LiveKit signaling
        let (signal_sender, signal_rx) = signal::connect(&config.server_url, &config.token).await?;

        let stop_clone = stop_flag.clone();

        // Spawn the transport thread (std::thread for str0m's sync polling)
        let rt = tokio::runtime::Handle::current();
        std::thread::spawn(move || {
            transport_thread(config, signal_sender, signal_rx, cmd_rx, stop_clone, rt);
        });

        Ok(Self { cmd_tx, stop_flag })
    }

    /// Send an H.264 encoded video frame.
    pub fn send_video(&self, data: Vec<u8>, timestamp_90khz: u32, keyframe: bool) {
        let _ = self.cmd_tx.send(TransportCommand::VideoFrame {
            data,
            timestamp_90khz,
            keyframe,
        });
    }

    /// Send audio data.
    pub fn send_audio(&self, data: Vec<u8>, timestamp_48khz: u32) {
        let _ = self.cmd_tx.send(TransportCommand::AudioFrame {
            data,
            timestamp_48khz,
        });
    }

    /// Stop the transport.
    pub fn stop(&self) {
        self.stop_flag.store(true, Ordering::Relaxed);
        let _ = self.cmd_tx.send(TransportCommand::Stop);
    }

    pub fn is_running(&self) -> bool {
        !self.stop_flag.load(Ordering::Relaxed)
    }

    /// Clone the transport handle for use in another thread (e.g., audio).
    pub fn clone_sender(&self) -> Self {
        Self {
            cmd_tx: self.cmd_tx.clone(),
            stop_flag: self.stop_flag.clone(),
        }
    }
}

/// ICE candidate JSON format matching WebRTC RTCIceCandidateInit.
#[derive(serde::Serialize, serde::Deserialize)]
struct IceCandidateInit {
    candidate: String,
    #[serde(rename = "sdpMid")]
    sdp_mid: Option<String>,
    #[serde(rename = "sdpMLineIndex")]
    sdp_m_line_index: Option<u32>,
    #[serde(rename = "usernameFragment")]
    username_fragment: Option<String>,
}

fn transport_thread(
    config: TransportConfig,
    signal: SignalSender,
    mut signal_rx: mpsc::UnboundedReceiver<SignalEvent>,
    mut cmd_rx: mpsc::UnboundedReceiver<TransportCommand>,
    stop_flag: Arc<AtomicBool>,
    rt: tokio::runtime::Handle,
) {
    // Wait for Join response first
    let join = rt.block_on(async {
        loop {
            match signal_rx.recv().await {
                Some(SignalEvent::Join(j)) => return Ok(j),
                Some(_) => continue,
                None => return Err(EngineError::Transport("Signal closed before join".into())),
            }
        }
    });
    let join = match join {
        Ok(j) => j,
        Err(e) => {
            tracing::error!("Join failed: {e}");
            return;
        }
    };

    eprintln!(
        "[transport] Joined room: {:?}, participant: {:?}",
        join.room.as_ref().map(|r| &r.name),
        join.participant.as_ref().map(|p| &p.identity),
    );

    // Build str0m RTC instance for the publisher peer connection
    let mut rtc = RtcConfig::new()
        .enable_h264(true)
        .enable_opus(true)
        .build(Instant::now());

    // Bind UDP socket to a real local IP (not 0.0.0.0 which str0m rejects)
    let socket = UdpSocket::bind("0.0.0.0:0").expect("Bind UDP");
    socket
        .set_nonblocking(true)
        .expect("Set socket nonblocking");

    // Resolve local IP for ICE candidate
    let local_port = socket.local_addr().expect("Local addr").port();
    let local_ip = get_local_ip().unwrap_or(std::net::IpAddr::V4(std::net::Ipv4Addr::LOCALHOST));
    let local_addr = std::net::SocketAddr::new(local_ip, local_port);

    // Add local ICE candidate
    let candidate = Candidate::host(local_addr, "udp").expect("Host candidate");
    rtc.add_local_candidate(candidate);

    // Request to publish video track
    let video_cid = format!("video-{}", uuid_simple());
    signal.send_add_track(
        video_cid.clone(),
        "screenshare".to_string(),
        1, // TrackType::Video
        3, // TrackSource::ScreenShare
        config.width,
        config.height,
    );

    // Add video media and create SDP offer
    let mut sdp = rtc.sdp_api();
    let video_mid = sdp.add_media(
        MediaKind::Video,
        Direction::SendOnly,
        Some("screen".into()),
        Some(video_cid.clone()),
        None,
    );

    let (offer, pending) = match sdp.apply() {
        Some(v) => v,
        None => {
            tracing::error!("No SDP changes to apply");
            return;
        }
    };

    // Send publisher offer
    let offer_sdp = offer.to_sdp_string();
    signal.send_offer(offer_sdp);

    // Send local ICE candidate to LiveKit
    let candidate_str = format!("candidate:1 1 udp 2130706431 {} {} typ host", local_addr.ip(), local_addr.port());
    let init = IceCandidateInit {
        candidate: candidate_str,
        sdp_mid: Some("0".to_string()),
        sdp_m_line_index: Some(0),
        username_fragment: None,
    };
    if let Ok(json) = serde_json::to_string(&init) {
        signal.send_trickle(json, 0); // Publisher target
    }

    // Main event loop
    let mut pending_offer: Option<SdpPendingOffer> = Some(pending);
    let mut connected = false;
    let mut buf = vec![0u8; 2000];
    let mut transport_stats_timer = Instant::now();
    let mut frames_sent = 0u64;
    let mut frames_dropped = 0u64;

    loop {
        if stop_flag.load(Ordering::Relaxed) {
            signal.send_leave();
            break;
        }

        // Process signal events (non-blocking)
        while let Ok(event) = signal_rx.try_recv() {
            match event {
                SignalEvent::Answer(answer) => {
                    if let Some(p) = pending_offer.take() {
                        match SdpAnswer::from_sdp_string(&answer.sdp) {
                            Ok(sdp_answer) => {
                                if let Err(e) = rtc.sdp_api().accept_answer(p, sdp_answer) {
                                    tracing::error!("Accept answer failed: {e}");
                                }
                            }
                            Err(e) => tracing::error!("Parse SDP answer: {e}"),
                        }
                    }
                }
                SignalEvent::Trickle(trickle) => {
                    // Only handle publisher ICE candidates (target=0)
                    if trickle.target == 0 {
                        if let Ok(init) = serde_json::from_str::<IceCandidateInit>(&trickle.candidate_init) {
                            if let Ok(c) = Candidate::from_sdp_string(&init.candidate) {
                                rtc.add_remote_candidate(c);
                            }
                        }
                    }
                }
                SignalEvent::Offer(offer) => {
                    // Subscriber offer — accept it to keep LiveKit happy
                    if let Ok(sdp_offer) = SdpOffer::from_sdp_string(&offer.sdp) {
                        match rtc.sdp_api().accept_offer(sdp_offer) {
                            Ok(answer) => {
                                signal.send_answer(answer.to_sdp_string());
                            }
                            Err(e) => tracing::error!("Accept subscriber offer: {e}"),
                        }
                    }
                }
                SignalEvent::TrackPublished(pub_resp) => {
                    tracing::info!(
                        "Track published: cid={}, sid={:?}",
                        pub_resp.cid,
                        pub_resp.track.as_ref().map(|t| &t.sid),
                    );
                }
                SignalEvent::Leave => {
                    tracing::info!("Server requested leave");
                    stop_flag.store(true, Ordering::Relaxed);
                    break;
                }
                _ => {}
            }
        }

        // Process transport commands (non-blocking, limit batch size to avoid stalling)
        let mut cmds_processed = 0;
        while let Ok(cmd) = cmd_rx.try_recv() {
            match cmd {
                TransportCommand::VideoFrame { data, timestamp_90khz, .. } => {
                    if connected {
                        send_video_frame(&mut rtc, video_mid, &data, timestamp_90khz);
                        frames_sent += 1;
                    } else {
                        frames_dropped += 1;
                    }
                }
                TransportCommand::AudioFrame { .. } => {
                    // Audio sending will be added when we have an audio mid
                }
                TransportCommand::ForceKeyframe => {
                    // Handled by the encoder, not the transport
                }
                TransportCommand::Stop => {
                    signal.send_leave();
                    stop_flag.store(true, Ordering::Relaxed);
                    break;
                }
            }
            cmds_processed += 1;
            if cmds_processed > 5 {
                break; // Don't process too many at once, let str0m send
            }
        }

        // Print transport status every 5 seconds
        if transport_stats_timer.elapsed() >= Duration::from_secs(5) {
            eprintln!(
                "[transport] connected={}, frames_sent={}, frames_dropped={}, pending_offer={}",
                connected, frames_sent, frames_dropped, pending_offer.is_some()
            );
            transport_stats_timer = Instant::now();
        }

        // Drive str0m — process outputs (limit iterations to prevent spin)
        let mut poll_iters = 0;
        let timeout = loop {
            poll_iters += 1;
            if poll_iters > 1000 {
                // Safety valve: don't spin indefinitely
                break Instant::now() + Duration::from_millis(1);
            }
            match rtc.poll_output() {
                Ok(Output::Timeout(t)) => break t,
                Ok(Output::Transmit(t)) => {
                    let _ = socket.send_to(&t.contents, t.destination);
                }
                Ok(Output::Event(e)) => match e {
                    Event::IceConnectionStateChange(state) => {
                        eprintln!("[transport] ICE state: {:?}", state);
                        match state {
                            IceConnectionState::Connected => { connected = true; }
                            IceConnectionState::Disconnected => {
                                connected = false;
                                stop_flag.store(true, Ordering::Relaxed);
                            }
                            _ => {}
                        }
                    }
                    Event::KeyframeRequest(req) => {
                        tracing::debug!("Keyframe requested for mid={:?}", req.mid);
                        // Will be forwarded to encoder via callback
                    }
                    _ => {}
                },
                Err(e) => {
                    tracing::error!("str0m error: {e}");
                    stop_flag.store(true, Ordering::Relaxed);
                    break Instant::now();
                }
            }
        };

        // Wait for network or timeout
        let wait = timeout
            .checked_duration_since(Instant::now())
            .unwrap_or(Duration::ZERO)
            .min(Duration::from_millis(5)); // Poll at least every 5ms for commands

        if !wait.is_zero() {
            std::thread::sleep(wait);
        }

        // Read incoming UDP packets
        buf.resize(2000, 0);
        loop {
            match socket.recv_from(&mut buf) {
                Ok((n, source)) => {
                    let data = &buf[..n];
                    if let Ok(contents) = data.try_into() {
                        let receive = Receive {
                            proto: Protocol::Udp,
                            source,
                            destination: local_addr,
                            contents,
                        };
                        if let Err(e) = rtc.handle_input(Input::Receive(Instant::now(), receive)) {
                            tracing::error!("handle_input error: {e}");
                        }
                    }
                }
                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => break,
                Err(_) => break,
            }
        }

        // Advance time
        let _ = rtc.handle_input(Input::Timeout(Instant::now()));
    }
}

fn send_video_frame(rtc: &mut Rtc, mid: Mid, data: &[u8], timestamp_90khz: u32) {
    if let Some(writer) = rtc.writer(mid) {
        let pt = match writer.payload_params().find(|p| p.spec().codec == Codec::H264) {
            Some(p) => p.pt(),
            None => return,
        };
        let media_time = MediaTime::new(timestamp_90khz as u64, Frequency::NINETY_KHZ);
        if let Err(e) = writer.write(pt, Instant::now(), media_time, data.to_vec()) {
            tracing::error!("Write video frame: {e}");
        }
    }
}

/// Get the machine's local (non-loopback) IP by connecting a UDP socket.
fn get_local_ip() -> Option<std::net::IpAddr> {
    let socket = UdpSocket::bind("0.0.0.0:0").ok()?;
    // Connect to a public IP (doesn't actually send data)
    socket.connect("8.8.8.8:80").ok()?;
    Some(socket.local_addr().ok()?.ip())
}

/// Simple UUID generator (no external dep).
fn uuid_simple() -> String {
    use std::time::SystemTime;
    let t = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    format!("{t:032x}")
}
