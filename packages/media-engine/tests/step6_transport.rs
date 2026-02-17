use std::time::{Duration, Instant};

use media_engine::capture::wgc::{start_capture, CaptureConfig, CaptureTarget};
use media_engine::encode::config::EncoderConfig;
use media_engine::encode::pipeline::EncodePipeline;
use media_engine::transport::livekit::{LiveKitTransport, TransportConfig};

/// Test requires a local LiveKit dev server:
///   docker run --rm -p 7880:7880 -p 7881:7881 -p 7882:7882/udp livekit/livekit-server --dev --bind 0.0.0.0
#[tokio::test]
async fn test_capture_encode_transport() {
    // Generate access token
    let token = livekit_api::access_token::AccessToken::with_api_key("devkey", "secret")
        .with_identity("test-user|screen")
        .with_name("Test Screen Share")
        .with_grants(livekit_api::access_token::VideoGrants {
            room_join: true,
            room: "test-room".to_string(),
            can_publish: true,
            can_subscribe: false,
            ..Default::default()
        })
        .to_jwt()
        .expect("Generate token");

    println!("Token generated, connecting to LiveKit...");

    // Start capture
    let cap_config = CaptureConfig {
        target: CaptureTarget::PrimaryDisplay,
        show_cursor: false,
        show_border: false,
    };
    let (rx, cap_stop) = start_capture(cap_config).expect("Start capture");

    // Wait for first frame to get dimensions
    let first = rx
        .recv_timeout(Duration::from_secs(3))
        .expect("First frame");
    let (w, h) = (first.width, first.height);
    println!("Capture: {w}x{h}");

    // Create encoder
    let enc_config = EncoderConfig {
        width: w,
        height: h,
        fps: 60,
        bitrate: 8_000_000, // 8 Mbps for high quality
        prefer_hardware: true,
    };
    let mut pipeline = EncodePipeline::new(enc_config).expect("Pipeline");

    // Connect to LiveKit
    let transport_config = TransportConfig {
        server_url: "ws://localhost:7880".to_string(),
        token,
        width: w,
        height: h,
        fps: 60,
    };

    let transport = LiveKitTransport::connect(transport_config)
        .await
        .expect("Connect to LiveKit");

    println!("Transport connected, streaming for 5 seconds...\n");

    // Performance tracking
    let start = Instant::now();
    let mut frame_count = 0u32;
    let mut total_encoded_bytes = 0usize;
    let mut total_encode_time = Duration::ZERO;
    let mut min_encode_ms = f64::MAX;
    let mut max_encode_ms = 0.0f64;

    // Encode first frame
    {
        let encode_start = Instant::now();
        let tex = create_bgra_texture(&pipeline.gpu, &first);
        let packets = pipeline.encode_frame(&tex).expect("Encode");
        let encode_elapsed = encode_start.elapsed();

        for p in &packets {
            total_encoded_bytes += p.data.len();
            let ts = (frame_count as u32) * (90_000 / 60); // 90kHz timestamp
            transport.send_video(p.data.clone(), ts, p.keyframe);
        }
        total_encode_time += encode_elapsed;
        let ms = encode_elapsed.as_secs_f64() * 1000.0;
        min_encode_ms = min_encode_ms.min(ms);
        max_encode_ms = max_encode_ms.max(ms);
        frame_count += 1;
    }

    // Stream for 5 seconds
    let stream_duration = Duration::from_secs(5);
    while start.elapsed() < stream_duration {
        match rx.recv_timeout(Duration::from_millis(50)) {
            Ok(frame) => {
                let encode_start = Instant::now();
                let tex = create_bgra_texture(&pipeline.gpu, &frame);
                let packets = pipeline.encode_frame(&tex).expect("Encode");
                let encode_elapsed = encode_start.elapsed();

                for p in &packets {
                    total_encoded_bytes += p.data.len();
                    let ts = (frame_count as u32) * (90_000 / 60);
                    transport.send_video(p.data.clone(), ts, p.keyframe);
                }
                total_encode_time += encode_elapsed;
                let ms = encode_elapsed.as_secs_f64() * 1000.0;
                min_encode_ms = min_encode_ms.min(ms);
                max_encode_ms = max_encode_ms.max(ms);
                frame_count += 1;
            }
            Err(_) => continue,
        }
    }

    // Stop everything
    transport.stop();
    cap_stop.stop();

    let elapsed = start.elapsed().as_secs_f64();
    let avg_encode_ms = (total_encode_time.as_secs_f64() * 1000.0) / frame_count as f64;
    let avg_fps = frame_count as f64 / elapsed;
    let bitrate_mbps = (total_encoded_bytes as f64 * 8.0) / (elapsed * 1_000_000.0);

    println!("═══════════════════════════════════════");
    println!("  PERFORMANCE METRICS ({w}x{h})");
    println!("═══════════════════════════════════════");
    println!("  Duration:        {elapsed:.2}s");
    println!("  Frames encoded:  {frame_count}");
    println!("  Average FPS:     {avg_fps:.1}");
    println!("  Encoded bytes:   {:.1} MB", total_encoded_bytes as f64 / (1024.0 * 1024.0));
    println!("  Avg bitrate:     {bitrate_mbps:.2} Mbps");
    println!("  Encode time:");
    println!("    Average:       {avg_encode_ms:.2} ms/frame");
    println!("    Min:           {min_encode_ms:.2} ms/frame");
    println!("    Max:           {max_encode_ms:.2} ms/frame");
    println!("  Budget (60fps):  16.67 ms/frame");
    println!(
        "  Headroom:        {:.2} ms/frame",
        16.67 - avg_encode_ms
    );
    println!("═══════════════════════════════════════");

    assert!(frame_count > 0, "Should have encoded frames");
    // WGC capture rate depends on screen activity — may be low in test environments.
    // The key metric is encode time per frame, not delivered FPS.
    assert!(
        avg_encode_ms < 16.67,
        "Encode time should fit in 60fps budget (got {avg_encode_ms:.2}ms)"
    );
}

fn create_bgra_texture(
    gpu: &media_engine::gpu::device::GpuDevice,
    frame: &media_engine::capture::wgc::CapturedFrame,
) -> windows::Win32::Graphics::Direct3D11::ID3D11Texture2D {
    use windows::Win32::Graphics::Direct3D11::*;
    use windows::Win32::Graphics::Dxgi::Common::*;

    let desc = D3D11_TEXTURE2D_DESC {
        Width: frame.width,
        Height: frame.height,
        MipLevels: 1,
        ArraySize: 1,
        Format: DXGI_FORMAT_B8G8R8A8_UNORM,
        SampleDesc: DXGI_SAMPLE_DESC {
            Count: 1,
            Quality: 0,
        },
        Usage: D3D11_USAGE_DEFAULT,
        BindFlags: D3D11_BIND_RENDER_TARGET.0 as u32,
        CPUAccessFlags: 0,
        MiscFlags: 0,
    };

    let init_data = D3D11_SUBRESOURCE_DATA {
        pSysMem: frame.data.as_ptr() as *const _,
        SysMemPitch: frame.width * 4,
        SysMemSlicePitch: 0,
    };

    let mut texture = None;
    unsafe {
        gpu.device
            .CreateTexture2D(&desc, Some(&init_data), Some(&mut texture))
            .expect("Create BGRA texture");
    }
    texture.unwrap()
}
