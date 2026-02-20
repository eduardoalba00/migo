import { useEffect, useState } from "react";

/**
 * Measures actual FPS + resolution from the display video element itself.
 * Uses requestVideoFrameCallback on the real video — no hidden video needed.
 */
export function useVideoStats(videoRef: React.RefObject<HTMLVideoElement | null>) {
  const [stats, setStats] = useState<{ width: number; height: number; fps: number } | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let frameCount = 0;
    let disposed = false;

    const countFrame = () => {
      if (disposed) return;
      frameCount++;
      video.requestVideoFrameCallback(countFrame);
    };
    video.requestVideoFrameCallback(countFrame);

    const id = setInterval(() => {
      const fps = frameCount;
      frameCount = 0;
      const w = video.videoWidth;
      const h = video.videoHeight;
      if (w && h) {
        setStats({ width: w, height: h, fps });
      }
    }, 1000);

    return () => {
      disposed = true;
      clearInterval(id);
    };
  }, [videoRef]);

  return stats;
}

export function StatsOverlay({
  videoRef,
  className,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  className?: string;
}) {
  const stats = useVideoStats(videoRef);
  if (!stats) return null;

  return (
    <div className={`bg-black/60 text-white text-xs font-medium px-2 py-1 rounded ${className ?? ""}`}>
      {stats.width}x{stats.height}{stats.fps ? ` ${Math.round(stats.fps)}fps` : ""}
    </div>
  );
}
