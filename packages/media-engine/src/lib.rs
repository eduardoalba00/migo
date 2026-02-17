pub mod capture;
pub mod encode;
pub mod engine;
pub mod error;
pub mod gpu;
pub mod transport;

use std::sync::Mutex;

use napi::bindgen_prelude::*;
use napi::threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode};
use napi_derive::napi;

use capture::audio::AudioMode;
use capture::wgc::CaptureTarget;
use engine::{EngineCallbacks, EngineStats, MediaEngine, ScreenShareConfig};

pub const VERSION: &str = env!("CARGO_PKG_VERSION");

/// Global engine instance (single screen share at a time).
static ENGINE: Mutex<Option<MediaEngine>> = Mutex::new(None);

#[napi]
pub fn version() -> String {
    VERSION.to_string()
}

// ── Display / Window enumeration ──

#[napi(object)]
pub struct JsDisplayInfo {
    pub index: u32,
    pub name: String,
    pub width: u32,
    pub height: u32,
}

#[napi(object)]
pub struct JsWindowInfo {
    pub handle: i64,
    pub title: String,
    pub process_name: String,
}

#[napi]
pub fn list_displays() -> Result<Vec<JsDisplayInfo>> {
    let displays = capture::wgc::list_displays()
        .map_err(|e| Error::from_reason(e.to_string()))?;
    Ok(displays
        .into_iter()
        .map(|d| JsDisplayInfo {
            index: d.index as u32,
            name: d.name,
            width: d.width,
            height: d.height,
        })
        .collect())
}

#[napi]
pub fn list_windows() -> Result<Vec<JsWindowInfo>> {
    let windows = capture::wgc::list_windows()
        .map_err(|e| Error::from_reason(e.to_string()))?;
    Ok(windows
        .into_iter()
        .map(|w| JsWindowInfo {
            handle: w.handle as i64,
            title: w.title,
            process_name: w.process_name,
        })
        .collect())
}

// ── Screen share config ──

#[napi(object)]
pub struct JsScreenShareConfig {
    /// LiveKit server URL (e.g., "ws://localhost:7880").
    pub server_url: String,
    /// LiveKit access token.
    pub token: String,
    /// Capture target type: "primary", "display", or "window".
    pub target_type: String,
    /// Display index (for target_type "display") or window handle (for "window").
    pub target_id: Option<i64>,
    /// Target FPS.
    pub fps: u32,
    /// Target bitrate in bits/sec.
    pub bitrate: u32,
    /// Whether to show cursor in capture.
    pub show_cursor: bool,
    /// Whether to capture system audio.
    pub capture_audio: bool,
    /// Audio mode: "system" or process PID (number as string).
    pub audio_mode: Option<String>,
}

#[napi(object)]
#[derive(Clone)]
pub struct JsEngineStats {
    pub fps: f64,
    pub encode_ms: f64,
    pub bitrate_mbps: f64,
    pub frames_encoded: u32,
    pub bytes_sent: u32,
}

impl From<EngineStats> for JsEngineStats {
    fn from(s: EngineStats) -> Self {
        Self {
            fps: s.fps,
            encode_ms: s.encode_ms,
            bitrate_mbps: s.bitrate_mbps,
            frames_encoded: s.frames_encoded as u32,
            bytes_sent: s.bytes_sent as u32,
        }
    }
}

fn parse_config(config: JsScreenShareConfig) -> Result<ScreenShareConfig> {
    let target = match config.target_type.as_str() {
        "primary" => CaptureTarget::PrimaryDisplay,
        "display" => {
            let idx = config
                .target_id
                .ok_or_else(|| Error::from_reason("target_id required for display target"))?;
            CaptureTarget::Display(idx as usize)
        }
        "window" => {
            let hwnd = config
                .target_id
                .ok_or_else(|| Error::from_reason("target_id required for window target"))?;
            CaptureTarget::Window(hwnd as isize)
        }
        other => return Err(Error::from_reason(format!("Unknown target_type: {other}"))),
    };

    let audio_mode = match config.audio_mode.as_deref() {
        Some("system") | None => AudioMode::System,
        Some(pid_str) => {
            let pid: u32 = pid_str
                .parse()
                .map_err(|_| Error::from_reason(format!("Invalid audio_mode PID: {pid_str}")))?;
            AudioMode::Process(pid)
        }
    };

    Ok(ScreenShareConfig {
        server_url: config.server_url,
        token: config.token,
        target,
        fps: config.fps,
        bitrate: config.bitrate,
        show_cursor: config.show_cursor,
        capture_audio: config.capture_audio,
        audio_mode,
    })
}

// ── Start / Stop / Force keyframe ──

#[napi]
pub async fn start_screen_share(
    config: JsScreenShareConfig,
    on_error: ThreadsafeFunction<String>,
    on_stopped: ThreadsafeFunction<()>,
    on_stats: ThreadsafeFunction<JsEngineStats>,
) -> Result<()> {
    // Check if already running
    {
        let guard = ENGINE.lock().unwrap();
        if let Some(ref e) = *guard {
            if e.is_running() {
                return Err(Error::from_reason("Screen share already running"));
            }
        }
    }

    let screen_config = parse_config(config)?;

    let callbacks = EngineCallbacks {
        on_error: Some(Box::new(move |msg| {
            on_error.call(Ok(msg), ThreadsafeFunctionCallMode::NonBlocking);
        })),
        on_stopped: Some(Box::new(move || {
            on_stopped.call(Ok(()), ThreadsafeFunctionCallMode::NonBlocking);
        })),
        on_stats: Some(Box::new(move |stats| {
            on_stats.call(Ok(stats.into()), ThreadsafeFunctionCallMode::NonBlocking);
        })),
    };

    let engine = MediaEngine::start_screen_share(screen_config, callbacks)
        .await
        .map_err(|e| Error::from_reason(e.to_string()))?;

    let mut guard = ENGINE.lock().unwrap();
    *guard = Some(engine);

    Ok(())
}

#[napi]
pub fn stop_screen_share() -> Result<()> {
    let guard = ENGINE.lock().unwrap();
    match guard.as_ref() {
        Some(e) => {
            e.stop();
            Ok(())
        }
        None => Err(Error::from_reason("No screen share running")),
    }
}

#[napi]
pub fn force_keyframe() -> Result<()> {
    let guard = ENGINE.lock().unwrap();
    match guard.as_ref() {
        Some(e) => e
            .force_keyframe()
            .map_err(|e| Error::from_reason(e.to_string())),
        None => Err(Error::from_reason("No screen share running")),
    }
}

#[napi]
pub fn is_screen_share_running() -> bool {
    let guard = ENGINE.lock().unwrap();
    guard.as_ref().map_or(false, |e| e.is_running())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_version() {
        assert_eq!(version(), "0.1.0");
    }
}
