import { create } from "zustand";
import { WsOpcode } from "@migo/shared";
import type { VoiceState, VoiceChannelUser } from "@migo/shared";
import { livekitManager } from "@/lib/livekit";
import { wsManager } from "@/lib/ws";
import { voiceSignal } from "@/lib/voice-signal";
import {
  playJoinSound,
  playLeaveSound,
  playMuteSound,
  playUnmuteSound,
  playDeafenSound,
  playUndeafenSound,
} from "@/lib/sounds";
import { useAuthStore } from "./auth";
import { useMemberStore } from "./members";
import { useAnnotationStore } from "./annotation";
import { createScreenShareActions } from "./voice-screen-share";

export interface VoiceStoreState {
  currentChannelId: string | null;
  currentServerId: string | null;
  /** All voice users across all channels, keyed by channelId → userId → user */
  channelUsers: Record<string, Record<string, VoiceChannelUser>>;
  isMuted: boolean;
  isDeafened: boolean;
  isConnecting: boolean;
  speakingUsers: Set<string>;
  userVolumes: Record<string, number>;

  noiseSuppression: boolean;
  toggleNoiseSuppression: () => Promise<void>;

  // Screen sharing
  isScreenSharing: boolean;
  screenShareTracks: Record<string, MediaStreamTrack>;
  focusedScreenShareUserId: string | null;
  showScreenSharePicker: boolean;
  joinedStreams: Set<string>;

  // Screen share audio volume (independent from mic volume)
  screenShareVolumes: Record<string, number>;
  screenShareMuted: Record<string, boolean>;
  setScreenShareVolume: (userId: string, volume: number) => void;
  toggleScreenShareMute: (userId: string) => void;

  // Session Mode (annotation overlay)
  isSessionMode: boolean;
  screenShareSourceId: string | null;
  screenShareSourceType: "window" | "screen" | null;
  toggleSessionMode: () => Promise<void>;

  reannounceVoiceState: () => void;
  joinChannel: (channelId: string, serverId: string) => Promise<void>;
  leaveChannel: () => void;
  toggleMute: () => void;
  toggleDeafen: () => void;
  handleVoiceStateUpdate: (state: VoiceState) => void;
  getChannelUsers: (channelId: string) => VoiceChannelUser[];
  setUserVolume: (userId: string, volume: number) => void;
  toggleScreenShare: () => void;
  startScreenShare: (target: { type: string; id: number }) => Promise<void>;
  stopScreenShare: () => void;
  clipScreenShare: () => Promise<void>;
  handleScreenShareStart: (data: { userId: string; channelId: string }) => void;
  handleScreenShareStop: (data: { userId: string }) => void;
  focusScreenShare: (userId: string) => void;
  unfocusScreenShare: () => void;
  joinStream: (userId: string) => void;
  unjoinStream: (userId: string) => void;
}

