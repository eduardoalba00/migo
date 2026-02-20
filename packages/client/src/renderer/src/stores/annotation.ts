import { create } from "zustand";
import type { AnnotationEvent, AnnotationTool } from "@migo/shared";
import { ANNOTATION_COLORS } from "@migo/shared";
import { AnnotationState } from "@/lib/annotation/state";
import { AnnotationDataChannel } from "@/lib/annotation/data-channel";
import { livekitManager } from "@/lib/livekit";
import { useAuthStore } from "./auth";

/** Strip base fields from each union member (preserves discriminated union) */
type AnnotationEventPayload = {
  [K in AnnotationEvent["type"]]: Omit<
    Extract<AnnotationEvent, { type: K }>,
    "sessionId" | "senderId" | "senderName" | "t" | "color"
  >;
}[AnnotationEvent["type"]];

/** Event types that bypass the isAnnotating guard */
const ALWAYS_ALLOWED = new Set(["cursor", "sessionStart", "sessionEnd", "sessionQuery", "clearAll"]);

interface AnnotationStoreState {
  activeSessionId: string | null;
  isSessionMode: boolean;
  isAnnotating: boolean;
  sessionStartMs: number;
  activeTool: AnnotationTool;
  lineWidth: number;
  participantColors: Record<string, string>;
  myColor: string;
  activeColor: string;
  annotationState: AnnotationState;
  dataChannel: AnnotationDataChannel | null;

  startSession: (sessionId: string) => void;
  endSession: () => void;
  toggleAnnotating: () => void;
  setActiveTool: (tool: AnnotationTool) => void;
  setActiveColor: (color: string) => void;
  sendEvent: (partial: AnnotationEventPayload) => void;
  assignColor: (userId: string) => string;
}

// Shared instance — survives store re-renders
const annotationState = new AnnotationState();

export const useAnnotationStore = create<AnnotationStoreState>()((set, get) => ({
  activeSessionId: null,
  isSessionMode: false,
  isAnnotating: false,
  sessionStartMs: 0,
  activeTool: "freehand",
  lineWidth: 3,
  participantColors: {},
  myColor: ANNOTATION_COLORS[0],
  activeColor: ANNOTATION_COLORS[0],
  annotationState,
  dataChannel: null,

  startSession: (sessionId: string) => {
    const room = livekitManager.getRoom();
    if (!room) return;

    const user = useAuthStore.getState().user;
    const myColor = get().assignColor(user?.id ?? "");

    const handler = (event: AnnotationEvent) => {
      get().assignColor(event.senderId);

      if (event.type === "sessionEnd") {
        get().endSession();
        return;
      }

      // Respond to session queries from late-joining viewers
      if (event.type === "sessionQuery") {
        get().sendEvent({ type: "sessionStart" });
        return;
      }

      annotationState.apply(event);

      // Forward to overlay window if we're the sharer
      try { window.overlayBridgeAPI?.forwardEvents([event]); } catch {}
    };

    const dataChannel = new AnnotationDataChannel(room, handler);

    set({
      activeSessionId: sessionId,
      isSessionMode: true,
      sessionStartMs: Date.now(),
      dataChannel,
      myColor,
      activeColor: myColor,
    });
  },

  endSession: () => {
    get().dataChannel?.dispose();
    annotationState.reset();

    set({
      activeSessionId: null,
      isSessionMode: false,
      isAnnotating: false,
      sessionStartMs: 0,
      dataChannel: null,
    });
  },

  toggleAnnotating: () => {
    set((s) => ({ isAnnotating: !s.isAnnotating }));
  },

  setActiveTool: (tool: AnnotationTool) => {
    set({ activeTool: tool });
  },

  setActiveColor: (color: string) => {
    set({ activeColor: color });
  },

  sendEvent: (partial) => {
    const { activeSessionId, sessionStartMs, activeColor, dataChannel, isAnnotating } = get();
    if (!activeSessionId || !dataChannel) return;
    if (!isAnnotating && !ALWAYS_ALLOWED.has(partial.type)) return;

    const user = useAuthStore.getState().user;
    const event = {
      ...partial,
      sessionId: activeSessionId,
      senderId: user?.id ?? "",
      senderName: user?.displayName || user?.username || "Unknown",
      t: Date.now() - sessionStartMs,
      color: activeColor,
    } as AnnotationEvent;

    // Local echo
    annotationState.apply(event);

    // Send to peers
    dataChannel.send(event);

    // Forward to sharer's overlay
    try { window.overlayBridgeAPI?.forwardEvents([event]); } catch {}
  },

  assignColor: (userId: string) => {
    const { participantColors } = get();
    if (participantColors[userId]) return participantColors[userId];

    const idx = Object.keys(participantColors).length % ANNOTATION_COLORS.length;
    const color = ANNOTATION_COLORS[idx];
    set((s) => ({
      participantColors: { ...s.participantColors, [userId]: color },
    }));
    return color;
  },
}));
