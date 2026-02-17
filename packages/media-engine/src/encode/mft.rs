use std::mem::ManuallyDrop;

use windows::core::Interface;
use windows::Win32::Graphics::Direct3D11::ID3D11Device;
use windows::Win32::Media::MediaFoundation::*;

use crate::encode::config::EncoderConfig;
use crate::error::EngineError;

/// H.264 encoder backed by a Media Foundation Transform.
pub struct MftEncoder {
    transform: IMFTransform,
    #[allow(dead_code)]
    device_manager: IMFDXGIDeviceManager,
    _reset_token: u32,
    config: EncoderConfig,
    input_stream_id: u32,
    output_stream_id: u32,
    is_async: bool,
    uses_d3d: bool,
    event_gen: Option<IMFMediaEventGenerator>,
    started: bool,
}

/// Encoded H.264 output.
pub struct EncodedPacket {
    pub data: Vec<u8>,
    pub timestamp: i64,
    pub duration: i64,
    pub keyframe: bool,
}

impl MftEncoder {
    /// Create and configure an MFT H.264 encoder.
    pub fn new(device: &ID3D11Device, config: EncoderConfig) -> Result<Self, EngineError> {
        unsafe {
            // Ensure COM is initialized (MTA for hardware MFTs)
            let _ = windows::Win32::System::Com::CoInitializeEx(
                None,
                windows::Win32::System::Com::COINIT_MULTITHREADED,
            );
            MFStartup(MF_VERSION, 0)?;
        }

        let (transform, device_manager, reset_token, is_async, uses_d3d) =
            unsafe { create_encoder(device, &config)? };

        let event_gen = if is_async {
            transform.cast::<IMFMediaEventGenerator>().ok()
        } else {
            None
        };

        Ok(Self {
            transform,
            device_manager,
            _reset_token: reset_token,
            config,
            input_stream_id: 0,
            output_stream_id: 0,
            is_async,
            uses_d3d,
            event_gen,
            started: false,
        })
    }

    /// Start the encoder.
    pub fn start(&mut self) -> Result<(), EngineError> {
        if self.started {
            return Ok(());
        }
        unsafe {
            self.transform
                .ProcessMessage(MFT_MESSAGE_NOTIFY_BEGIN_STREAMING, 0)?;
            self.transform
                .ProcessMessage(MFT_MESSAGE_NOTIFY_START_OF_STREAM, 0)?;
        }
        self.started = true;
        Ok(())
    }

    /// Feed an NV12 texture to the encoder and collect any output.
    pub fn encode(
        &mut self,
        texture: &windows::Win32::Graphics::Direct3D11::ID3D11Texture2D,
        timestamp_100ns: i64,
        duration_100ns: i64,
    ) -> Result<Vec<EncodedPacket>, EngineError> {
        if !self.started {
            self.start()?;
        }

        let sample = if self.uses_d3d {
            unsafe { create_sample_from_texture(texture, timestamp_100ns, duration_100ns)? }
        } else {
            unsafe { create_sample_from_texture_readback(texture, &self.config, timestamp_100ns, duration_100ns)? }
        };

        if self.is_async {
            self.encode_async(&sample)
        } else {
            self.encode_sync(&sample)
        }
    }

    fn encode_sync(&self, sample: &IMFSample) -> Result<Vec<EncodedPacket>, EngineError> {
        unsafe {
            self.transform
                .ProcessInput(self.input_stream_id, sample, 0)
                .map_err(|e| EngineError::Encode(format!("ProcessInput: {e}")))?;
        }
        self.drain_output()
    }