export const useVoiceStore = create<VoiceStoreState>()((set, get) => ({
  currentChannelId: null,
  currentServerId: null,
  channelUsers: {},
  isMuted: false,
  isDeafened: false,
  isConnecting: false,
  speakingUsers: new Set<string>(),
  userVolumes: {},
  noiseSuppression: localStorage.getItem("migo-noise-suppression") !== "false",
  isScreenSharing: false,
  screenShareTracks: {},
  focusedScreenShareUserId: null,
  showScreenSharePicker: false,
  joinedStreams: new Set<string>(),
  screenShareVolumes: {},
  screenShareMuted: {},
  isSessionMode: false,
  screenShareSourceId: null,
  screenShareSourceType: null,

  toggleNoiseSuppression: async () => {
    const newValue = !get().noiseSuppression;
    set({ noiseSuppression: newValue });
    localStorage.setItem("migo-noise-suppression", String(newValue));

    if (get().currentChannelId) {
      try {
        await livekitManager.setAudioProcessing(newValue);
      } catch (err) {
        console.error("Failed to toggle noise suppression:", err);
      }
    }
  },

  reannounceVoiceState: () => {
    const { currentChannelId, currentServerId, isMuted, isDeafened } = get();
    if (!currentChannelId || !currentServerId) return;

    // Re-send voice state so the server re-registers us after a reconnect
    wsManager.send({
      op: WsOpcode.VOICE_STATE_UPDATE,
      d: {
        channelId: currentChannelId,
        serverId: currentServerId,
        muted: isMuted,
        deafened: isDeafened,
      },
    });
  },

  joinChannel: async (channelId, serverId) => {
    const { currentChannelId } = get();
    if (currentChannelId === channelId) return;

    // If already in a channel, leave first
    if (currentChannelId) {
      get().leaveChannel();
    }

    set({
      isConnecting: true,
      currentChannelId: channelId,
      currentServerId: serverId,
    });

    // Set up LiveKit callbacks (voice/audio only)
    livekitManager.setSpeakingCallback((speakers) => {
      set({ speakingUsers: speakers });
    });

    // Set up screen track callback so remote screen shares arrive via LiveKit
    livekitManager.setScreenTrackCallback(
      (participantIdentity, track, action) => {
        if (action === "add") {
          set((s) => ({
            screenShareTracks: {
              ...s.screenShareTracks,
              [participantIdentity]: track,
            },
          }));
        } else {
          set((s) => {
            const screenShareTracks = { ...s.screenShareTracks };
            delete screenShareTracks[participantIdentity];
            return { screenShareTracks };
          });
        }
      },
    );

    try {
      // 1. Send VOICE_STATE_UPDATE to register with server
      wsManager.send({
        op: WsOpcode.VOICE_STATE_UPDATE,
        d: { channelId, serverId },
      });

      // 2. Request LiveKit credentials
      const credentials = await voiceSignal("joinVoice", {
        channelId,
        serverId,
      });

      // 3. Connect to LiveKit room
      await livekitManager.connect(credentials.token, credentials.url);

      // 4. Enable mic
      await livekitManager.setMicEnabled(true);

      // 5. Restore saved device preferences
      const savedInput = localStorage.getItem("migo-input-device");
      const savedOutput = localStorage.getItem("migo-output-device");
      if (savedInput) livekitManager.setInputDevice(savedInput);
      if (savedOutput) livekitManager.setOutputDevice(savedOutput);

      // 6. Apply noise suppression if enabled
      if (get().noiseSuppression) {
        await livekitManager.setAudioProcessing(true).catch(() => {});
      }

      set({ isConnecting: false });
      playJoinSound();
    } catch (err) {
      console.error("Failed to join voice channel:", err);
      set({
        isConnecting: false,
        currentChannelId: null,
        currentServerId: null,
      });
      livekitManager.setSpeakingCallback(null);
      livekitManager.setScreenTrackCallback(null);
    }
  },

  leaveChannel: () => {
    const { currentChannelId, isSessionMode } = get();

    // End annotation session if active
    if (isSessionMode) {
      const annotationStore = useAnnotationStore.getState();
      annotationStore.sendEvent({ type: "sessionEnd" });
      annotationStore.endSession();
      window.overlayBridgeAPI?.destroy().catch(() => {});
    }

    // Stop browser screen share if active + unregister clip shortcut (Electron only)
    window.screenAPI?.unregisterClipShortcut().catch(() => {});
    livekitManager.stopScreenShare().catch(() => {});

    livekitManager.disconnect();
    livekitManager.setSpeakingCallback(null);
    livekitManager.setScreenTrackCallback(null);

    // Tell server we left
    wsManager.send({
      op: WsOpcode.VOICE_STATE_UPDATE,
      d: { channelId: null, serverId: "" },
    });

    // Immediately remove self from channelUsers so the UI updates
    const userId = useAuthStore.getState().user?.id;
    if (userId && currentChannelId) {
      set((s) => {
        const channelUsers = { ...s.channelUsers };
        if (channelUsers[currentChannelId]?.[userId]) {
          const updated = { ...channelUsers[currentChannelId] };
          delete updated[userId];
          if (Object.keys(updated).length === 0) {
            delete channelUsers[currentChannelId];
          } else {
            channelUsers[currentChannelId] = updated;
          }
        }
        return { channelUsers };
      });
    }

    playLeaveSound();
    set({
      currentChannelId: null,
      currentServerId: null,
      isMuted: false,
      isDeafened: false,
      isConnecting: false,
      speakingUsers: new Set(),
      isScreenSharing: false,
      isSessionMode: false,
      screenShareSourceId: null,
      screenShareSourceType: null,
      screenShareTracks: {},
      focusedScreenShareUserId: null,
      showScreenSharePicker: false,
      screenShareVolumes: {},
      screenShareMuted: {},
      joinedStreams: new Set<string>(),
    });
  },

  toggleMute: () => {
    const { isMuted, isDeafened, currentChannelId, currentServerId } = get();

    // Unmuting while deafened → undeafen too
    if (isMuted && isDeafened) {
      livekitManager.setMicEnabled(true);
      livekitManager.setDeafened(false);
      playUnmuteSound();
      set({ isMuted: false, isDeafened: false });

      if (currentChannelId && currentServerId) {
        wsManager.send({
          op: WsOpcode.VOICE_STATE_UPDATE,
          d: {
            channelId: currentChannelId,
            serverId: currentServerId,
            muted: false,
            deafened: false,
          },
        });
      }
      return;
    }

    const newMuted = !isMuted;
    if (isMuted) {
      livekitManager.setMicEnabled(true);
      playUnmuteSound();
    } else {
      livekitManager.setMicEnabled(false);
      playMuteSound();
    }
    set({ isMuted: newMuted });

    if (currentChannelId && currentServerId) {
      wsManager.send({
        op: WsOpcode.VOICE_STATE_UPDATE,
        d: {
          channelId: currentChannelId,
          serverId: currentServerId,
          muted: newMuted,
          deafened: false,
        },
      });
    }
  },

  toggleDeafen: () => {
    const { isDeafened, currentChannelId, currentServerId } = get();
    const newDeafened = !isDeafened;

    // Deafening → also mute. Undeafening → also unmute.
    livekitManager.setDeafened(newDeafened);
    livekitManager.setMicEnabled(!newDeafened);
    set({ isDeafened: newDeafened, isMuted: newDeafened });

    if (newDeafened) {
      playDeafenSound();
    } else {
      playUndeafenSound();
    }

    if (currentChannelId && currentServerId) {
      wsManager.send({
        op: WsOpcode.VOICE_STATE_UPDATE,
        d: {
          channelId: currentChannelId,
          serverId: currentServerId,
          muted: newDeafened,
          deafened: newDeafened,
        },
      });
    }
  },

  handleVoiceStateUpdate: (state: VoiceState) => {
    // Play sounds for remote users joining/leaving our channel
    const { currentChannelId, isConnecting, channelUsers } = get();
    const selfId = useAuthStore.getState().user?.id;

    if (
      selfId &&
      currentChannelId &&
      !isConnecting &&
      state.userId !== selfId
    ) {
      const wasInOurChannel = !!channelUsers[currentChannelId]?.[state.userId];

      if (state.channelId === currentChannelId && !wasInOurChannel) {
        // Remote user joined our channel
        playJoinSound();
      } else if (state.channelId === null && wasInOurChannel) {
        // Remote user left our channel
        playLeaveSound();
      }
    }

    set((s) => {
      const channelUsers = { ...s.channelUsers };

      if (state.channelId === null) {
        // User left voice — remove from all channels
        for (const chId of Object.keys(channelUsers)) {
          if (channelUsers[chId]?.[state.userId]) {
            const updated = { ...channelUsers[chId] };
            delete updated[state.userId];
            if (Object.keys(updated).length === 0) {
              delete channelUsers[chId];
            } else {
              channelUsers[chId] = updated;
            }
          }
        }
      } else {
        // User joined/updated a specific channel
        // First remove from any other channel (in case they switched)
        for (const chId of Object.keys(channelUsers)) {
          if (chId !== state.channelId && channelUsers[chId]?.[state.userId]) {
            const updated = { ...channelUsers[chId] };
            delete updated[state.userId];
            if (Object.keys(updated).length === 0) {
              delete channelUsers[chId];
            } else {
              channelUsers[chId] = updated;
            }
          }
        }

        // Get user info from the broadcast data, existing data, or member store
        const existing = channelUsers[state.channelId]?.[state.userId];
        let username = state.username || existing?.username || "";
        let displayName = state.displayName || existing?.displayName || "";
        let avatarUrl = state.avatarUrl ?? existing?.avatarUrl ?? null;

        if (!username) {
          const members = useMemberStore.getState().members;
          const member = members.find((m) => m.user.id === state.userId);
          if (member) {
            username = member.user.username;
            displayName = member.user.displayName;
            avatarUrl = member.user.avatarUrl ?? null;
          }
        }

        if (!channelUsers[state.channelId]) {
          channelUsers[state.channelId] = {};
        }
        channelUsers[state.channelId] = {
          ...channelUsers[state.channelId],
          [state.userId]: {
            userId: state.userId,
            username,
            displayName,
            avatarUrl,
            muted: state.muted,
            deafened: state.deafened,
            speaking: existing?.speaking ?? false,
            screenSharing:
              state.screenSharing ?? existing?.screenSharing ?? false,
          },
        };
      }

      return { channelUsers };
    });
  },

  getChannelUsers: (channelId: string): VoiceChannelUser[] => {
    const channel = get().channelUsers[channelId];
    return channel ? Object.values(channel) : [];
  },

  setUserVolume: (userId, volume) => {
    livekitManager.setUserVolume(userId, volume);
    set((s) => ({
      userVolumes: { ...s.userVolumes, [userId]: volume },
    }));
    // Persist to localStorage
    try {
      const stored = JSON.parse(
        localStorage.getItem("migo-user-volumes") || "{}",
      );
      stored[userId] = volume;
      localStorage.setItem("migo-user-volumes", JSON.stringify(stored));
    } catch {}
  },

  setScreenShareVolume: (userId, volume) => {
    livekitManager.setScreenShareVolume(userId, volume);
    set((s) => ({
      screenShareVolumes: { ...s.screenShareVolumes, [userId]: volume },
    }));
    try {
      const stored = JSON.parse(
        localStorage.getItem("migo-screen-share-volumes") || "{}",
      );
      stored[userId] = volume;
      localStorage.setItem("migo-screen-share-volumes", JSON.stringify(stored));
    } catch {}
  },

  toggleScreenShareMute: (userId) => {
    const current = get().screenShareMuted[userId] ?? false;
    const newMuted = !current;
    livekitManager.setScreenShareMuted(userId, newMuted);
    set((s) => ({
      screenShareMuted: { ...s.screenShareMuted, [userId]: newMuted },
    }));
  },

  ...createScreenShareActions(set, get),

  focusScreenShare: (userId: string) => {
    set({ focusedScreenShareUserId: userId });
  },

  unfocusScreenShare: () => {
    set({ focusedScreenShareUserId: null });
  },

  joinStream: (userId: string) => {
    const joined = new Set(get().joinedStreams);
    joined.add(userId);
    livekitManager.joinedStreams.add(userId);

    // Local user rejoining their own stream — re-add the local track
    const selfId = useAuthStore.getState().user?.id;
    if (userId === selfId && get().isScreenSharing) {
      const localTrack = livekitManager.getLocalScreenShareTrack();
      if (localTrack) {
        set((s) => ({
          joinedStreams: joined,
          screenShareTracks: { ...s.screenShareTracks, [userId]: localTrack },
        }));
        return;
      }
    }

    set({ joinedStreams: joined });
    livekitManager.subscribeScreenShare(userId);
  },

  unjoinStream: (userId: string) => {
    const joined = new Set(get().joinedStreams);
    joined.delete(userId);
    livekitManager.unsubscribeScreenShare(userId);
    set((s) => {
      const screenShareTracks = { ...s.screenShareTracks };
      delete screenShareTracks[userId];
      return {
        joinedStreams: joined,
        screenShareTracks,
        focusedScreenShareUserId:
          s.focusedScreenShareUserId === userId
            ? null
            : s.focusedScreenShareUserId,
      };
    });
  },
}));
