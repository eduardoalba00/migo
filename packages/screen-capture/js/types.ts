export interface CaptureSource {
  id: string;
  name: string;
  isScreen: boolean;
  thumbnail: Buffer | null;
  width: number | null;
  height: number | null;
}

export interface CaptureOptions {
  sourceId: string;
  maxWidth?: number;
  maxHeight?: number;
  maxFrameRate?: number;
}

export const CapturePresets = {
  "1080p60": { maxWidth: 1920, maxHeight: 1080, maxFrameRate: 60 },
  "1440p60": { maxWidth: 2560, maxHeight: 1440, maxFrameRate: 60 },
  "4k30": { maxWidth: 3840, maxHeight: 2160, maxFrameRate: 30 },
} as const;

export type CapturePreset = keyof typeof CapturePresets;
