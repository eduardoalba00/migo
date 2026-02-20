/**
 * Coordinate mapping for annotation overlays.
 * Handles object-fit:contain letterboxing so annotations align with video content.
 */

export interface ContentRect {
  /** Offset from container left edge to content area */
  x: number;
  /** Offset from container top edge to content area */
  y: number;
  /** Width of the actual video content area in pixels */
  width: number;
  /** Height of the actual video content area in pixels */
  height: number;
}

/**
 * Computes the actual content area within an object-fit:contain container.
 * Accounts for letterboxing (black bars) on the sides or top/bottom.
 */
export function computeContentRect(
  containerW: number,
  containerH: number,
  videoW: number,
  videoH: number,
): ContentRect {
  if (videoW === 0 || videoH === 0 || containerW === 0 || containerH === 0) {
    return { x: 0, y: 0, width: containerW, height: containerH };
  }

  const containerAspect = containerW / containerH;
  const videoAspect = videoW / videoH;

  let width: number;
  let height: number;

  if (videoAspect > containerAspect) {
    // Video is wider than container — letterbox top/bottom
    width = containerW;
    height = containerW / videoAspect;
  } else {
    // Video is taller than container — pillarbox left/right
    height = containerH;
    width = containerH * videoAspect;
  }

  return {
    x: (containerW - width) / 2,
    y: (containerH - height) / 2,
    width,
    height,
  };
}

/**
 * Converts normalized (0..1) coordinates to pixel coordinates within the container.
 */
export function normalizedToPixel(
  nx: number,
  ny: number,
  contentRect: ContentRect,
): { px: number; py: number } {
  return {
    px: contentRect.x + nx * contentRect.width,
    py: contentRect.y + ny * contentRect.height,
  };
}

/**
 * Converts pixel coordinates to normalized (0..1) coordinates.
 * Returns null if the pixel is outside the content area (in letterbox/pillarbox).
 */
export function pixelToNormalized(
  px: number,
  py: number,
  contentRect: ContentRect,
): { nx: number; ny: number } | null {
  const nx = (px - contentRect.x) / contentRect.width;
  const ny = (py - contentRect.y) / contentRect.height;

  if (nx < 0 || nx > 1 || ny < 0 || ny > 1) return null;

  return { nx, ny };
}