    fn encode_async(&self, sample: &IMFSample) -> Result<Vec<EncodedPacket>, EngineError> {
        let event_gen = self.event_gen.as_ref()
            .ok_or(EngineError::Encode("No event generator for async MFT".into()))?;

        // Wait for METransformNeedInput event
        unsafe {
            loop {
                let event = event_gen.GetEvent(MEDIA_EVENT_GENERATOR_GET_EVENT_FLAGS(0))
                    .map_err(|e| EngineError::Encode(format!("GetEvent: {e}")))?;
                let event_type = event.GetType()
                    .map_err(|e| EngineError::Encode(format!("GetType: {e}")))?;

                if event_type == METransformNeedInput.0 as u32 {
                    break;
                }
                // Ignore other events while waiting for input request
                if event_type == METransformDrainComplete.0 as u32 {
                    return Ok(Vec::new());
                }
            }

            // Send the input
            self.transform
                .ProcessInput(self.input_stream_id, sample, 0)
                .map_err(|e| EngineError::Encode(format!("ProcessInput(async): {e}")))?;
        }

        // Collect output events
        let mut packets = Vec::new();
        unsafe {
            loop {
                let event = match event_gen.GetEvent(MEDIA_EVENT_GENERATOR_GET_EVENT_FLAGS(0)) {
                    Ok(e) => e,
                    Err(_) => break,
                };
                let event_type = match event.GetType() {
                    Ok(t) => t,
                    Err(_) => break,
                };

                if event_type == METransformHaveOutput.0 as u32 {
                    match self.collect_one_output() {
                        Ok(Some(p)) => packets.push(p),
                        Ok(None) => {}
                        Err(_) => break,
                    }
                    break; // One output per input typically
                } else if event_type == METransformNeedInput.0 as u32 {
                    // No output yet, encoder needs more input
                    break;
                }
            }
        }

        Ok(packets)
    }

    fn collect_one_output(&self) -> Result<Option<EncodedPacket>, EngineError> {
        let stream_info = unsafe {
            self.transform
                .GetOutputStreamInfo(self.output_stream_id)
                .map_err(|e| EngineError::Encode(format!("GetOutputStreamInfo: {e}")))?
        };

        let mft_provides_samples =
            (stream_info.dwFlags & MFT_OUTPUT_STREAM_PROVIDES_SAMPLES.0 as u32) != 0;

        let mut output_buffer = MFT_OUTPUT_DATA_BUFFER {
            dwStreamID: self.output_stream_id,
            pSample: ManuallyDrop::new(if mft_provides_samples {
                None
            } else {
                let sample = unsafe { create_output_sample(stream_info.cbSize)? };
                Some(sample)
            }),
            dwStatus: 0,
            pEvents: ManuallyDrop::new(None),
        };

        let mut status = 0u32;
        let hr = unsafe {
            self.transform
                .ProcessOutput(0, std::slice::from_mut(&mut output_buffer), &mut status)
        };

        match hr {
            Ok(()) => {
                let result = if let Some(sample) = ManuallyDrop::into_inner(output_buffer.pSample) {
                    let packet = unsafe { extract_packet(&sample)? };
                    Some(packet)
                } else {
                    None
                };
                let _ = ManuallyDrop::into_inner(output_buffer.pEvents);
                Ok(result)
            }
            Err(e) if e.code() == MF_E_TRANSFORM_NEED_MORE_INPUT => {
                let _ = ManuallyDrop::into_inner(output_buffer.pSample);
                let _ = ManuallyDrop::into_inner(output_buffer.pEvents);
                Ok(None)
            }
            Err(e) => {
                let _ = ManuallyDrop::into_inner(output_buffer.pSample);
                let _ = ManuallyDrop::into_inner(output_buffer.pEvents);
                Err(EngineError::Encode(format!("ProcessOutput: {e}")))
            }
        }
    }

    /// Force the encoder to produce a keyframe on the next frame.
    pub fn force_keyframe(&self) -> Result<(), EngineError> {
        unsafe {
            let codec_api: ICodecAPI = self.transform.cast()
                .map_err(|e| EngineError::Encode(format!("ICodecAPI cast: {e}")))?;

            let var = windows::Win32::System::Variant::VARIANT::from(1u32);
            codec_api.SetValue(&CODECAPI_AVEncVideoForceKeyFrame, &var)?;
        }
        Ok(())
    }

    /// Drain all available output from the encoder (sync path).
    fn drain_output(&self) -> Result<Vec<EncodedPacket>, EngineError> {
        let mut packets = Vec::new();
        loop {
            match self.collect_one_output()? {
                Some(p) => packets.push(p),
                None => break,
            }
        }
        Ok(packets)
    }

