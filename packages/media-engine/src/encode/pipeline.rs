use std::mem::ManuallyDrop;

use windows::Win32::Graphics::Direct3D11::*;
use windows::Win32::Graphics::Dxgi::Common::*;
use windows::core::Interface;

use crate::encode::config::EncoderConfig;
use crate::encode::mft::{EncodedPacket, MftEncoder};
use crate::error::EngineError;
use crate::gpu::device::GpuDevice;
use crate::gpu::texture::create_nv12_texture;

/// Full encode pipeline: BGRA texture → NV12 (via D3D11 Video Processor) → H.264 (via MFT).
pub struct EncodePipeline {
    pub gpu: GpuDevice,
    encoder: MftEncoder,
    video_device: ID3D11VideoDevice,
    video_context: ID3D11VideoContext,
    video_processor: ID3D11VideoProcessor,
    enumerator: ID3D11VideoProcessorEnumerator,
    bgra_texture: ID3D11Texture2D,
    nv12_texture: ID3D11Texture2D,
    config: EncoderConfig,
    frame_count: u64,
}

impl EncodePipeline {
    pub fn new(config: EncoderConfig) -> Result<Self, EngineError> {
        let gpu = GpuDevice::new()
            .map_err(|e| EngineError::Encode(format!("GPU device: {e}")))?;

        let bgra_texture = create_bgra_staging_texture(&gpu.device, config.width, config.height)
            .map_err(|e| EngineError::Encode(format!("BGRA texture: {e}")))?;

        let nv12_texture = create_nv12_texture(&gpu.device, config.width, config.height)
            .map_err(|e| EngineError::Encode(format!("NV12 texture: {e}")))?;

        let (video_device, video_context, enumerator, video_processor) =
            unsafe { create_video_processor(&gpu.device, &gpu.context, &config)
                .map_err(|e| EngineError::Encode(format!("Video processor: {e}")))? };

        let encoder = MftEncoder::new(&gpu.device, config.clone())
            .map_err(|e| EngineError::Encode(format!("MFT encoder: {e}")))?;

        Ok(Self {
            gpu,
            encoder,
            video_device,
            video_context,
            video_processor,
            enumerator,
            bgra_texture,
            nv12_texture,
            config,
            frame_count: 0,
        })
    }

    /// Upload raw BGRA frame data, convert to NV12, then encode to H.264.
    /// Reuses a pre-allocated BGRA texture to avoid per-frame GPU allocations.
    pub fn encode_frame(
        &mut self,
        data: &[u8],
        width: u32,
        height: u32,
        row_pitch: u32,
    ) -> Result<Vec<EncodedPacket>, EngineError> {
        // Step 1: Upload BGRA pixels into the reusable texture.
        // Use a D3D11_BOX to limit the copy to the actual frame dimensions,
        // since the texture may be larger (even-rounded for NV12).
        unsafe {
            let dst_box = D3D11_BOX {
                left: 0,
                top: 0,
                front: 0,
                right: width,
                bottom: height,
                back: 1,
            };
            self.gpu.context.UpdateSubresource(
                &self.bgra_texture,
                0,
                Some(&dst_box),
                data.as_ptr() as *const _,
                row_pitch,
                0,
            );
        }

        // Step 2: BGRA → NV12 via video processor
        unsafe {
            self.convert_bgra_to_nv12()?;
        }

        // Step 3: Feed NV12 texture to MFT encoder
        let duration_100ns = 10_000_000i64 / self.config.fps as i64;
        let timestamp_100ns = self.frame_count as i64 * duration_100ns;
        self.frame_count += 1;

        self.encoder
            .encode(&self.nv12_texture, timestamp_100ns, duration_100ns)
    }

    /// Force the next encoded frame to be a keyframe.
    pub fn force_keyframe(&self) -> Result<(), EngineError> {
        self.encoder.force_keyframe()
    }

    /// Flush the encoder and return remaining packets.
    pub fn flush(&mut self) -> Result<Vec<EncodedPacket>, EngineError> {
        self.encoder.flush()
    }

