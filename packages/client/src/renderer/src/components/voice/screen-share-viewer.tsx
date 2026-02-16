import { useEffect, useRef, useState, useCallback } from "react";
import { Maximize2, Minimize2, ArrowLeft } from "lucide-react";
import { useVoiceStore } from "@/stores/voice";

function useTrackStats(track: MediaStreamTrack) {
  const [stats, setStats] = useState<{ width: number; height: number; fps: number } | null>(null);

  useEffect(() => {
    const update = () => {
      const s = track.getSettings();
      if (s.width && s.height) {
        setStats({ width: s.width, height: s.height, fps: s.frameRate ?? 0 });
      }
    };
    // Settings may not be available immediately on remote tracks
    update();
    const id = setInterval(update, 2000);
    return () => clearInterval(id);
  }, [track]);

  return stats;
}

function StatsOverlay({ track, className }: { track: MediaStreamTrack; className?: string }) {
  const stats = useTrackStats(track);
  if (!stats) return null;

  return (
    <div className={`bg-black/60 text-white text-xs font-medium px-2 py-1 rounded ${className ?? ""}`}>
      {stats.width}x{stats.height}{stats.fps ? ` ${Math.round(stats.fps)}fps` : ""}
    </div>
  );
}

interface ScreenShareTileProps {
  track: MediaStreamTrack;
  sharerName: string;
  onClick?: () => void;
  showClickHint?: boolean;
}

function ScreenShareTile({ track, sharerName, onClick, showClickHint }: ScreenShareTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !track) return;

    const stream = new MediaStream([track]);
    video.srcObject = stream;

    return () => {
      video.srcObject = null;
    };
  }, [track]);

  return (
    <div
      className={`relative bg-black flex items-center justify-center overflow-hidden ${
        onClick ? "cursor-pointer hover:ring-2 hover:ring-primary/50 transition-shadow" : ""
      }`}
      onClick={onClick}
    >
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        className="w-full h-full object-contain"
      />
      <div className="absolute top-2 left-2 bg-black/60 text-white text-xs font-medium px-2 py-1 rounded">
        {sharerName}
      </div>
      <StatsOverlay track={track} className="absolute top-2 right-2" />
      {showClickHint && (
        <div className="absolute inset-0 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity bg-black/20">
          <span className="bg-black/70 text-white text-sm px-3 py-1.5 rounded-md">
            Click to focus
          </span>
        </div>
      )}
    </div>
  );
}

interface FocusedViewProps {
  containerRef: React.RefObject<HTMLDivElement | null>;
  track: MediaStreamTrack;
  sharerName: string;
  showBackButton: boolean;
  onBack: () => void;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
}

function FocusedView({
  containerRef,
  track,
  sharerName,
  showBackButton,
  onBack,
  isFullscreen,
  onToggleFullscreen,
}: FocusedViewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !track) return;

    const stream = new MediaStream([track]);
    video.srcObject = stream;

    return () => {
      video.srcObject = null;
    };
  }, [track]);

  return (
    <div ref={containerRef} className="relative flex-1 bg-black flex items-center justify-center">
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        className="w-full h-full object-contain"
      />
      <div className="absolute top-3 left-3 flex items-center gap-2">
        {showBackButton && (
          <button
            onClick={onBack}
            className="bg-black/60 hover:bg-black/80 text-white p-1.5 rounded transition-colors"
            title="Back to grid"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
        )}
        <div className="bg-black/60 text-white text-xs font-medium px-2 py-1 rounded">
          {sharerName} is sharing their screen
        </div>
      </div>
      <div className="absolute top-3 right-3 flex items-center gap-1">
        <StatsOverlay track={track} />
        <button
          onClick={onToggleFullscreen}
          className="bg-black/60 hover:bg-black/80 text-white p-1.5 rounded transition-colors"
          title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
        >
          {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}

interface ScreenShareViewerProps {
  tracks: Record<string, MediaStreamTrack>;
  getUserName: (userId: string) => string;
}

export function ScreenShareViewer({ tracks, getUserName }: ScreenShareViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const focusedUserId = useVoiceStore((s) => s.focusedScreenShareUserId);
  const focusScreenShare = useVoiceStore((s) => s.focusScreenShare);
  const unfocusScreenShare = useVoiceStore((s) => s.unfocusScreenShare);

  const userIds = Object.keys(tracks);
  const focusedTrack = focusedUserId ? tracks[focusedUserId] : null;

  // If focused user's track is gone, unfocus
  useEffect(() => {
    if (focusedUserId && !tracks[focusedUserId]) {
      unfocusScreenShare();
    }
  }, [focusedUserId, tracks, unfocusScreenShare]);

  // Escape to unfocus
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && focusedUserId) {
        if (document.fullscreenElement) {
          document.exitFullscreen();
        } else {
          unfocusScreenShare();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [focusedUserId, unfocusScreenShare]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (!containerRef.current) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      containerRef.current.requestFullscreen();
    }
  }, []);

  // Auto-focus when there's only one share
  const effectiveFocusedUserId =
    userIds.length === 1 ? userIds[0] : focusedUserId;
  const effectiveFocusedTrack =
    userIds.length === 1 ? tracks[userIds[0]] : focusedTrack;

  // Focused mode
  if (effectiveFocusedUserId && effectiveFocusedTrack) {
    return (
      <FocusedView
        containerRef={containerRef}
        track={effectiveFocusedTrack}
        sharerName={getUserName(effectiveFocusedUserId)}
        showBackButton={userIds.length > 1}
        onBack={unfocusScreenShare}
        isFullscreen={isFullscreen}
        onToggleFullscreen={toggleFullscreen}
      />
    );
  }

  // Grid mode
  const gridClass =
    userIds.length === 2
      ? "grid-cols-2 grid-rows-1"
      : "grid-cols-2 grid-rows-2";

  return (
    <div ref={containerRef} className={`flex-1 grid ${gridClass} gap-1 bg-zinc-900 p-1`}>
      {userIds.map((userId) => (
        <ScreenShareTile
          key={userId}
          track={tracks[userId]}
          sharerName={getUserName(userId)}
          onClick={() => focusScreenShare(userId)}
          showClickHint
        />
      ))}
    </div>
  );
}