    /// Flush and drain remaining output.
    pub fn flush(&mut self) -> Result<Vec<EncodedPacket>, EngineError> {
        if !self.started {
            return Ok(Vec::new());
        }
        unsafe {
            self.transform
                .ProcessMessage(MFT_MESSAGE_COMMAND_DRAIN, 0)?;
        }

        if self.is_async {
            // For async MFT, wait for drain complete event
            let mut packets = Vec::new();
            if let Some(event_gen) = &self.event_gen {
                unsafe {
                    loop {
                        let event = match event_gen.GetEvent(MEDIA_EVENT_GENERATOR_GET_EVENT_FLAGS(0)) {
                            Ok(e) => e,
                            Err(_) => break,
                        };
                        let event_type = match event.GetType() {
                            Ok(t) => t,
                            Err(_) => break,
                        };

                        if event_type == METransformHaveOutput.0 as u32 {
                            if let Ok(Some(p)) = self.collect_one_output() {
                                packets.push(p);
                            }
                        } else if event_type == METransformDrainComplete.0 as u32 {
                            break;
                        }
                    }
                }
            }
            Ok(packets)
        } else {
            self.drain_output()
        }
    }
}

impl Drop for MftEncoder {
    fn drop(&mut self) {
        let _ = self.flush();
        unsafe {
            let _ = MFShutdown();
        }
    }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/// Pack two u32 values into a u64 (used for frame size and frame rate attributes).
fn pack_u64(high: u32, low: u32) -> u64 {
    ((high as u64) << 32) | (low as u64)
}

unsafe fn create_encoder(
    device: &ID3D11Device,
    config: &EncoderConfig,
) -> Result<(IMFTransform, IMFDXGIDeviceManager, u32, bool, bool), EngineError> {
    // Create DXGI device manager
    let mut reset_token = 0u32;
    let mut device_manager: Option<IMFDXGIDeviceManager> = None;
    MFCreateDXGIDeviceManager(&mut reset_token, &mut device_manager)
        .map_err(|e| EngineError::Encode(format!("MFCreateDXGIDeviceManager: {e}")))?;
    let device_manager = device_manager.ok_or(EngineError::Encode("No device manager".into()))?;
    device_manager.ResetDevice(device, reset_token)
        .map_err(|e| EngineError::Encode(format!("ResetDevice: {e}")))?;

    // Enumerate H.264 encoders — try sync (software) first, then async (hardware)
    let input_type = MFT_REGISTER_TYPE_INFO {
        guidMajorType: MFMediaType_Video,
        guidSubtype: MFVideoFormat_NV12,
    };
    let output_type = MFT_REGISTER_TYPE_INFO {
        guidMajorType: MFMediaType_Video,
        guidSubtype: MFVideoFormat_H264,
    };

    // Two-pass enumeration: sync first (simpler, no async unlock needed), then hardware async
    let flag_sets = if config.prefer_hardware {
        vec![
            MFT_ENUM_FLAG_SYNCMFT | MFT_ENUM_FLAG_SORTANDFILTER,
            MFT_ENUM_FLAG_HARDWARE | MFT_ENUM_FLAG_ASYNCMFT | MFT_ENUM_FLAG_SORTANDFILTER,
        ]
    } else {
        vec![MFT_ENUM_FLAG_SYNCMFT | MFT_ENUM_FLAG_SORTANDFILTER]
    };

    let mut transform: Option<IMFTransform> = None;
    let mut is_async = false;

    for flags in &flag_sets {
        let mut activates_ptr: *mut Option<IMFActivate> = std::ptr::null_mut();
        let mut count = 0u32;
        let _ = MFTEnumEx(
            MFT_CATEGORY_VIDEO_ENCODER,
            *flags,
            Some(&input_type),
            Some(&output_type),
            &mut activates_ptr,
            &mut count,
        );

        if count == 0 || activates_ptr.is_null() {
            continue;
        }

        let activates = std::slice::from_raw_parts(activates_ptr, count as usize);

        for i in 0..count as usize {
            if let Some(activate) = &activates[i] {
                // For async MFTs, set unlock on activate before ActivateObject
                let _ = activate.SetUINT32(&MF_TRANSFORM_ASYNC_UNLOCK, 1);
                match activate.ActivateObject::<IMFTransform>() {
                    Ok(t) => {
                        // Detect if this is an async MFT
                        let detected_async = if let Ok(attrs) = t.GetAttributes() {
                            // Also set async unlock on the transform itself
                            let _ = attrs.SetUINT32(&MF_TRANSFORM_ASYNC_UNLOCK, 1);
                            attrs.GetUINT32(&MF_TRANSFORM_ASYNC).unwrap_or(0) != 0
                        } else {
                            false
                        };
                        is_async = detected_async;
                        transform = Some(t);
                        break;
                    }
                    Err(_) => continue,
                }
            }
        }

        // Release all activates
        for i in 0..count as usize {
            if let Some(a) = &activates[i] {
                let _ = a.ShutdownObject();
            }
        }
        windows::Win32::System::Com::CoTaskMemFree(Some(activates_ptr as *const _));

        if transform.is_some() {
            break;
        }
    }

    let transform = transform.ok_or(EngineError::Encode(
        "Failed to activate any H.264 encoder".into()
    ))?;

    // Set D3D manager on the transform (not supported by software encoders)
    let manager_unk: windows::core::IUnknown = device_manager.cast()?;
    let uses_d3d = transform.ProcessMessage(
        MFT_MESSAGE_SET_D3D_MANAGER,
        std::mem::transmute::<*const std::ffi::c_void, usize>(manager_unk.as_raw()),
    ).is_ok();

    // Configure output type (H.264)
    let output_media_type: IMFMediaType = MFCreateMediaType()?;
    output_media_type.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video)?;
    output_media_type.SetGUID(&MF_MT_SUBTYPE, &MFVideoFormat_H264)?;
    output_media_type.SetUINT32(&MF_MT_AVG_BITRATE, config.bitrate)?;
    output_media_type.SetUINT64(
        &MF_MT_FRAME_SIZE,
        pack_u64(config.width, config.height),
    )?;
    output_media_type.SetUINT64(
        &MF_MT_FRAME_RATE,
        pack_u64(config.fps, 1),
    )?;
    output_media_type.SetUINT32(&MF_MT_INTERLACE_MODE, 2)?; // MFVideoInterlace_Progressive = 2
    output_media_type.SetUINT32(&MF_MT_MPEG2_PROFILE, 100)?; // eAVEncH264VProfile_High = 100

