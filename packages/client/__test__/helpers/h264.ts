/**
 * H.264 NAL unit parsing utilities for tests.
 */

/**
 * Scan a buffer for Annex B start codes and return NAL unit types.
 */
export function parseNalTypes(data: Buffer): number[] {
  const types: number[] = [];
  let i = 0;

  while (i < data.length - 3) {
    if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 0 && data[i + 3] === 1) {
      if (i + 4 < data.length) types.push(data[i + 4] & 0x1f);
      i += 4;
      continue;
    }
    if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 1) {
      if (i + 3 < data.length) types.push(data[i + 3] & 0x1f);
      i += 3;
      continue;
    }
    i++;
  }

  return types;
}

class BitReader {
  private data: Buffer;
  private byteOffset = 0;
  private bitOffset = 0;

  constructor(data: Buffer) {
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
 * Find the SPS NAL unit in an H.264 Annex B stream and extract resolution.
 */
export function parseSpsResolution(data: Buffer): { width: number; height: number } | null {
  let spsStart = -1;
  for (let i = 0; i < data.length - 4; i++) {
    let nalByte = -1;
    if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 0 && data[i + 3] === 1) {
      nalByte = i + 4;
    } else if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 1) {
      nalByte = i + 3;
    }
    if (nalByte !== -1 && nalByte < data.length && (data[nalByte] & 0x1f) === 7) {
      spsStart = nalByte + 1;
      break;
    }
  }

  if (spsStart === -1) return null;

  let spsEnd = data.length;
  for (let i = spsStart; i < data.length - 3; i++) {
    if (data[i] === 0 && data[i + 1] === 0 && (data[i + 2] === 1 || (data[i + 2] === 0 && data[i + 3] === 1))) {
      spsEnd = i;
      break;
    }
  }

  const spsData = data.subarray(spsStart, spsEnd);
  const reader = new BitReader(spsData);

  const profileIdc = reader.readBits(8);
  reader.readBits(8);
  reader.readBits(8);
  reader.readUE();

  if ([100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134].includes(profileIdc)) {
    const chromaFormatIdc = reader.readUE();
    if (chromaFormatIdc === 3) reader.readBits(1);
    reader.readUE();
    reader.readUE();
    reader.readBits(1);
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

  reader.readUE();
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

  reader.readUE();
  reader.readBits(1);

  const picWidthInMbsMinus1 = reader.readUE();
  const picHeightInMapUnitsMinus1 = reader.readUE();

  return {
    width: (picWidthInMbsMinus1 + 1) * 16,
    height: (picHeightInMapUnitsMinus1 + 1) * 16,
  };
}