    unsafe fn convert_bgra_to_nv12(&self) -> Result<(), EngineError> {
        // Create input view from the reusable BGRA texture
        let input_view_desc = D3D11_VIDEO_PROCESSOR_INPUT_VIEW_DESC {
            FourCC: 0,
            ViewDimension: D3D11_VPIV_DIMENSION_TEXTURE2D,
            Anonymous: D3D11_VIDEO_PROCESSOR_INPUT_VIEW_DESC_0 {
                Texture2D: D3D11_TEX2D_VPIV {
                    MipSlice: 0,
                    ArraySlice: 0,
                },
            },
        };
        let mut input_view: Option<ID3D11VideoProcessorInputView> = None;
        self.video_device.CreateVideoProcessorInputView(
            &self.bgra_texture,
            &self.enumerator,
            &input_view_desc,
            Some(&mut input_view),
        )?;
        let input_view = input_view.ok_or(EngineError::Encode("No input view".into()))?;

        // Create output view
        let output_view_desc = D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC {
            ViewDimension: D3D11_VPOV_DIMENSION_TEXTURE2D,
            Anonymous: D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC_0 {
                Texture2D: D3D11_TEX2D_VPOV { MipSlice: 0 },
            },
        };
        let mut output_view: Option<ID3D11VideoProcessorOutputView> = None;
        self.video_device.CreateVideoProcessorOutputView(
            &self.nv12_texture,
            &self.enumerator,
            &output_view_desc,
            Some(&mut output_view),
        )?;
        let output_view = output_view.ok_or(EngineError::Encode("No output view".into()))?;

        // Configure stream — ManuallyDrop is required by the Windows API struct.
        // We use a mutable array so we can release the COM references after the Blt.
        let mut streams = [D3D11_VIDEO_PROCESSOR_STREAM {
            Enable: true.into(),
            OutputIndex: 0,
            InputFrameOrField: 0,
            PastFrames: 0,
            FutureFrames: 0,
            ppPastSurfaces: std::ptr::null_mut(),
            pInputSurface: ManuallyDrop::new(Some(input_view)),
            ppFutureSurfaces: std::ptr::null_mut(),
            ppPastSurfacesRight: std::ptr::null_mut(),
            pInputSurfaceRight: ManuallyDrop::new(None),
            ppFutureSurfacesRight: std::ptr::null_mut(),
        }];

        let result = self.video_context.VideoProcessorBlt(
            &self.video_processor,
            &output_view,
            0,
            &streams,
        );

        // Release the COM references held by ManuallyDrop to prevent leaks.
        // Without this, the input view (and its reference to the BGRA texture)
        // would leak every frame, accumulating GPU memory until the system freezes.
        ManuallyDrop::drop(&mut streams[0].pInputSurface);

        result?;
        Ok(())
    }
}

/// Create a reusable BGRA texture for uploading frame data via UpdateSubresource.
fn create_bgra_staging_texture(
    device: &ID3D11Device,
    width: u32,
    height: u32,
) -> Result<ID3D11Texture2D, EngineError> {
    let desc = D3D11_TEXTURE2D_DESC {
        Width: width,
        Height: height,
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
    let mut texture = None;
    unsafe {
        device
            .CreateTexture2D(&desc, None, Some(&mut texture))
            .map_err(|e| EngineError::Encode(format!("BGRA texture: {e}")))?;
    }
    texture.ok_or_else(|| EngineError::Encode("No BGRA texture".into()))
}

unsafe fn create_video_processor(
    device: &ID3D11Device,
    context: &ID3D11DeviceContext,
    config: &EncoderConfig,
) -> Result<
    (
        ID3D11VideoDevice,
        ID3D11VideoContext,
        ID3D11VideoProcessorEnumerator,
        ID3D11VideoProcessor,
    ),
    EngineError,
> {
    let video_device: ID3D11VideoDevice = device.cast()?;
    let video_context: ID3D11VideoContext = context.cast()?;

    let content_desc = D3D11_VIDEO_PROCESSOR_CONTENT_DESC {
        InputFrameFormat: D3D11_VIDEO_FRAME_FORMAT_PROGRESSIVE,
        InputFrameRate: DXGI_RATIONAL {
            Numerator: config.fps,
            Denominator: 1,
        },
        InputWidth: config.width,
        InputHeight: config.height,
        OutputFrameRate: DXGI_RATIONAL {
            Numerator: config.fps,
            Denominator: 1,
        },
        OutputWidth: config.width,
        OutputHeight: config.height,
        Usage: D3D11_VIDEO_USAGE_PLAYBACK_NORMAL,
    };

    let enumerator = video_device.CreateVideoProcessorEnumerator(&content_desc)?;
    let processor = video_device.CreateVideoProcessor(&enumerator, 0)?;

    // Set color spaces
    video_context.VideoProcessorSetStreamColorSpace(
        &processor,
        0,
        &D3D11_VIDEO_PROCESSOR_COLOR_SPACE {
            _bitfield: 0, // RGB input
        },
    );

    video_context.VideoProcessorSetOutputColorSpace(
        &processor,
        &D3D11_VIDEO_PROCESSOR_COLOR_SPACE {
            _bitfield: 1, // YCbCr output
        },
    );

    Ok((video_device, video_context, enumerator, processor))
}
