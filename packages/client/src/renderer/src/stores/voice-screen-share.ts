import { nanoid } from "nanoid";
import { livekitManager } from "@/lib/livekit";
import { voiceSignal } from "@/lib/voice-signal";
import { isElectron } from "@/lib/platform";
import {
  playScreenShareStartSound,
  playScreenShareStopSound,
} from "@/lib/sounds";
import { useAuthStore } from "./auth";
import { useAnnotationStore } from "./annotation";
import type { VoiceStoreState } from "./voice";

type Set = (
  partial:
    | Partial<VoiceStoreState>
    | ((state: VoiceStoreState) => Partial<VoiceStoreState>),
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
          await window.overlayBridgeAPI?.destroy();
        } catch {}
        set({ isSessionMode: false });
      } else {
        const sessionId = nanoid();

        // Create overlay window on the shared display (Electron only, best-effort)
        if (screenShareSourceId && window.screenAPI && window.overlayBridgeAPI) {
          try {
            const displayIndex =
              await window.screenAPI.getDisplayIndex(screenShareSourceId);
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
      } else if (isElectron) {
        // Electron: show custom source picker
        set({ showScreenSharePicker: true });
      } else {
        // Web: use browser's native getDisplayMedia picker directly
        get().startScreenShare({ type: "display", id: 0 });
      }
    },

    startScreenShare: async (target: { type: string; id: number }) => {
      set({ showScreenSharePicker: false });

      try {
        let sourceId: string | null = null;
        let sourceType: "window" | "screen" =
          target.type === "window" ? "window" : "screen";

        if (isElectron && window.screenAPI) {
          // Electron: Pre-select the source in the main process so that when
          // getDisplayMedia() is called, the handler provides the right source.
          sourceId = await window.screenAPI.selectSource(
            target.type,
            target.id,
          );
          if (!sourceId) throw new Error("No source selected");
        }

        // Use LiveKit SDK's setScreenShareEnabled which calls getDisplayMedia()
        // internally. On Electron, the handler provides the pre-selected source.
        // On web, the browser shows its native picker.
        await livekitManager.startScreenShare(sourceId ?? undefined, sourceType);

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
          // Auto-join own stream so sharer always sees it
          const joined = new Set(get().joinedStreams);
          joined.add(selfId);
          livekitManager.joinedStreams.add(selfId);
          set((s) => ({
            ...trackUpdate,
            screenShareTracks: { ...s.screenShareTracks, [selfId]: localTrack },
            focusedScreenShareUserId: selfId,
            joinedStreams: joined,
          }));
        } else {
          set(trackUpdate);
        }

        playScreenShareStartSound();
      } catch (err) {
        console.error("Failed to start screen share:", err);
        set({
          isScreenSharing: false,
          screenShareSourceId: null,
          screenShareSourceType: null,
        });
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
        const joined = new Set(s.joinedStreams);
        if (selfId) {
          joined.delete(selfId);
          livekitManager.joinedStreams.delete(selfId);
        }
        return {
          screenShareTracks,
          isScreenSharing: false,
          isSessionMode: false,
          screenShareSourceId: null,
          screenShareSourceType: null,
          joinedStreams: joined,
          focusedScreenShareUserId:
            s.focusedScreenShareUserId === selfId
              ? null
              : s.focusedScreenShareUserId,
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

      // Remove stopped user from joinedStreams
      livekitManager.joinedStreams.delete(data.userId);

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

        const joined = new Set(s.joinedStreams);
        joined.delete(data.userId);

        return {
          channelUsers,
          joinedStreams: joined,
          focusedScreenShareUserId:
            s.focusedScreenShareUserId === data.userId
              ? null
              : s.focusedScreenShareUserId,
        };
      });
    },
  };
}
