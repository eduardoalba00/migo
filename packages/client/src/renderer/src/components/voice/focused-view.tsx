import { useEffect, useRef, useState } from "react";
import { Maximize2, Minimize2, ArrowLeft, Volume2, VolumeX } from "lucide-react";
import { RoomEvent } from "livekit-client";
import { useVoiceStore } from "@/stores/voice";
import { useAuthStore } from "@/stores/auth";
import { useAnnotationStore } from "@/stores/annotation";
import { livekitManager } from "@/lib/livekit";
import { ViewerCanvasOverlay } from "@/components/annotation/viewer-canvas-overlay";
import { AnnotationToolbar } from "@/components/annotation/annotation-toolbar";
import { StatsOverlay } from "./video-stats";
import type { AnnotationEvent } from "@migo/shared";

export interface FocusedViewProps {
  containerRef: React.RefObject<HTMLDivElement | null>;
  track: MediaStreamTrack;
  sharerName: string;
  sharerUserId: string;
  showBackButton: boolean;
  onBack: () => void;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
}

export function FocusedView({
  containerRef,
  track,
  sharerName,
  sharerUserId,
  showBackButton,
  onBack,
  isFullscreen,
  onToggleFullscreen,
}: FocusedViewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [hovered, setHovered] = useState(false);
  const [volumeHovered, setVolumeHovered] = useState(false);

  const screenShareVolume = useVoiceStore((s) => s.screenShareVolumes[sharerUserId] ?? 1);
  const screenShareMuted = useVoiceStore((s) => s.screenShareMuted[sharerUserId] ?? false);
  const setScreenShareVolume = useVoiceStore((s) => s.setScreenShareVolume);
  const toggleScreenShareMute = useVoiceStore((s) => s.toggleScreenShareMute);

  // Session mode (sharer controls)
  const isLocalUserSharing = useVoiceStore((s) => s.isScreenSharing);
  const selfId = useAuthStore((s) => s.user?.id);
  const isSharer = selfId === sharerUserId && isLocalUserSharing;
  const isSessionMode = useVoiceStore((s) => s.isSessionMode);
  const toggleSessionMode = useVoiceStore((s) => s.toggleSessionMode);
  const screenShareSourceType = useVoiceStore((s) => s.screenShareSourceType);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !track) return;

    const stream = new MediaStream([track]);
    video.srcObject = stream;

    return () => {
      video.srcObject = null;
    };
  }, [track]);

  // Viewer-side: listen for annotation data channel events + send sessionQuery
  useEffect(() => {
    if (isSharer) return; // Sharer manages their own session

    const room = livekitManager.getRoom();
    if (!room) return;

    const onData = (
      payload: Uint8Array,
      _participant: any,
      _kind: any,
      topic: string | undefined,
    ) => {
      if (topic !== "annotation") return;
      try {
        const events: AnnotationEvent[] = JSON.parse(new TextDecoder().decode(payload));
        for (const event of events) {
          const store = useAnnotationStore.getState();

          if (event.type === "sessionEnd") {
            if (store.activeSessionId) store.endSession();
            return;
          }

          // Auto-join session on any annotation event
          if (!store.activeSessionId && event.sessionId) {
            store.startSession(event.sessionId);
            // Auto-enable annotating so toolbar is immediately active
            if (!useAnnotationStore.getState().isAnnotating) {
              useAnnotationStore.getState().toggleAnnotating();
            }
          }
        }
      } catch {}
    };

    room.on(RoomEvent.DataReceived, onData);

    // Send sessionQuery so the sharer responds with sessionStart if active
    const user = useAuthStore.getState().user;
    const query: AnnotationEvent = {
      type: "sessionQuery",
      sessionId: "",
      senderId: user?.id ?? "",
      senderName: user?.displayName || user?.username || "",
      t: 0,
      color: "",
    };
    const data = new TextEncoder().encode(JSON.stringify([query]));
    room.localParticipant
      .publishData(data, { reliable: true, topic: "annotation" })
      .catch(() => {});

    return () => {
      room.off(RoomEvent.DataReceived, onData);
      const store = useAnnotationStore.getState();
      if (store.activeSessionId) {
        store.endSession();
      }
    };
  }, [isSharer]);

  return (
    <div
      ref={containerRef}
      className="relative flex-1 min-h-0 bg-black flex items-center justify-center"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        className="w-full h-full object-contain"
      />
      <ViewerCanvasOverlay videoRef={videoRef} />
      <div className="absolute top-3 left-3 flex items-center gap-2">
        {showBackButton && (
          <button
            onClick={onBack}
            className="bg-black/60 hover:bg-black/80 text-white p-2 rounded-md transition-colors"
            title="Back to grid"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
        )}
        <div className="bg-black/60 text-white text-sm font-semibold px-3 py-1.5 rounded-md">
          {sharerName} is sharing their screen
        </div>
      </div>
      <div className="absolute top-3 right-3 flex items-center gap-1.5" style={{ zIndex: 20 }}>
        <StatsOverlay videoRef={videoRef} />
        {isSharer && screenShareSourceType === "screen" && (
          <button
            onClick={toggleSessionMode}
            className={`text-sm font-semibold px-3 py-1.5 rounded-md transition-colors ${
              isSessionMode
                ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                : "bg-primary text-primary-foreground hover:bg-primary/90"
            }`}
            title={isSessionMode ? "End Session Mode" : "Start Session Mode (enables annotations)"}
          >
            {isSessionMode ? "End Session" : "Start Session"}
          </button>
        )}
        <button
          onClick={onToggleFullscreen}
          className="bg-black/60 hover:bg-black/80 text-white p-2 rounded-md transition-colors"
          title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
        >
          {isFullscreen ? <Minimize2 className="h-5 w-5" /> : <Maximize2 className="h-5 w-5" />}
        </button>
      </div>
      {/* Bottom bar: annotation toolbar + volume */}
      <div
        className={`absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 transition-opacity duration-200 ${
          hovered ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        style={{ zIndex: 20 }}
      >
        <AnnotationToolbar />
        {/* Volume control — hover zone wraps both icon and slider popup */}
        <div
          className="relative flex flex-col items-center"
          onMouseEnter={() => setVolumeHovered(true)}
          onMouseLeave={() => setVolumeHovered(false)}
        >
          {/* Vertical slider popup — appears above icon on hover */}
          <div
            className={`absolute bottom-full mb-0 flex flex-col items-center gap-1.5 bg-black/90 backdrop-blur-sm rounded-lg px-2 py-2.5 border border-white/10 transition-opacity duration-150 ${
              volumeHovered ? "opacity-100" : "opacity-0 pointer-events-none"
            }`}
          >
            <span className="text-white text-xs tabular-nums">
              {Math.round(screenShareVolume * 100)}%
            </span>
            <input
              type="range"
              min={0}
              max={100}
              value={screenShareMuted ? 0 : Math.round(screenShareVolume * 100)}
              onChange={(e) => {
                const vol = Number(e.target.value) / 100;
                setScreenShareVolume(sharerUserId, vol);
                if (screenShareMuted && vol > 0) {
                  toggleScreenShareMute(sharerUserId);
                }
              }}
              title={`${Math.round(screenShareVolume * 100)}%`}
              style={{
                writingMode: "vertical-lr",
                direction: "rtl",
                height: "6rem",
                width: "1.25rem",
                accentColor: "white",
              }}
            />
          </div>
          <button
            onClick={() => toggleScreenShareMute(sharerUserId)}
            className="bg-black/70 backdrop-blur-sm rounded-lg p-2.5 text-white hover:bg-black/80 transition-colors"
            title={screenShareMuted ? "Unmute stream audio" : "Mute stream audio"}
          >
            {screenShareMuted
              ? <VolumeX className="h-5 w-5" />
              : <Volume2 className="h-5 w-5" />}
          </button>
        </div>
      </div>
    </div>
  );
}
