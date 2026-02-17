# @migo/media-engine

Native Rust media engine for high-performance screen sharing. Keeps the entire capture → encode → transport pipeline in native code — no frames cross to JavaScript.

## Architecture

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────────┐     ┌───────────┐
│  WGC Screen │     │ D3D11 Video Proc │     │   MFT H.264     │     │  str0m    │
│  Capture    │────▶│  BGRA → NV12     │────▶│   Encoder       │────▶│  WebRTC   │────▶ LiveKit SFU
│             │     │  (GPU)           │     │  (HW/SW)        │     │  Transport│
└─────────────┘     └──────────────────┘     └─────────────────┘     └───────────┘

┌─────────────┐
│  WASAPI     │
│  Audio      │─────────────────────────────────────────────────────▶ LiveKit SFU
│  Capture    │
└─────────────┘
```

All processing happens on the GPU where possible. The D3D11 Video Processor handles color space conversion (BGRA→NV12) and the Media Foundation Transform encoder produces H.264 NALUs that are sent directly over RTP via str0m. The LiveKit SFU forwards packets without re-encoding.

### Components

| Module | Description |
|--------|-------------|
| `gpu/` | D3D11 device creation with BGRA + Video support |
| `capture/wgc.rs` | Windows Graphics Capture screen capture with channel-based frame delivery |
| `capture/audio.rs` | WASAPI audio capture — system loopback or per-process |
| `encode/mft.rs` | Media Foundation Transform H.264 encoder (hardware preferred, software fallback) |
| `encode/pipeline.rs` | Full encode pipeline: GPU BGRA→NV12 conversion + MFT encoding |
| `transport/signal.rs` | LiveKit WebSocket signaling (protobuf, livekit-protocol) |
| `transport/livekit.rs` | str0m-based WebRTC transport with ICE/DTLS-SRTP |
| `engine.rs` | Pipeline orchestrator wiring capture → encode → transport |
| `lib.rs` | NAPI v3 bindings for Node.js/Electron |

## Performance

Tested at 3440×1440 with 60fps screen content:

- **~55 FPS** captured and encoded
- **~5 ms** average encode time per frame (well within the 16.67ms budget for 60fps)
- **~9 Mbps** output bitrate
- Hardware MFT encoding when available, software MFT fallback

## JavaScript API

```js
const engine = require('@migo/media-engine');

// Enumerate capture targets
const displays = engine.listDisplays();
// [{ index: 1, name: "ASUS VG34V", width: 3440, height: 1440 }]

const windows = engine.listWindows();
// [{ handle: 132938, title: "...", processName: "Code.exe" }]

// Start screen share
await engine.startScreenShare(
  {
    serverUrl: 'ws://localhost:7880',
    token: '<livekit-jwt>',
    targetType: 'primary',       // "primary" | "display" | "window"
    targetId: undefined,          // display index or window handle
    fps: 60,
    bitrate: 8_000_000,          // 8 Mbps
    showCursor: true,
    captureAudio: false,
    audioMode: 'system',         // "system" or process PID as string
  },
  (error) => console.error('Engine error:', error),
  () => console.log('Engine stopped'),
  (stats) => console.log(`${stats.fps.toFixed(1)} fps, ${stats.bitrateMbps.toFixed(2)} Mbps`),
);

// Control
engine.forceKeyframe();
engine.isScreenShareRunning(); // true
engine.stopScreenShare();
```

## Building

Requires Windows with:

- Rust toolchain (`x86_64-pc-windows-msvc`)
- Node.js + pnpm
- OpenSSL (`scoop install openssl`, set `OPENSSL_DIR` env var)

```bash
# Debug build
pnpm build:debug

# Release build (LTO enabled)
pnpm build

# Run Rust tests (some require a LiveKit dev server)
cargo test -- --test-threads=1

# Run NAPI binding tests
node tests/step8_napi_test.mjs
```

### LiveKit dev server for tests

Tests in `step6_transport.rs` and `step7_pipeline.rs` require a local LiveKit server:

```bash
docker run --rm -p 7880:7880 -p 7881:7881 -p 7882:7882/udp livekit/livekit-server --dev --bind 0.0.0.0
```

## How it works

1. **Capture** — WGC captures the screen as BGRA textures. Frames arrive via a bounded channel (backpressure drops frames if the encoder is slow). WGC only delivers frames when screen content changes.

2. **Encode** — The pipeline converts BGRA→NV12 using the D3D11 Video Processor (GPU), then feeds the NV12 texture to a Media Foundation Transform H.264 encoder. Hardware MFTs (e.g., NVIDIA NVENC, AMD AMF, Intel QSV) are preferred; the engine falls back to Microsoft's software MFT if none are available.

3. **Transport** — H.264 NALUs are sent over RTP using str0m (pure Rust WebRTC). The engine connects to LiveKit's signaling WebSocket, performs SDP offer/answer negotiation, and establishes a DTLS-SRTP session. ICE candidates use the machine's local IP.

4. **Audio** — WASAPI captures system audio (loopback) or a specific process's audio. PCM float32 samples are forwarded to the transport layer.

All threads share an `Arc<AtomicBool>` stop flag for clean shutdown. Stats (FPS, encode time, bitrate) are emitted every second via callback.
