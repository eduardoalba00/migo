export { ScreenCapture } from "./capture.js";
export { CapturePresets } from "./types.js";
export type { CaptureSource, CaptureOptions, CapturePreset } from "./types.js";

let nativeBinding: any;

try {
  nativeBinding = require("../screen-capture.node");
} catch {
  try {
    nativeBinding = require("../index.node");
  } catch {
    throw new Error(
      "@migo/screen-capture: Failed to load native addon. Run `pnpm build` in packages/screen-capture first.",
    );
  }
}

export async function listSources(): Promise<
  Array<{
    id: string;
    name: string;
    isScreen: boolean;
    thumbnail: Buffer | null;
    width: number | null;
    height: number | null;
  }>
> {
  return nativeBinding.listSources();
}
