use std::sync::mpsc;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use windows_capture::capture::{
    Context, GraphicsCaptureApiHandler,
};
use windows_capture::frame::Frame;
use windows_capture::graphics_capture_api::InternalCaptureControl;
use windows_capture::monitor::Monitor;
use windows_capture::settings::{
    ColorFormat, CursorCaptureSettings, DirtyRegionSettings, DrawBorderSettings,
    MinimumUpdateIntervalSettings, SecondaryWindowSettings, Settings,
};
use windows_capture::window::Window;

use crate::error::EngineError;

/// A captured frame with its raw pixel data and metadata.
pub struct CapturedFrame {
    pub data: Vec<u8>,
    pub width: u32,
    pub height: u32,
    /// Timestamp in 100-nanosecond units.
    pub timestamp: i64,
}

/// Configuration for screen capture.
pub struct CaptureConfig {
    pub target: CaptureTarget,
    pub show_cursor: bool,
    pub show_border: bool,
}

/// What to capture.
#[derive(Clone, Debug)]
pub enum CaptureTarget {
    PrimaryDisplay,
    Display(usize),
    Window(isize),
}

/// Handle to stop an active capture session.
pub struct StopHandle {
    stop_flag: Arc<AtomicBool>,
}

impl StopHandle {
    pub fn stop(&self) {
        self.stop_flag.store(true, Ordering::Relaxed);
    }
}

/// Info about a display monitor.
#[derive(Debug, Clone)]
pub struct DisplayInfo {
    pub index: usize,
    pub name: String,
    pub width: u32,
    pub height: u32,
}

/// Info about a capturable window.
#[derive(Debug, Clone)]
pub struct WindowInfo {
    pub handle: isize,
    pub title: String,
    pub process_name: String,
}

/// List all available displays.
pub fn list_displays() -> Result<Vec<DisplayInfo>, EngineError> {
    let monitors = Monitor::enumerate().map_err(|e| EngineError::Capture(e.to_string()))?;
    let mut result = Vec::new();
    for monitor in monitors {
        let index = monitor.index().unwrap_or(0);
        let name = monitor.name().unwrap_or_default();
        let width = monitor.width().unwrap_or(0);
        let height = monitor.height().unwrap_or(0);
        result.push(DisplayInfo {
            index,
            name,
            width,
            height,
        });
    }
    Ok(result)
}

/// List all capturable windows.
pub fn list_windows() -> Result<Vec<WindowInfo>, EngineError> {
    let windows = Window::enumerate().map_err(|e| EngineError::Capture(e.to_string()))?;
    let mut result = Vec::new();
    for window in windows {
        if !window.is_valid() {
            continue;
        }
        let handle = window.as_raw_hwnd() as isize;
        let title = window.title().unwrap_or_default();
        let process_name = window.process_name().unwrap_or_default();
        result.push(WindowInfo {
            handle,
            title,
            process_name,
        });
    }
    Ok(result)
}

struct CaptureHandler {
    tx: mpsc::SyncSender<CapturedFrame>,
    stop_flag: Arc<AtomicBool>,
}

struct CaptureFlags {
    tx: mpsc::SyncSender<CapturedFrame>,
    stop_flag: Arc<AtomicBool>,
}

impl GraphicsCaptureApiHandler for CaptureHandler {
    type Flags = CaptureFlags;
    type Error = Box<dyn std::error::Error + Send + Sync>;

    fn new(ctx: Context<Self::Flags>) -> Result<Self, Self::Error> {
        Ok(Self {
            tx: ctx.flags.tx,
            stop_flag: ctx.flags.stop_flag,
        })
    }

    fn on_frame_arrived(
        &mut self,
        frame: &mut Frame,
        capture_control: InternalCaptureControl,
    ) -> Result<(), Self::Error> {
        if self.stop_flag.load(Ordering::Relaxed) {
            capture_control.stop();
            return Ok(());
        }

        let width = frame.width();
        let height = frame.height();
        let ts = frame.timestamp();
        let timestamp = ts.Duration;

        let mut buffer = frame.buffer().map_err(|e| e.to_string())?;
        let data = buffer.as_raw_buffer().to_vec();

        let captured = CapturedFrame {
            data,
            width,
            height,
            timestamp,
        };

        // Non-blocking send — drop frame if consumer is slow.
        let _ = self.tx.try_send(captured);

        Ok(())
    }

    fn on_closed(&mut self) -> Result<(), Self::Error> {
        Ok(())
    }
}

fn make_settings<T: windows_capture::settings::TryIntoCaptureItemWithType>(
    item: T,
    cursor: CursorCaptureSettings,
    border: DrawBorderSettings,
    flags: CaptureFlags,
) -> Settings<CaptureFlags, T> {
    Settings::new(
        item,
        cursor,
        border,
        SecondaryWindowSettings::Default,
        MinimumUpdateIntervalSettings::Default,
        DirtyRegionSettings::Default,
        ColorFormat::Bgra8,
        flags,
    )
}

/// Start capturing and return a receiver for frames plus a stop handle.
pub fn start_capture(
    config: CaptureConfig,
) -> Result<(mpsc::Receiver<CapturedFrame>, StopHandle), EngineError> {
    let (tx, rx) = mpsc::sync_channel::<CapturedFrame>(2);
    let stop_flag = Arc::new(AtomicBool::new(false));

    let cursor = if config.show_cursor {
        CursorCaptureSettings::WithCursor
    } else {
        CursorCaptureSettings::WithoutCursor
    };

    let border = if config.show_border {
        DrawBorderSettings::WithBorder
    } else {
        DrawBorderSettings::WithoutBorder
    };

    let flags = CaptureFlags {
        tx,
        stop_flag: stop_flag.clone(),
    };

    match config.target {
        CaptureTarget::PrimaryDisplay => {
            let monitor = Monitor::primary()
                .map_err(|e| EngineError::Capture(e.to_string()))?;
            let settings = make_settings(monitor, cursor, border, flags);
            let _control = CaptureHandler::start_free_threaded(settings)
                .map_err(|e| EngineError::Capture(e.to_string()))?;
        }
        CaptureTarget::Display(index) => {
            let monitor = Monitor::from_index(index)
                .map_err(|e| EngineError::Capture(e.to_string()))?;
            let settings = make_settings(monitor, cursor, border, flags);
            let _control = CaptureHandler::start_free_threaded(settings)
                .map_err(|e| EngineError::Capture(e.to_string()))?;
        }
        CaptureTarget::Window(hwnd) => {
            let window = Window::from_raw_hwnd(hwnd as *mut _);
            let settings = make_settings(window, cursor, border, flags);
            let _control = CaptureHandler::start_free_threaded(settings)
                .map_err(|e| EngineError::Capture(e.to_string()))?;
        }
    }

    let handle = StopHandle { stop_flag };
    Ok((rx, handle))
}