    transform.SetOutputType(0, &output_media_type, 0)
        .map_err(|e| EngineError::Encode(format!("SetOutputType ({}x{}): {e}", config.width, config.height)))?;

    // Configure input type (NV12)
    let input_media_type: IMFMediaType = MFCreateMediaType()?;
    input_media_type.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video)?;
    input_media_type.SetGUID(&MF_MT_SUBTYPE, &MFVideoFormat_NV12)?;
    input_media_type.SetUINT64(
        &MF_MT_FRAME_SIZE,
        pack_u64(config.width, config.height),
    )?;
    input_media_type.SetUINT64(
        &MF_MT_FRAME_RATE,
        pack_u64(config.fps, 1),
    )?;
    input_media_type.SetUINT32(&MF_MT_INTERLACE_MODE, 2)?;

    transform.SetInputType(0, &input_media_type, 0)
        .map_err(|e| EngineError::Encode(format!("SetInputType: {e}")))?;

    Ok((transform, device_manager, reset_token, is_async, uses_d3d))
}

unsafe fn create_sample_from_texture(
    texture: &windows::Win32::Graphics::Direct3D11::ID3D11Texture2D,
    timestamp: i64,
    duration: i64,
) -> Result<IMFSample, EngineError> {
    let buffer: IMFMediaBuffer = MFCreateDXGISurfaceBuffer(
        &windows::Win32::Graphics::Direct3D11::ID3D11Texture2D::IID,
        texture,
        0,
        false,
    )?;

    let sample: IMFSample = MFCreateSample()?;
    sample.AddBuffer(&buffer)?;
    sample.SetSampleTime(timestamp)?;
    sample.SetSampleDuration(duration)?;

    Ok(sample)
}

