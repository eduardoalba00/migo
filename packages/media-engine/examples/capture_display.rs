use std::time::{Duration, Instant};

use media_engine::capture::wgc::{start_capture, CaptureConfig, CaptureTarget};

fn main() {
    let config = CaptureConfig {
        target: CaptureTarget::PrimaryDisplay,
        show_cursor: false,
        show_border: false,
    };

    println!("Starting capture of primary display...");
    let (rx, stop) = start_capture(config).expect("Failed to start capture");

    let start = Instant::now();
    let mut count = 0u64;
    let mut total_bytes = 0u64;
    let target = 60;

    while count < target {
        match rx.recv_timeout(Duration::from_secs(3)) {
            Ok(frame) => {
                count += 1;
                total_bytes += frame.data.len() as u64;
                if count % 10 == 0 {
                    let elapsed = start.elapsed().as_secs_f64();
                    let fps = count as f64 / elapsed;
                    println!(
                        "Frame {count}/{target}: {}x{}, {:.1} fps, {:.1} MB total",
                        frame.width,
                        frame.height,
                        fps,
                        total_bytes as f64 / 1_000_000.0
                    );
                }
            }
            Err(_) => {
                println!("Timeout waiting for frame");
                break;
            }
        }
    }

    stop.stop();

    let elapsed = start.elapsed().as_secs_f64();
    println!("\nCapture stats:");
    println!("  Frames: {count}");
    println!("  Duration: {elapsed:.2}s");
    println!("  Avg FPS: {:.1}", count as f64 / elapsed);
    println!("  Total data: {:.1} MB", total_bytes as f64 / 1_000_000.0);
}
