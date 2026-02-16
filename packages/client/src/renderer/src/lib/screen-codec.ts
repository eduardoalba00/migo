/**
 * Custom WebCodecs-based screen share encoding/decoding pipeline.
 *
 * Uses WebCodecs VideoEncoder with hardware acceleration (NVENC / Media
 * Foundation / VideoToolbox) instead of WebRTC's software-only codecs.
 * Encoded frames are transported via LiveKit DataChannel and decoded on
 * the receiver with VideoDecoder → MediaStreamTrackGenerator.
 */

declare class MediaStreamTrackProcessor<T> {
  constructor(init: { track: MediaStreamTrack });
  readonly readable: ReadableStream<T>;
}

declare class MediaStreamTrackGenerator extends MediaStreamTrack {
  constructor(init: { kind: string });
  readonly writable: WritableStream<VideoFrame>;
}

// ----- Chunking (DataChannel has 65535 byte limit) -----

const MAX_CHUNK = 60_000;

export const SCREEN_DATA_TOPIC = "ss";

export function chunkPacket(packet: Uint8Array): Uint8Array[] {
  if (packet.length + 2 <= 65_535) {
    const msg = new Uint8Array(2 + packet.length);
    msg[0] = 1;
    msg[1] = 0;
    msg.set(packet, 2);
    return [msg];
  }

  const total = Math.ceil(packet.length / MAX_CHUNK);
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < total; i++) {
    const start = i * MAX_CHUNK;
    const slice = packet.subarray(start, Math.min(start + MAX_CHUNK, packet.length));
    const msg = new Uint8Array(2 + slice.length);
    msg[0] = total;
    msg[1] = i;
    msg.set(slice, 2);
    chunks.push(msg);
  }
  return chunks;
}

export class ChunkAssembler {
  private parts: (Uint8Array | null)[] = [];
  private expected = 0;
  private received = 0;

  feed(msg: Uint8Array): Uint8Array | null {
    const total = msg[0];
    const index = msg[1];
    const payload = msg.subarray(2);

    if (total === 1) return payload;

    if (total !== this.expected || this.received === this.expected) {
      this.parts = new Array(total).fill(null);
      this.expected = total;
      this.received = 0;
    }

    if (index < total && !this.parts[index]) {
      this.parts[index] = payload;
      this.received++;
    }

    if (this.received === this.expected) {
      let totalLen = 0;
      for (const p of this.parts) totalLen += p!.length;
      const assembled = new Uint8Array(totalLen);
      let offset = 0;
      for (const p of this.parts) {
        assembled.set(p!, offset);
        offset += p!.length;
      }
      this.parts = [];
      this.expected = 0;
      this.received = 0;
      return assembled;
    }

    return null;
  }
}

// ----- Binary packet protocol -----

const PKT_CONFIG = 0;
const PKT_KEY = 1;
const PKT_DELTA = 2;

function serializeConfig(width: number, height: number, codec: string): Uint8Array {
  const codecBytes = new TextEncoder().encode(codec);
  const buf = new Uint8Array(5 + codecBytes.length);
  buf[0] = PKT_CONFIG;
  new DataView(buf.buffer).setUint16(1, width);
  new DataView(buf.buffer).setUint16(3, height);
  buf.set(codecBytes, 5);
  return buf;
}

function serializeFrame(isKey: boolean, timestamp: number, duration: number, data: Uint8Array): Uint8Array {
  const buf = new Uint8Array(9 + data.length);
  buf[0] = isKey ? PKT_KEY : PKT_DELTA;
  const view = new DataView(buf.buffer);
  view.setUint32(1, timestamp);
  view.setUint32(5, duration);
  buf.set(data, 9);
  return buf;
}

interface ParsedPacket {
  type: number;
  width?: number;
  height?: number;
  codec?: string;
  isKey?: boolean;
  timestamp?: number;
  duration?: number;
  data?: Uint8Array;
}

function deserializePacket(buf: Uint8Array): ParsedPacket {
  const type = buf[0];
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (type === PKT_CONFIG) {
    return {
      type,
      width: view.getUint16(1),
      height: view.getUint16(3),
      codec: new TextDecoder().decode(buf.subarray(5)),
    };
  }
  return {
    type,
    isKey: type === PKT_KEY,
    timestamp: view.getUint32(1),
    duration: view.getUint32(5),
    data: buf.subarray(9),
  };
}

// ----- Encoder -----

export interface ScreenEncoderConfig {
  framerate: number;
  bitrate: number;
}

export class ScreenEncoder {
  private encoder: VideoEncoder | null = null;
  private reader: ReadableStreamDefaultReader<VideoFrame> | null = null;
  private running = false;
  private configured = false;
  private sendChunks: (chunks: Uint8Array[]) => void;
  private config!: ScreenEncoderConfig;
  private frameIndex = 0;
  private keyframeEvery = 120;

  constructor(sendChunks: (chunks: Uint8Array[]) => void) {
    this.sendChunks = sendChunks;
  }