/// Read back an NV12 texture to system memory and create an IMFSample.
/// Used when the encoder doesn't support D3D device manager (software encoders).
unsafe fn create_sample_from_texture_readback(
    texture: &windows::Win32::Graphics::Direct3D11::ID3D11Texture2D,
    config: &EncoderConfig,
    timestamp: i64,
    duration: i64,
) -> Result<IMFSample, EngineError> {
    use windows::Win32::Graphics::Direct3D11::*;
    use windows::Win32::Graphics::Dxgi::Common::*;

    // Get the device and context from the texture
    let device: ID3D11Device = texture.GetDevice()
        .map_err(|e| EngineError::Encode(format!("GetDevice: {e}")))?;
    let context = device.GetImmediateContext()
        .map_err(|e| EngineError::Encode(format!("GetImmediateContext: {e}")))?;

    // Create a staging texture for CPU readback
    let staging_desc = D3D11_TEXTURE2D_DESC {
        Width: config.width,
        Height: config.height,
        MipLevels: 1,
        ArraySize: 1,
        Format: DXGI_FORMAT_NV12,
        SampleDesc: DXGI_SAMPLE_DESC { Count: 1, Quality: 0 },
        Usage: D3D11_USAGE_STAGING,
        BindFlags: 0,
        CPUAccessFlags: D3D11_CPU_ACCESS_READ.0 as u32,
        MiscFlags: 0,
    };
    let mut staging: Option<ID3D11Texture2D> = None;
    device.CreateTexture2D(&staging_desc, None, Some(&mut staging))?;
    let staging = staging.ok_or(EngineError::Encode("Failed to create staging texture".into()))?;

    // Copy GPU texture → staging
    context.CopyResource(&staging, texture);

    // Map the staging texture
    let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
    context.Map(&staging, 0, D3D11_MAP_READ, 0, Some(&mut mapped))?;

    // NV12: height lines of Y (full width), then height/2 lines of UV (full width)
    let y_height = config.height as usize;
    let uv_height = (config.height / 2) as usize;
    let width = config.width as usize;
    let total_size = width * y_height + width * uv_height;

    let buffer: IMFMediaBuffer = MFCreateMemoryBuffer(total_size as u32)?;
    let mut buf_ptr = std::ptr::null_mut();
    let mut max_len = 0u32;
    buffer.Lock(&mut buf_ptr, Some(&mut max_len), None)?;

    let src = mapped.pData as *const u8;
    let row_pitch = mapped.RowPitch as usize;

    // Copy Y plane
    for row in 0..y_height {
        std::ptr::copy_nonoverlapping(
            src.add(row * row_pitch),
            buf_ptr.add(row * width),
            width,
        );
    }
    // Copy UV plane (starts after Y in the mapped resource)
    let uv_offset_src = y_height * row_pitch;
    let uv_offset_dst = y_height * width;
    for row in 0..uv_height {
        std::ptr::copy_nonoverlapping(
            src.add(uv_offset_src + row * row_pitch),
            buf_ptr.add(uv_offset_dst + row * width),
            width,
        );
    }

    buffer.Unlock()?;
    buffer.SetCurrentLength(total_size as u32)?;
    context.Unmap(&staging, 0);

    let sample: IMFSample = MFCreateSample()?;
    sample.AddBuffer(&buffer)?;
    sample.SetSampleTime(timestamp)?;
    sample.SetSampleDuration(duration)?;

    Ok(sample)
}

unsafe fn create_output_sample(buffer_size: u32) -> Result<IMFSample, EngineError> {
    let sample: IMFSample = MFCreateSample()?;
    if buffer_size > 0 {
        let buffer: IMFMediaBuffer = MFCreateMemoryBuffer(buffer_size)?;
        sample.AddBuffer(&buffer)?;
    }
    Ok(sample)
}

unsafe fn extract_packet(sample: &IMFSample) -> Result<EncodedPacket, EngineError> {
    let timestamp = sample.GetSampleTime().unwrap_or(0);
    let duration = sample.GetSampleDuration().unwrap_or(0);

    // Check for keyframe flag
    let flags = sample.GetUINT32(&MFSampleExtension_CleanPoint).unwrap_or(0);
    let keyframe = flags != 0;

    let buffer: IMFMediaBuffer = sample.ConvertToContiguousBuffer()?;
    let mut data_ptr = std::ptr::null_mut();
    let mut _max_len = 0u32;
    let mut cur_len = 0u32;
    buffer.Lock(&mut data_ptr, Some(&mut _max_len), Some(&mut cur_len))?;

    let data = std::slice::from_raw_parts(data_ptr, cur_len as usize).to_vec();
    buffer.Unlock()?;

    Ok(EncodedPacket {
        data,
        timestamp,
        duration,
        keyframe,
    })
}
