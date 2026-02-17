use std::fs::File;
use std::io::Write;
use std::time::{Duration, Instant};

use media_engine::capture::wgc::{start_capture, CaptureConfig, CaptureTarget};
use media_engine::encode::config::EncoderConfig;
use media_engine::encode::pipeline::EncodePipeline;

fn main() {
    println!("Starting capture + encode to file...");

    let cap_config = CaptureConfig {
        target: CaptureTarget::PrimaryDisplay,
        show_cursor: false,
        show_border: false,
    };
    let (rx, stop) = start_capture(cap_config).expect("Failed to start capture");

    // Get first frame for dimensions
    let first = rx
        .recv_timeout(Duration::from_secs(3))
        .expect("No first frame");
    let (w, h) = (first.width, first.height);
    println!("Capture: {w}x{h}");

    let enc_config = EncoderConfig {
        width: w,
        height: h,
        fps: 30,
        bitrate: 4_000_000,
        prefer_hardware: true,
    };
    let mut pipeline = EncodePipeline::new(enc_config).expect("Pipeline");

    let mut file = File::create("output.h264").expect("Create output file");
    let mut total_bytes = 0usize;
    let mut frame_count = 0u32;
    let start = Instant::now();
    let capture_duration = Duration::from_secs(5);

    // Encode first frame
    {
        let tex = create_texture(&pipeline.gpu, &first);
        for p in pipeline.encode_frame(&tex).expect("Encode") {
            file.write_all(&p.data).expect("Write");
            total_bytes += p.data.len();
        }
        frame_count += 1;
    }

    while start.elapsed() < capture_duration {
        match rx.recv_timeout(Duration::from_millis(100)) {
            Ok(frame) => {
                let tex = create_texture(&pipeline.gpu, &frame);
                for p in pipeline.encode_frame(&tex).expect("Encode") {
                    file.write_all(&p.data).expect("Write");
                    total_bytes += p.data.len();
                }
                frame_count += 1;
            }
            Err(_) => continue,
        }
    }

    // Flush
    for p in pipeline.flush().expect("Flush") {
        file.write_all(&p.data).expect("Write");
        total_bytes += p.data.len();
    }

    stop.stop();
    let elapsed = start.elapsed().as_secs_f64();

    println!("\nDone! Wrote output.h264");
    println!("  Frames: {frame_count}");
    println!("  Duration: {elapsed:.2}s");
    println!("  Avg FPS: {:.1}", frame_count as f64 / elapsed);
    println!("  File size: {:.1} KB", total_bytes as f64 / 1024.0);
    println!("\nVerify with: ffprobe output.h264");
}

fn create_texture(
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
            .expect("Create texture");
    }
    texture.unwrap()
}
