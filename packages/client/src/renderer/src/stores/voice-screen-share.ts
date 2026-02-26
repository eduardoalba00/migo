import { nanoid } from "nanoid";
import { livekitManager } from "@/lib/livekit";
import { voiceSignal } from "@/lib/voice-signal";
import {
  playScreenShareStartSound,
  playScreenShareStopSound,
  playClipSound,
} from "@/lib/sounds";
import { useAuthStore } from "./auth";
import { useAnnotationStore } from "./annotation";
import { useChannelStore } from "./channels";
import { useMessageStore } from "./messages";
import { api } from "@/lib/api";
import { UPLOAD_ROUTES } from "@migo/shared";
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
          await window.overlayBridgeAPI.destroy();
        } catch {}
        set({ isSessionMode: false });
      } else {
        const sessionId = nanoid();

        // Create overlay window on the shared display (best-effort)
        if (screenShareSourceId) {
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
        const sourceId = await window.screenAPI.selectSource(
          target.type,
          target.id,
        );
        if (!sourceId) throw new Error("No source selected");

        // Map picker type to audio capture source type
        const sourceType: "window" | "screen" =
          target.type === "window" ? "window" : "screen";

        // Use LiveKit SDK's setScreenShareEnabled which calls getDisplayMedia()
        // internally. Chrome's full WebRTC pipeline handles encoding, FEC,
        // congestion control, and NACK (tested at 55fps 1440p).
        // Also starts WASAPI process audio capture if available.
        await livekitManager.startScreenShare(sourceId, sourceType);

        // Register clip shortcut (Ctrl+Shift+C)
        window.screenAPI.registerClipShortcut().catch(() => {});

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

    clipScreenShare: async () => {
      const { isScreenSharing, currentServerId } = get();
      if (!isScreenSharing || !currentServerId) {
        console.warn("[clip] Not screen sharing or no server");
        return;
      }

      const replayBuffer = livekitManager.getReplayBuffer();
      if (!replayBuffer || !replayBuffer.isRecording) {
        console.warn("[clip] Replay buffer not active");
        return;
      }

      try {
        console.log("[clip] Flushing replay buffer...");
        const blob = await replayBuffer.flush();
        if (blob.size === 0) {
          console.warn("[clip] Empty clip, nothing to upload");
          return;
        }

        console.log(
          `[clip] Got ${(blob.size / 1024 / 1024).toFixed(1)}MB clip`,
        );

        // Find the "clips" system channel in the current server
        const channelList = useChannelStore.getState().channelList;
        if (!channelList) {
          console.warn("[clip] No channel list loaded");
          return;
        }

        // Search for the "clips" channel (uncategorized first, then categories)
        let targetChannelId: string | null = null;
        for (const ch of channelList.uncategorized) {
          if (ch.name === "clips" && ch.type === "text") {
            targetChannelId = ch.id;
            break;
          }
        }
        if (!targetChannelId) {
          for (const cat of channelList.categories) {
            for (const ch of cat.channels) {
              if (ch.name === "clips" && ch.type === "text") {
                targetChannelId = ch.id;
                break;
              }
            }
            if (targetChannelId) break;
          }
        }

        if (!targetChannelId) {
          console.warn("[clip] No clips channel found in server");
          return;
        }

        // Upload the clip as an attachment
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const filename = `clip-${timestamp}.webm`;
        const file = new File([blob], filename, { type: blob.type });

        const formData = new FormData();
        formData.append("file", file);
        formData.append("type", "attachments");

        const uploadResult = await api.upload<{ id: string; url: string }>(
          UPLOAD_ROUTES.UPLOAD,
          formData,
        );

        // Send message with the clip attachment
        await useMessageStore
          .getState()
          .sendMessage(targetChannelId, "🎬 Screen clip", undefined, [
            uploadResult.id,
          ]);

        console.log("[clip] Clip uploaded and sent successfully");

        // Play clip success sound + show desktop overlay
        playClipSound();
        window.screenAPI.showClipNotification().catch(() => {});
      } catch (err) {
        console.error("[clip] Failed to clip screen share:", err);
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

      // Unregister clip shortcut
      window.screenAPI.unregisterClipShortcut().catch(() => {});

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
