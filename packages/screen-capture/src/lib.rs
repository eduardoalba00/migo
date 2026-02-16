use napi::bindgen_prelude::*;
use napi_derive::napi;
use scap::{
    capturer::{Capturer, Options as CaptureOptions, Resolution},
    frame::Frame,
    Target,
};
use std::sync::{Arc, Mutex};
use std::thread;

#[napi(object)]
pub struct CaptureSource {
    pub id: String,
    pub name: String,
    pub is_screen: bool,
    pub thumbnail: Option<Buffer>,
    pub width: Option<u32>,
    pub height: Option<u32>,
}

#[napi]
pub fn list_sources() -> Vec<CaptureSource> {
    let targets = scap::get_all_targets();
    targets
        .into_iter()
        .enumerate()
        .map(|(idx, target)| match &target {
            Target::Display(display) => CaptureSource {
                id: format!("screen:{}", idx),
                name: format!("Screen {}", idx + 1),
                is_screen: true,
                thumbnail: None,
                width: Some(display.width as u32),
                height: Some(display.height as u32),
            },
            Target::Window(window) => CaptureSource {
                id: format!("window:{}", idx),
                name: window.title.clone(),
                is_screen: false,
                thumbnail: None,
                width: Some(window.width as u32),
                height: Some(window.height as u32),
            },
        })
        .collect()
}

struct CaptureState {
    latest_frame: Option<Vec<u8>>,
    width: u32,
    height: u32,
    running: bool,
}

#[napi]
pub struct NativeCapture {
    state: Arc<Mutex<CaptureState>>,
    source_id: String,
    target_width: u32,
    target_height: u32,
    fps: u32,
    capture_thread: Option<thread::JoinHandle<()>>,
}

#[napi]
impl NativeCapture {
    #[napi(constructor)]
    pub fn new(source_id: String, width: u32, height: u32, fps: u32) -> Self {
        Self {
            state: Arc::new(Mutex::new(CaptureState {
                latest_frame: None,
                width,
                height,
                running: false,
            })),
            source_id,
            target_width: width,
            target_height: height,
            fps,
            capture_thread: None,
        }
    }

    #[napi]
    pub fn start(&mut self) -> Result<()> {
        {
            let mut state = self.state.lock().unwrap();
            if state.running {
                return Err(Error::from_reason("Capture already running"));
            }
            state.running = true;
        }

        let targets = scap::get_all_targets();

        // Parse source_id to find the target
        let parts: Vec<&str> = self.source_id.split(':').collect();
        let idx: usize = parts
            .get(1)
            .and_then(|s| s.parse().ok())
            .ok_or_else(|| Error::from_reason("Invalid source_id format"))?;

        let target = targets
            .into_iter()
            .nth(idx)
            .ok_or_else(|| Error::from_reason("Source not found"))?;

        let resolution = match (self.target_width, self.target_height) {
            (w, h) if w <= 1920 && h <= 1080 => Resolution::_1080p,
            (w, h) if w <= 2560 && h <= 1440 => Resolution::_1440p,
            _ => Resolution::_2160p,
        };

        let options = CaptureOptions {
            fps: self.fps,
            target: Some(target),
            show_cursor: true,
            show_highlight: false,
            excluded_targets: None,
            output_type: scap::frame::FrameType::BGRAFrame,
            output_resolution: resolution,
            ..Default::default()
        };

        let state = Arc::clone(&self.state);

        let handle = thread::spawn(move || {
            let mut capturer = match Capturer::build(options) {
                Ok(c) => c,
                Err(e) => {
                    eprintln!("Failed to create capturer: {}", e);
                    let mut s = state.lock().unwrap();
                    s.running = false;
                    return;
                }
            };

            capturer.start_capture();

            loop {
                {
                    let s = state.lock().unwrap();
                    if !s.running {
                        break;
                    }
                }

                match capturer.get_next_frame() {
                    Ok(Frame::BGRA(bgra_frame)) => {
                        let mut s = state.lock().unwrap();
                        s.width = bgra_frame.width as u32;
                        s.height = bgra_frame.height as u32;
                        s.latest_frame = Some(bgra_frame.data);
                    }
                    Ok(_) => {
                        // Non-BGRA frame, skip
                    }
                    Err(e) => {
                        eprintln!("Frame capture error: {}", e);
                        break;
                    }
                }
            }

            capturer.stop_capture();
        });

        self.capture_thread = Some(handle);
        Ok(())
    }

    #[napi]
    pub fn get_frame(&self) -> Option<Buffer> {
        let mut state = self.state.lock().unwrap();
        state.latest_frame.take().map(|data| Buffer::from(data))
    }

    #[napi]
    pub fn stop(&mut self) {
        {
            let mut state = self.state.lock().unwrap();
            state.running = false;
        }
        if let Some(handle) = self.capture_thread.take() {
            let _ = handle.join();
        }
    }

    #[napi(getter)]
    pub fn width(&self) -> u32 {
        self.state.lock().unwrap().width
    }

    #[napi(getter)]
    pub fn height(&self) -> u32 {
        self.state.lock().unwrap().height
    }
}
