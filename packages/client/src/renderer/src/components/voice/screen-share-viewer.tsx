import { useEffect, useRef, useState, useCallback } from "react";
import { LogOut, Monitor } from "lucide-react";
import { useVoiceStore } from "@/stores/voice";
import { StatsOverlay } from "./video-stats";
import { FocusedView } from "./focused-view";

interface ScreenShareTileProps {
  track: MediaStreamTrack;
  sharerName: string;
  onClick?: () => void;
  onLeave?: () => void;
  showClickHint?: boolean;
}

function ScreenShareTile({ track, sharerName, onClick, onLeave, showClickHint }: ScreenShareTileProps) {
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
      className={`relative bg-black flex items-center justify-center overflow-hidden min-h-0 group ${
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
      {onLeave && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onLeave();
          }}
          className="absolute bottom-2 right-2 bg-black/60 hover:bg-red-600 text-white p-1.5 rounded transition-colors opacity-0 group-hover:opacity-100 z-10"
          title="Leave stream"
        >
          <LogOut className="h-4 w-4" />
        </button>
      )}
      {showClickHint && (
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/20">
          <span className="bg-black/70 text-white text-sm px-3 py-1.5 rounded-md">
            Click to focus
          </span>
        </div>
      )}
    </div>
  );
}

function UnjoinedTile({ sharerName, onClick }: { sharerName: string; onClick: () => void }) {
  return (
    <>
      <style>{`
        @keyframes uj-drift {
          0%, 100% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
        }
        @keyframes uj-ring-pulse {
          0%, 100% { box-shadow: 0 0 0 0 oklch(0.6132 0.2294 291.74 / 0.5), 0 0 20px 2px oklch(0.6132 0.2294 291.74 / 0.15); }
          50% { box-shadow: 0 0 0 6px oklch(0.6132 0.2294 291.74 / 0), 0 0 30px 6px oklch(0.6132 0.2294 291.74 / 0.25); }
        }
        @keyframes uj-shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
      `}</style>
      <div
        className="relative flex items-center justify-center overflow-hidden min-h-0 cursor-pointer group rounded-sm"
        onClick={onClick}
      >
        {/* Animated gradient background */}
        <div
          className="absolute inset-0"
          style={{
            background: "linear-gradient(135deg, oklch(0.18 0.02 280) 0%, oklch(0.22 0.06 290) 25%, oklch(0.16 0.03 260) 50%, oklch(0.24 0.08 300) 75%, oklch(0.18 0.02 270) 100%)",
            backgroundSize: "300% 300%",
            animation: "uj-drift 12s ease-in-out infinite",
          }}
        />

        {/* Subtle noise texture overlay */}
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
          }}
        />

        {/* Radial glow behind avatar on hover */}
        <div
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-48 h-48 rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-700"
          style={{
            background: "radial-gradient(circle, oklch(0.6132 0.2294 291.74 / 0.15) 0%, transparent 70%)",
          }}
        />

        {/* Content */}
        <div className="relative z-10 flex flex-col items-center gap-5">
          {/* Avatar with animated ring */}
          <div className="relative">
            <div
              className="w-20 h-20 rounded-full flex items-center justify-center text-2xl font-bold text-white"
              style={{
                background: "linear-gradient(135deg, oklch(0.35 0.08 291) 0%, oklch(0.25 0.05 270) 100%)",
                animation: "uj-ring-pulse 3s ease-in-out infinite",
              }}
            >
              {sharerName.charAt(0).toUpperCase()}
            </div>
            <div
              className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full flex items-center justify-center"
              style={{
                background: "linear-gradient(135deg, oklch(0.55 0.2 291) 0%, oklch(0.45 0.18 280) 100%)",
              }}
            >
              <Monitor className="h-3.5 w-3.5 text-white" />
            </div>
          </div>

          {/* Name */}
          <div className="flex flex-col items-center gap-1.5">
            <span className="text-base font-semibold text-white tracking-tight">
              {sharerName}
            </span>
            <span className="text-xs text-zinc-400 font-medium">
              is sharing their screen
            </span>
          </div>

          {/* Join button with shimmer */}
          <button
            className="relative overflow-hidden px-6 py-2.5 rounded-lg text-sm font-semibold text-white transition-all duration-300 group-hover:scale-105 group-hover:shadow-lg"
            style={{
              background: "linear-gradient(135deg, oklch(0.55 0.2 291) 0%, oklch(0.45 0.2 280) 100%)",
              boxShadow: "0 2px 12px oklch(0.6132 0.2294 291.74 / 0.25)",
            }}
          >
            <span className="relative z-10">Join Stream</span>
            {/* Shimmer sweep on hover */}
            <div
              className="absolute inset-0 opacity-0 group-hover:opacity-100"
              style={{
                background: "linear-gradient(90deg, transparent 0%, oklch(1 0 0 / 0.15) 50%, transparent 100%)",
                animation: "uj-shimmer 1.5s ease-in-out infinite",
              }}
            />
          </button>
        </div>
      </div>
    </>
  );
}

interface ScreenShareViewerProps {
  tracks: Record<string, MediaStreamTrack>;
  streamingUserIds: string[];
  getUserName: (userId: string) => string;
}

export function ScreenShareViewer({ tracks, streamingUserIds, getUserName }: ScreenShareViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const focusedUserId = useVoiceStore((s) => s.focusedScreenShareUserId);
  const focusScreenShare = useVoiceStore((s) => s.focusScreenShare);
  const unfocusScreenShare = useVoiceStore((s) => s.unfocusScreenShare);
  const joinStream = useVoiceStore((s) => s.joinStream);
  const unjoinStream = useVoiceStore((s) => s.unjoinStream);
  const joinedStreams = useVoiceStore((s) => s.joinedStreams);

  const focusedTrack = focusedUserId ? tracks[focusedUserId] : null;

  // If focused user stopped sharing, unfocus
  useEffect(() => {
    if (focusedUserId && !streamingUserIds.includes(focusedUserId)) {
      unfocusScreenShare();
    }
  }, [focusedUserId, streamingUserIds, unfocusScreenShare]);

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

  // Focused mode — only when user explicitly clicks a joined tile
  if (focusedUserId && focusedTrack) {
    return (
      <FocusedView
        containerRef={containerRef}
        track={focusedTrack}
        sharerName={getUserName(focusedUserId)}
        sharerUserId={focusedUserId}
        showBackButton
        onBack={unfocusScreenShare}
        onLeave={() => unjoinStream(focusedUserId)}
        isFullscreen={isFullscreen}
        onToggleFullscreen={toggleFullscreen}
      />
    );
  }

  // Grid mode — iterate over all streaming users, not just tracks
  const gridClass =
    streamingUserIds.length === 1
      ? "grid-cols-1 grid-rows-1"
      : streamingUserIds.length === 2
        ? "grid-cols-2 grid-rows-1"
        : "grid-cols-2 grid-rows-2";

  return (
    <div ref={containerRef} className={`flex-1 min-h-0 grid ${gridClass} gap-1 bg-zinc-900 p-1`}>
      {streamingUserIds.map((userId) => {
        const track = tracks[userId];
        const isJoined = joinedStreams.has(userId);

        if (isJoined && track) {
          return (
            <ScreenShareTile
              key={userId}
              track={track}
              sharerName={getUserName(userId)}
              onClick={() => focusScreenShare(userId)}
              onLeave={() => unjoinStream(userId)}
              showClickHint
            />
          );
        }

        return (
          <UnjoinedTile
            key={userId}
            sharerName={getUserName(userId)}
            onClick={() => joinStream(userId)}
          />
        );
      })}
    </div>
  );
}
