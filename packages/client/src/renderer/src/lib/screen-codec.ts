/**
 * Screen share encoding/decoding pipeline.
 *
 * Sender side: buttercap produces H.264 packets in the main process.
 * The renderer serializes them into the binary protocol and chunks
 * for DataChannel transport.
 *
 * Receiver side: ScreenDecoder reassembles chunks, decodes H.264 via
 * WebCodecs VideoDecoder → MediaStreamTrackGenerator.
 */

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

export function serializeConfig(width: number, height: number, codec: string): Uint8Array {
  const codecBytes = new TextEncoder().encode(codec);
  const buf = new Uint8Array(5 + codecBytes.length);
  buf[0] = PKT_CONFIG;
  new DataView(buf.buffer).setUint16(1, width);
  new DataView(buf.buffer).setUint16(3, height);
  buf.set(codecBytes, 5);
  return buf;
}

export function serializeFrame(isKey: boolean, timestamp: number, duration: number, data: Uint8Array): Uint8Array {
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

// ----- SPS resolution parser -----

class BitReader {
  private data: Uint8Array;
  private byteOffset = 0;
  private bitOffset = 0;

  constructor(data: Uint8Array) {
    this.data = data;
  }

  readBit(): number {
    if (this.byteOffset >= this.data.length) return 0;
    const bit = (this.data[this.byteOffset] >> (7 - this.bitOffset)) & 1;
    this.bitOffset++;
    if (this.bitOffset === 8) {
      this.bitOffset = 0;
      this.byteOffset++;
    }
    return bit;
  }

  readBits(n: number): number {
    let val = 0;
    for (let i = 0; i < n; i++) {
      val = (val << 1) | this.readBit();
    }
    return val;
  }

  readUE(): number {
    let leadingZeros = 0;
    while (this.readBit() === 0) {
      leadingZeros++;
      if (leadingZeros > 31) return 0;
    }
    if (leadingZeros === 0) return 0;
    return (1 << leadingZeros) - 1 + this.readBits(leadingZeros);
  }

  readSE(): number {
    const val = this.readUE();
    if (val % 2 === 0) return -(val >> 1);
    return (val + 1) >> 1;
  }
}

/**
 * Parse an H.264 Annex B bitstream to find the SPS NAL unit and extract
 * the coded resolution in pixels.
 */
export function parseSPSResolution(annexB: Uint8Array): { width: number; height: number; codec: string } | null {
  // Find SPS NAL unit (type 7)
  let spsStart = -1;
  let nalHeaderIdx = -1;
  for (let i = 0; i < annexB.length - 4; i++) {
    let nalByte = -1;
    if (annexB[i] === 0 && annexB[i + 1] === 0 && annexB[i + 2] === 0 && annexB[i + 3] === 1) {
      nalByte = i + 4;
    } else if (annexB[i] === 0 && annexB[i + 1] === 0 && annexB[i + 2] === 1) {
      nalByte = i + 3;
    }
    if (nalByte !== -1 && nalByte < annexB.length && (annexB[nalByte] & 0x1f) === 7) {
      nalHeaderIdx = nalByte;
      spsStart = nalByte + 1;
      break;
    }
  }

  if (spsStart === -1 || nalHeaderIdx === -1) return null;

  let spsEnd = annexB.length;
  for (let i = spsStart; i < annexB.length - 3; i++) {
    if (annexB[i] === 0 && annexB[i + 1] === 0 && (annexB[i + 2] === 1 || (annexB[i + 2] === 0 && annexB[i + 3] === 1))) {
      spsEnd = i;
      break;
    }
  }

  const spsData = annexB.subarray(spsStart, spsEnd);
  const reader = new BitReader(spsData);

  const profileIdc = reader.readBits(8);
  const constraintFlags = reader.readBits(8);
  const levelIdc = reader.readBits(8);
  reader.readUE(); // seq_parameter_set_id

  // Build proper avc1 codec string from SPS: avc1.PPCCLL
  const codec = "avc1." +
    profileIdc.toString(16).padStart(2, "0") +
    constraintFlags.toString(16).padStart(2, "0") +
    levelIdc.toString(16).padStart(2, "0");

  let chromaFormatIdc = 1; // default 4:2:0
  if ([100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134].includes(profileIdc)) {
    chromaFormatIdc = reader.readUE();
    if (chromaFormatIdc === 3) reader.readBits(1);
    reader.readUE(); // bit_depth_luma_minus8
    reader.readUE(); // bit_depth_chroma_minus8
    reader.readBits(1); // qpprime_y_zero_transform_bypass_flag
    const seqScalingMatrixPresent = reader.readBits(1);
    if (seqScalingMatrixPresent) {
      const count = chromaFormatIdc !== 3 ? 8 : 12;
      for (let i = 0; i < count; i++) {
        const present = reader.readBits(1);
        if (present) {
          const size = i < 6 ? 16 : 64;
          let lastScale = 8;
          let nextScale = 8;
          for (let j = 0; j < size; j++) {
            if (nextScale !== 0) {
              const delta = reader.readSE();
              nextScale = (lastScale + delta + 256) % 256;
            }
            lastScale = nextScale === 0 ? lastScale : nextScale;
          }
        }
      }
    }
  }

  reader.readUE(); // log2_max_frame_num_minus4
  const picOrderCntType = reader.readUE();
  if (picOrderCntType === 0) {
    reader.readUE();
  } else if (picOrderCntType === 1) {
    reader.readBits(1);
    reader.readSE();
    reader.readSE();
    const numRefFrames = reader.readUE();
    for (let i = 0; i < numRefFrames; i++) reader.readSE();
  }

  reader.readUE(); // max_num_ref_frames
  reader.readBits(1); // gaps_in_frame_num_value_allowed_flag

  const picWidthInMbsMinus1 = reader.readUE();
  const picHeightInMapUnitsMinus1 = reader.readUE();

  let width = (picWidthInMbsMinus1 + 1) * 16;
  let height = (picHeightInMapUnitsMinus1 + 1) * 16;

  const frameMbsOnlyFlag = reader.readBits(1);
  if (!frameMbsOnlyFlag) reader.readBits(1); // mb_adaptive_frame_field_flag
  reader.readBits(1); // direct_8x8_inference_flag

  // Frame cropping adjusts the macroblock-aligned size to the actual resolution
  const frameCroppingFlag = reader.readBits(1);
  if (frameCroppingFlag) {
    const cropLeft = reader.readUE();
    const cropRight = reader.readUE();
    const cropTop = reader.readUE();
    const cropBottom = reader.readUE();
    // Crop units depend on chroma format (2 for 4:2:0, 1 for 4:4:4)
    const cropUnitX = chromaFormatIdc === 3 ? 1 : 2;
    const cropUnitY = (chromaFormatIdc === 3 ? 1 : 2) * (frameMbsOnlyFlag ? 1 : 2);
    width -= (cropLeft + cropRight) * cropUnitX;
    height -= (cropTop + cropBottom) * cropUnitY;
  }

  return { width, height, codec };
}

// ----- Decoder -----

export class ScreenDecoder {
  private decoder: VideoDecoder | null = null;
  private generator: MediaStreamTrackGenerator;
  private writer: WritableStreamDefaultWriter<VideoFrame>;
  private configured = false;
  private receivedKeyframe = false;
  private assembler = new ChunkAssembler();
  private writerReady = true;

  constructor() {
    this.generator = new MediaStreamTrackGenerator({ kind: "video" });
    this.writer = this.generator.writable.getWriter();

    this.decoder = new VideoDecoder({
      output: (frame: VideoFrame) => {
        // Drop frames while the WritableStream has backpressure to prevent
        // unbounded queueing of GPU-backed VideoFrame objects.
        if (!this.writerReady) {
          frame.close();
          return;
        }
        this.writerReady = false;
        this.writer.write(frame).then(
          () => { frame.close(); this.writerReady = true; },
          () => { frame.close(); this.writerReady = true; },
        );
      },
      error: (e) => console.error("[ScreenDecoder] Error:", e),
    });
  }

  getTrack(): MediaStreamTrack {
    return this.generator;
  }

  isStopped(): boolean {
    return this.decoder === null;
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

    // Skip if decoder queue is backing up (prevents cascading artifacts)
    if (this.decoder!.decodeQueueSize > 5) {
      if (!parsed.isKey) return; // drop delta frames, wait for next keyframe
    }

    try {
      this.decoder!.decode(
        new EncodedVideoChunk({
          type: parsed.isKey ? "key" : "delta",
          timestamp: parsed.timestamp ?? 0,
          duration: parsed.duration ?? 0,
          data: parsed.data,
        }),
      );
    } catch (e) {
      console.error("[ScreenDecoder] Decode error:", e);
      // Reset on decode error — wait for next keyframe
      this.receivedKeyframe = false;
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
