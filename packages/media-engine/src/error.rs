use thiserror::Error;

#[derive(Error, Debug)]
pub enum EngineError {
    #[error("Failed to create GPU device")]
    GpuDeviceCreation,

    #[error("Failed to create texture")]
    TextureCreation,

    #[error("Windows API error: {0}")]
    Windows(#[from] windows::core::Error),

    #[error("Capture error: {0}")]
    Capture(String),

    #[error("Encode error: {0}")]
    Encode(String),

    #[error("Transport error: {0}")]
    Transport(String),
}
