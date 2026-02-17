use std::time::Duration;

use media_engine::capture::audio::{start_audio_capture, AudioCaptureConfig, AudioMode};

#[test]
fn test_capture_system_audio() {
    let config = AudioCaptureConfig {
        mode: AudioMode::System,
        sample_rate: 48000,
        channels: 2,
    };

    let (rx, stop) = start_audio_capture(config).expect("Failed to start audio capture");

    // Capture for 1 second
    let mut total_frames = 0usize;
    let mut total_packets = 0usize;
    let start = std::time::Instant::now();

    while start.elapsed() < Duration::from_secs(1) {
        match rx.recv_timeout(Duration::from_millis(200)) {
            Ok(packet) => {
                total_packets += 1;
                total_frames += packet.frames;

                assert_eq!(packet.sample_rate, 48000, "Sample rate should be 48kHz");
                assert_eq!(packet.channels, 2, "Should be stereo");
                assert_eq!(
                    packet.data.len(),
                    packet.frames * packet.channels as usize,
                    "Sample count should match frames * channels"
                );
            }
            Err(_) => continue,
        }
    }

    stop.stop();

    println!("\nAudio capture stats:");
    println!("  Packets: {total_packets}");
    println!("  Total frames: {total_frames}");
    println!(
        "  Duration: ~{:.2}s",
        total_frames as f64 / 48000.0
    );

    // Even with no audio playing, loopback should deliver silence packets
    assert!(total_packets > 0, "Should have received audio packets");
}
