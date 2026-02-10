import { create } from "zustand";
import type { VoiceState, VoiceChannelUser } from "@nexus/shared";
import { voiceManager } from "@/lib/voice";
import { playJoinSound, playLeaveSound, playMuteSound, playUnmuteSound } from "@/lib/sounds";
import { useMemberStore } from "./members";

interface VoiceStoreState {
  currentChannelId: string | null;
  currentServerId: string | null;
  /** All voice users across all channels, keyed by channelId → userId → user */
  channelUsers: Record<string, Record<string, VoiceChannelUser>>;
  isMuted: boolean;
  isDeafened: boolean;
  isConnecting: boolean;
  isSpeaking: boolean;
  userVolumes: Record<string, number>;

  // Screen sharing
  isScreenSharing: boolean;
  screenShareUserId: string | null;
  screenShareTrack: MediaStreamTrack | null;
  showScreenSharePicker: boolean;

  joinChannel: (channelId: string, serverId: string) => Promise<void>;
  leaveChannel: () => void;
  toggleMute: () => void;
  toggleDeafen: () => void;
  handleVoiceStateUpdate: (state: VoiceState) => void;
  getChannelUsers: (channelId: string) => VoiceChannelUser[];
  setUserVolume: (userId: string, volume: number) => void;
  toggleScreenShare: () => void;
  startScreenShare: (sourceId: string) => Promise<void>;
  stopScreenShare: () => void;
  handleScreenShareStart: (data: { userId: string; channelId: string }) => void;
  handleScreenShareStop: (data: { userId: string }) => void;
}

export const useVoiceStore = create<VoiceStoreState>()((set, get) => ({
  currentChannelId: null,
  currentServerId: null,
  channelUsers: {},
  isMuted: false,
  isDeafened: false,
  isConnecting: false,
  isSpeaking: false,
  userVolumes: {},
  isScreenSharing: false,
  screenShareUserId: null,
  screenShareTrack: null,
  showScreenSharePicker: false,

  joinChannel: async (channelId, serverId) => {
    const { currentChannelId } = get();
    if (currentChannelId === channelId) return;

    // If already in a channel, leave first
    if (currentChannelId) {
      get().leaveChannel();
    }

    set({ isConnecting: true, currentChannelId: channelId, currentServerId: serverId });

    // Set up speaking callback before joining
    voiceManager.setSpeakingCallback((speaking) => {
      set({ isSpeaking: speaking });
    });

    // Set up screen share callback
    voiceManager.setScreenShareCallback((userId, track) => {
      if (track) {
        set({ screenShareUserId: userId, screenShareTrack: track });
      } else {
        set({ screenShareUserId: null, screenShareTrack: null });
      }
    });

    try {
      await voiceManager.join(channelId, serverId);
      set({ isConnecting: false });
      playJoinSound();
    } catch (err) {
      console.error("Failed to join voice channel:", err);
      set({ isConnecting: false, currentChannelId: null, currentServerId: null });
      voiceManager.setSpeakingCallback(null);
    }
  },

  leaveChannel: () => {
    voiceManager.leave();
    voiceManager.setSpeakingCallback(null);
    voiceManager.setScreenShareCallback(null);
    playLeaveSound();
    set({
      currentChannelId: null,
      currentServerId: null,
      isMuted: false,
      isDeafened: false,
      isConnecting: false,
      isSpeaking: false,
      isScreenSharing: false,
      screenShareUserId: null,
      screenShareTrack: null,
      showScreenSharePicker: false,
    });
  },

  toggleMute: () => {
    const { isMuted } = get();
    if (isMuted) {
      voiceManager.unmute();
      playUnmuteSound();
    } else {
      voiceManager.mute();
      playMuteSound();
    }
    set({ isMuted: !isMuted });
  },

  toggleDeafen: () => {
    const { isDeafened } = get();
    if (isDeafened) {
      voiceManager.undeafen();
    } else {
      voiceManager.deafen();
    }
    set({ isDeafened: !isDeafened });
  },

  handleVoiceStateUpdate: (state: VoiceState) => {
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
            screenSharing: state.screenSharing ?? existing?.screenSharing ?? false,
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
    voiceManager.setUserVolume(userId, volume);
    set((s) => ({
      userVolumes: { ...s.userVolumes, [userId]: volume },
    }));
    // Persist to localStorage
    try {
      const stored = JSON.parse(localStorage.getItem("nexus-user-volumes") || "{}");
      stored[userId] = volume;
      localStorage.setItem("nexus-user-volumes", JSON.stringify(stored));
    } catch {}
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

  startScreenShare: async (sourceId: string) => {
    set({ showScreenSharePicker: false });
    try {
      await voiceManager.startScreenShare(sourceId);
      set({ isScreenSharing: true });
    } catch (err) {
      console.error("Failed to start screen share:", err);
      set({ isScreenSharing: false });
    }
  },

  stopScreenShare: () => {
    voiceManager.stopScreenShare();
    set({ isScreenSharing: false });
  },

  handleScreenShareStart: (data: { userId: string; channelId: string }) => {
    const { currentChannelId, channelUsers } = get();
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
        // If we're in the same channel, set the screen share user
        ...(currentChannelId === data.channelId ? { screenShareUserId: data.userId } : {}),
      }));
    } else if (currentChannelId === data.channelId) {
      set({ screenShareUserId: data.userId });
    }
  },

  handleScreenShareStop: (data: { userId: string }) => {
    // Remove video consumer
    voiceManager.removeVideoConsumer(data.userId);

    set((s) => {
      const updates: Partial<VoiceStoreState> = {};

      // Clear screen share user if it matches
      if (s.screenShareUserId === data.userId) {
        updates.screenShareUserId = null;
        updates.screenShareTrack = null;
      }

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
      updates.channelUsers = channelUsers;

      return updates;
    });
  },
}));
