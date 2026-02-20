import { nanoid } from "nanoid";
import { livekitManager } from "@/lib/livekit";
import { voiceSignal } from "@/lib/voice-signal";
import {
  playScreenShareStartSound,
  playScreenShareStopSound,
} from "@/lib/sounds";
import { useAuthStore } from "./auth";
import { useAnnotationStore } from "./annotation";
import type { VoiceStoreState } from "./voice";

type Set = (
  partial: Partial<VoiceStoreState> | ((state: VoiceStoreState) => Partial<VoiceStoreState>),
) => void;
type Get = () => VoiceStoreState;

export function createScreenShareActions(set: Set, get: Get) {
  return {
    toggleSessionMode: async () => {
      const { isScreenSharing, isSessionMode, screenShareSourceId } = get();
      if (!isScreenSharing) return;

      const annotationStore = useAnnotationStore.getState();

      if (isSessionMode) {
        // End session
        annotationStore.sendEvent({ type: "sessionEnd" });
        annotationStore.endSession();
        try {
          await window.overlayBridgeAPI.destroy();
        } catch {}
        set({ isSessionMode: false });
      } else {
        const sessionId = nanoid();

        // Create overlay window on the shared display (best-effort)
        if (screenShareSourceId) {
          try {
            const displayIndex = await window.screenAPI.getDisplayIndex(screenShareSourceId);
            await window.overlayBridgeAPI.create(displayIndex);
          } catch {}
        }

        // Start annotation session (data channel + in-app rendering)
        annotationStore.startSession(sessionId);

        // Announce session to viewers via data channel
        annotationStore.sendEvent({ type: "sessionStart" });

        set({ isSessionMode: true });
      }
    },

    toggleScreenShare: () => {
      const { isScreenSharing, currentChannelId } = get();
      if (!currentChannelId) return;

      if (isScreenSharing) {
        get().stopScreenShare();
      } else {
        set({ showScreenSharePicker: true });
      }
    },

    startScreenShare: async (target: { type: string; id: number }) => {
      set({ showScreenSharePicker: false });

      try {
        // Pre-select the source in the main process so that when
        // getDisplayMedia() is called, the handler provides the right source.
        // Returns the desktopCapturer source ID (e.g. "window:12345:0") or null.
        const sourceId = await window.screenAPI.selectSource(target.type, target.id);
        if (!sourceId) throw new Error("No source selected");

        // Map picker type to audio capture source type
        const sourceType: "window" | "screen" =
          target.type === "window" ? "window" : "screen";

        // Use LiveKit SDK's setScreenShareEnabled which calls getDisplayMedia()
        // internally. Chrome's full WebRTC pipeline handles encoding, FEC,
        // congestion control, and NACK (tested at 55fps 1440p).
        // Also starts WASAPI process audio capture if available.
        await livekitManager.startScreenShare(sourceId, sourceType);

        // Notify server so other clients see the screen share icon
        voiceSignal("startScreenShare", {}).catch(() => {});

        // Add local screen share track so the sharer sees their own share
        const selfId = useAuthStore.getState().user?.id;
        const localTrack = livekitManager.getLocalScreenShareTrack();

        const trackUpdate: Partial<VoiceStoreState> = {
          isScreenSharing: true,
          screenShareSourceId: sourceId,
          screenShareSourceType: sourceType,
        };

        if (selfId && localTrack) {
          set((s) => ({
            ...trackUpdate,
            screenShareTracks: { ...s.screenShareTracks, [selfId]: localTrack },
            focusedScreenShareUserId: selfId,
          }));
        } else {
          set(trackUpdate);
        }

        playScreenShareStartSound();
      } catch (err) {
        console.error("Failed to start screen share:", err);
        set({ isScreenSharing: false, screenShareSourceId: null, screenShareSourceType: null });
      }
    },

    stopScreenShare: () => {
      // End annotation session if active
      const { isSessionMode } = get();
      if (isSessionMode) {
        const annotationStore = useAnnotationStore.getState();
        annotationStore.sendEvent({ type: "sessionEnd" });
        annotationStore.endSession();
        window.overlayBridgeAPI?.destroy().catch(() => {});
      }

      livekitManager.stopScreenShare().catch(() => {});

      // Remove local track from screenShareTracks
      const selfId = useAuthStore.getState().user?.id;

      playScreenShareStopSound();
      set((s) => {
        const screenShareTracks = { ...s.screenShareTracks };
        if (selfId) delete screenShareTracks[selfId];
        return {
          screenShareTracks,
          isScreenSharing: false,
          isSessionMode: false,
          screenShareSourceId: null,
          screenShareSourceType: null,
          focusedScreenShareUserId:
            s.focusedScreenShareUserId === selfId ? null : s.focusedScreenShareUserId,
        };
      });

      // Notify server
      voiceSignal("stopScreenShare", {}).catch(() => {});
    },

    handleScreenShareStart: (data: { userId: string; channelId: string }) => {
      const selfId = useAuthStore.getState().user?.id;
      if (data.userId !== selfId) {
        playScreenShareStartSound();
        // Default new screen share audio to muted — user opts in manually
        livekitManager.setScreenShareMuted(data.userId, true);
        set((s) => ({
          screenShareMuted: { ...s.screenShareMuted, [data.userId]: true },
        }));
      }

      const { channelUsers } = get();

      // Update the user's screenSharing status
      if (data.channelId && channelUsers[data.channelId]?.[data.userId]) {
        set((s) => ({
          channelUsers: {
            ...s.channelUsers,
            [data.channelId]: {
              ...s.channelUsers[data.channelId],
              [data.userId]: {
                ...s.channelUsers[data.channelId][data.userId],
                screenSharing: true,
              },
            },
          },
        }));
      }
      // LiveKit TrackSubscribed handles track arrival automatically
    },

    handleScreenShareStop: (data: { userId: string }) => {
      const selfId = useAuthStore.getState().user?.id;
      if (data.userId !== selfId) {
        playScreenShareStopSound();
      }

      // Track cleanup is handled by LiveKit TrackUnsubscribed automatically

      set((s) => {
        // Update channelUsers to clear screenSharing flag
        const channelUsers = { ...s.channelUsers };
        for (const chId of Object.keys(channelUsers)) {
          if (channelUsers[chId]?.[data.userId]) {
            channelUsers[chId] = {
              ...channelUsers[chId],
              [data.userId]: {
                ...channelUsers[chId][data.userId],
                screenSharing: false,
              },
            };
          }
        }

        return {
          channelUsers,
          focusedScreenShareUserId:
            s.focusedScreenShareUserId === data.userId
              ? null
              : s.focusedScreenShareUserId,
        };
      });
    },
  };
}
