use std::time::Duration;

use media_engine::capture::wgc::{
    list_displays, list_windows, start_capture, CaptureConfig, CaptureTarget,
};

#[test]
fn test_list_displays() {
    let displays = list_displays().expect("Failed to list displays");
    assert!(!displays.is_empty(), "Should have at least one display");
    for d in &displays {
        println!("Display {}: {} ({}x{})", d.index, d.name, d.width, d.height);
        assert!(d.width > 0);
        assert!(d.height > 0);
    }
}

#[test]
fn test_list_windows() {
    let windows = list_windows().expect("Failed to list windows");
    // There should be at least some windows on a running system.
    println!("Found {} capturable windows", windows.len());
    for w in &windows {
        println!("  [{}] {} ({})", w.handle, w.title, w.process_name);
    }
}

#[test]
fn test_capture_primary_display() {
    let config = CaptureConfig {
        target: CaptureTarget::PrimaryDisplay,
        show_cursor: false,
        show_border: false,
    };

    let (rx, stop) = start_capture(config).expect("Failed to start capture");

    let mut count = 0;
    let timeout = Duration::from_secs(5);
    let start = std::time::Instant::now();

    while count < 10 && start.elapsed() < timeout {
        match rx.recv_timeout(Duration::from_millis(500)) {
            Ok(frame) => {
                assert!(frame.width > 0, "Frame width should be > 0");
                assert!(frame.height > 0, "Frame height should be > 0");
                assert!(!frame.data.is_empty(), "Frame data should not be empty");
                count += 1;
                println!(
                    "Frame {}: {}x{}, {} bytes",
                    count,
                    frame.width,
                    frame.height,
                    frame.data.len()
                );
            }
            Err(_) => break,
        }
    }

    stop.stop();
    assert!(count >= 1, "Should have captured at least 1 frame, got {count}");
    println!("Captured {count} frames total");
}