  async start(track: MediaStreamTrack, config: ScreenEncoderConfig): Promise<void> {
    this.config = config;
    this.keyframeEvery = config.framerate * 2;

    this.encoder = new VideoEncoder({
      output: (chunk) => {
        const frameData = new Uint8Array(chunk.byteLength);
        chunk.copyTo(frameData);
        const packet = serializeFrame(
          chunk.type === "key",
          Math.round(chunk.timestamp / 1000),
          Math.round((chunk.duration ?? 0) / 1000),
          frameData,
        );
        this.sendChunks(chunkPacket(packet));
      },
      error: (e) => console.error("[ScreenEncoder] Error:", e),
    });

    const processor = new MediaStreamTrackProcessor<VideoFrame>({ track });
    this.reader = processor.readable.getReader();
    this.running = true;
    this.frameIndex = 0;
    this.configured = false;

    this.readLoop();
  }

  private async configureFromFrame(width: number, height: number): Promise<void> {
    const candidates: Array<{ codec: string; hw: HardwareAcceleration }> = [
      { codec: "avc1.640033", hw: "prefer-hardware" },
      { codec: "avc1.640033", hw: "prefer-software" },
    ];

    let chosen = candidates[0];
    for (const c of candidates) {
      const support = await VideoEncoder.isConfigSupported({
        codec: c.codec,
        width,
        height,
        bitrate: this.config.bitrate,
        framerate: this.config.framerate,
        hardwareAcceleration: c.hw,
        latencyMode: "realtime",
      });
      if (support.supported) {
        chosen = c;
        break;
      }
    }

    this.encoder!.configure({
      codec: chosen.codec,
      width,
      height,
      bitrate: this.config.bitrate,
      framerate: this.config.framerate,
      hardwareAcceleration: chosen.hw,
      latencyMode: "realtime",
      avc: { format: "annexb" },
    });

    this.sendChunks(chunkPacket(serializeConfig(width, height, chosen.codec)));
    this.configured = true;
  }

  private async readLoop(): Promise<void> {
    while (this.running && this.reader && this.encoder) {
      try {
        const { value: frame, done } = await this.reader.read();
        if (done || !frame) break;

        if (!this.configured) {
          await this.configureFromFrame(frame.displayWidth, frame.displayHeight);
        }

        if (this.encoder.encodeQueueSize > 5) {
          frame.close();
          continue;
        }

        const keyFrame = this.frameIndex % this.keyframeEvery === 0;
        this.frameIndex++;

        this.encoder.encode(frame, { keyFrame });
        frame.close();
      } catch (e) {
        if (this.running) console.error("[ScreenEncoder] Read error:", e);
        break;
      }
    }
  }

  stop(): void {
    this.running = false;
    this.reader?.cancel().catch(() => {});
    try {
      this.encoder?.close();
    } catch {}
    this.reader = null;
    this.encoder = null;
  }
}

// ----- Decoder -----

export class ScreenDecoder {
  private decoder: VideoDecoder | null = null;
  private generator: MediaStreamTrackGenerator;
  private writer: WritableStreamDefaultWriter<VideoFrame>;
  private configured = false;
  private receivedKeyframe = false;
  private assembler = new ChunkAssembler();

  constructor() {
    this.generator = new MediaStreamTrackGenerator({ kind: "video" });
    this.writer = this.generator.writable.getWriter();

    this.decoder = new VideoDecoder({
      output: (frame: VideoFrame) => {
        this.writer.write(frame).catch(() => frame.close());
      },
      error: (e) => console.error("[ScreenDecoder] Error:", e),
    });
  }

  getTrack(): MediaStreamTrack {
    return this.generator;
  }

  feedChunk(msg: Uint8Array): void {
    const packet = this.assembler.feed(msg);
    if (packet) this.processPacket(packet);
  }

  private processPacket(packet: Uint8Array): void {
    const parsed = deserializePacket(packet);

    if (parsed.type === PKT_CONFIG) {
      this.decoder!.configure({
        codec: parsed.codec!,
        codedWidth: parsed.width,
        codedHeight: parsed.height,
        hardwareAcceleration: "prefer-hardware",
      });
      this.configured = true;
      this.receivedKeyframe = false;
      return;
    }

    if (!this.configured || !parsed.data) return;

    if (!this.receivedKeyframe) {
      if (!parsed.isKey) return;
      this.receivedKeyframe = true;
    }

    if (this.decoder!.decodeQueueSize > 5) return;

    try {
      this.decoder!.decode(
        new EncodedVideoChunk({
          type: parsed.isKey ? "key" : "delta",
          timestamp: (parsed.timestamp ?? 0) * 1000,
          duration: (parsed.duration ?? 0) * 1000,
          data: parsed.data,
        }),
      );
    } catch (e) {
      console.error("[ScreenDecoder] Decode error:", e);
    }
  }

  stop(): void {
    try {
      this.decoder?.close();
    } catch {}
    this.decoder = null;
    this.writer.close().catch(() => {});
    this.generator.stop();
  }
}
