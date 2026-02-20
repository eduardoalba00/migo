import { useEffect, useRef, useState, useCallback } from "react";
import { useVoiceStore } from "@/stores/voice";
import { StatsOverlay } from "./video-stats";
import { FocusedView } from "./focused-view";

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
      className={`relative bg-black flex items-center justify-center overflow-hidden min-h-0 ${
        onClick ? "cursor-pointer hover:ring-2 hover:ring-primary/50 transition-shadow" : ""
      }`}
      onClick={onClick}
    >
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        className="max-w-full max-h-full object-contain"
      />
      <div className="absolute top-2 left-2 bg-black/60 text-white text-xs font-medium px-2 py-1 rounded">
        {sharerName}
      </div>
      <StatsOverlay videoRef={videoRef} className="absolute top-2 right-2" />
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

  // Focused mode — only when user explicitly clicks a tile
  if (focusedUserId && focusedTrack) {
    return (
      <FocusedView
        containerRef={containerRef}
        track={focusedTrack}
        sharerName={getUserName(focusedUserId)}
        sharerUserId={focusedUserId}
        showBackButton
        onBack={unfocusScreenShare}
        isFullscreen={isFullscreen}
        onToggleFullscreen={toggleFullscreen}
      />
    );
  }

  // Grid mode
  const gridClass =
    userIds.length === 1
      ? "grid-cols-1 grid-rows-1"
      : userIds.length === 2
        ? "grid-cols-2 grid-rows-1"
        : "grid-cols-2 grid-rows-2";

  return (
    <div ref={containerRef} className={`flex-1 min-h-0 grid ${gridClass} gap-1 bg-zinc-900 p-1`}>
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
