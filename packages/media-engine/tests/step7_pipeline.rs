use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use media_engine::capture::audio::AudioMode;
use media_engine::capture::wgc::CaptureTarget;
use media_engine::engine::{EngineCallbacks, MediaEngine, ScreenShareConfig};

/// Test requires a local LiveKit dev server:
///   docker run --rm -p 7880:7880 -p 7881:7881 -p 7882:7882/udp livekit/livekit-server --dev --bind 0.0.0.0
#[tokio::test]
async fn test_full_pipeline() {
    let token = livekit_api::access_token::AccessToken::with_api_key("devkey", "secret")
        .with_identity("pipeline-test|screen")
        .with_name("Pipeline Test")
        .with_grants(livekit_api::access_token::VideoGrants {
            room_join: true,
            room: "test-room".to_string(),
            can_publish: true,
            can_subscribe: false,
            ..Default::default()
        })
        .to_jwt()
        .expect("Token");

    let config = ScreenShareConfig {
        server_url: "ws://localhost:7880".to_string(),
        token,
        target: CaptureTarget::PrimaryDisplay,
        fps: 60,
        bitrate: 8_000_000,
        show_cursor: false,
        capture_audio: false,
        audio_mode: AudioMode::System,
    };

    let error_flag = Arc::new(AtomicBool::new(false));
    let stopped_flag = Arc::new(AtomicBool::new(false));
    let error_clone = error_flag.clone();
    let stopped_clone = stopped_flag.clone();

    let callbacks = EngineCallbacks {
        on_error: Some(Box::new(move |e| {
            eprintln!("Engine error: {e}");
            error_clone.store(true, Ordering::Relaxed);
        })),
        on_stopped: Some(Box::new(move || {
            println!("Engine stopped");
            stopped_clone.store(true, Ordering::Relaxed);
        })),
        on_stats: Some(Box::new(|stats| {
            println!(
                "Stats: fps={:.1}, bitrate={:.2} Mbps, frames={}, bytes={}",
                stats.fps, stats.bitrate_mbps, stats.frames_encoded, stats.bytes_sent
            );
        })),
    };

    println!("Starting full pipeline...");
    let engine = MediaEngine::start_screen_share(config, callbacks)
        .await
        .expect("Start engine");

    assert!(engine.is_running(), "Engine should be running");

    // Stream for 5 seconds
    tokio::time::sleep(Duration::from_secs(5)).await;

    // Test force keyframe mid-stream
    engine.force_keyframe().expect("Force keyframe");
    tokio::time::sleep(Duration::from_millis(500)).await;

    // Stop
    engine.stop();
    tokio::time::sleep(Duration::from_millis(500)).await;

    assert!(!error_flag.load(Ordering::Relaxed), "Should have no errors");
    println!("Full pipeline test passed!");
}
