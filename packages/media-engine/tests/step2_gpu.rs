use media_engine::gpu::device::GpuDevice;
use media_engine::gpu::texture::{create_bgra_texture, create_nv12_texture};

#[test]
fn test_create_gpu_device() {
    let gpu = GpuDevice::new().expect("Failed to create GPU device");
    // If we get here, device creation succeeded
    let _ = &gpu.device;
    let _ = &gpu.context;
    let _ = &gpu.dxgi_device;
}

#[test]
fn test_create_nv12_texture() {
    let gpu = GpuDevice::new().expect("Failed to create GPU device");
    let texture = create_nv12_texture(&gpu.device, 1920, 1080)
        .expect("Failed to create NV12 texture");
    let _ = texture;
}

#[test]
fn test_create_bgra_texture() {
    let gpu = GpuDevice::new().expect("Failed to create GPU device");
    let texture = create_bgra_texture(&gpu.device, 1920, 1080)
        .expect("Failed to create BGRA texture");
    let _ = texture;
}
