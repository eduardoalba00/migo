use std::time::Duration;

use media_engine::capture::wgc::{start_capture, CaptureConfig, CaptureTarget};
use media_engine::encode::config::EncoderConfig;
use media_engine::encode::pipeline::EncodePipeline;

#[test]
fn test_capture_and_encode() {
    // Start capturing primary display
    let cap_config = CaptureConfig {
        target: CaptureTarget::PrimaryDisplay,
        show_cursor: false,
        show_border: false,
    };
    let (rx, stop) = start_capture(cap_config).expect("Failed to start capture");

    // Wait for first frame to get dimensions
    let first_frame = rx
        .recv_timeout(Duration::from_secs(3))
        .expect("No frame received");
    let width = first_frame.width;
    let height = first_frame.height;
    println!("Capture dimensions: {width}x{height}");

    // Create encode pipeline
    let enc_config = EncoderConfig {
        width,
        height,
        fps: 30,
        bitrate: 2_000_000,
        prefer_hardware: true,
    };
    let mut pipeline = EncodePipeline::new(enc_config).expect("Failed to create encode pipeline");

    let mut total_packets = 0;
    let mut total_bytes = 0usize;
    let mut has_keyframe = false;

    // Encode 30 frames — use pipeline's GPU device for texture creation
    for i in 0..30 {
        let frame = match rx.recv_timeout(Duration::from_secs(2)) {
            Ok(f) => f,
            Err(_) => {
                println!("Timeout at frame {i}, stopping");
                break;
            }
        };

        let bgra_tex = create_bgra_texture(&pipeline.gpu, &frame);

        let packets = pipeline.encode_frame(&bgra_tex).expect("Encode failed");
        for p in &packets {
            total_packets += 1;
            total_bytes += p.data.len();
            if p.keyframe {
                has_keyframe = true;
            }
            println!(
                "Packet {}: {} bytes, keyframe={}, ts={}",
                total_packets,
                p.data.len(),
                p.keyframe,
                p.timestamp
            );
        }
    }

    // Flush remaining
    let remaining = pipeline.flush().expect("Flush failed");
    for p in &remaining {
        total_packets += 1;
        total_bytes += p.data.len();
        if p.keyframe {
            has_keyframe = true;
        }
    }

    stop.stop();

    println!("\nEncode stats:");
    println!("  Packets: {total_packets}");
    println!("  Total bytes: {total_bytes}");
    println!("  Has keyframe: {has_keyframe}");

    assert!(total_packets > 0, "Should have produced encoded packets");
    assert!(total_bytes > 0, "Encoded data should be non-empty");
    assert!(has_keyframe, "Should have at least one keyframe");
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
        SysMemPitch: frame.row_pitch,
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
