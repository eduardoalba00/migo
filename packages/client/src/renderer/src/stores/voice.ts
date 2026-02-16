import { create } from "zustand";
import { WsOpcode } from "@migo/shared";
import type { CapturePreset } from "@/lib/screen-capture";
import type { VoiceState, VoiceChannelUser } from "@migo/shared";
import { livekitManager } from "@/lib/livekit";
import { ScreenShareManager } from "@/lib/screen-share";
import { wsManager } from "@/lib/ws";
import { playJoinSound, playLeaveSound, playMuteSound, playUnmuteSound } from "@/lib/sounds";
import { useAuthStore } from "./auth";
import { useMemberStore } from "./members";

interface VoiceStoreState {
  currentChannelId: string | null;
  currentServerId: string | null;
  /** All voice users across all channels, keyed by channelId → userId → user */
  channelUsers: Record<string, Record<string, VoiceChannelUser>>;
  isMuted: boolean;
  isDeafened: boolean;
  isConnecting: boolean;
  speakingUsers: Set<string>;
  userVolumes: Record<string, number>;

  // Screen sharing
  isScreenSharing: boolean;
  screenShareTracks: Record<string, MediaStreamTrack>;
  focusedScreenShareUserId: string | null;
  showScreenSharePicker: boolean;

  joinChannel: (channelId: string, serverId: string) => Promise<void>;
  leaveChannel: () => void;
  toggleMute: () => void;
  toggleDeafen: () => void;
  handleVoiceStateUpdate: (state: VoiceState) => void;
  getChannelUsers: (channelId: string) => VoiceChannelUser[];
  setUserVolume: (userId: string, volume: number) => void;
  toggleScreenShare: () => void;
  startScreenShare: (sourceId: string, preset?: CapturePreset) => Promise<void>;
  stopScreenShare: () => void;
  handleScreenShareStart: (data: { userId: string; channelId: string; producerId?: string }) => void;
  handleScreenShareStop: (data: { userId: string }) => void;
  focusScreenShare: (userId: string) => void;
  unfocusScreenShare: () => void;
}

// Helper to signal the server and wait for a response
function voiceSignal(action: string, data?: any): Promise<any> {
  const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  return new Promise((resolve, reject) => {
    const handler = (msg: any) => {
      if (msg.d?.requestId === requestId) {
        wsManager.setVoiceSignalHandler(originalHandler);
        if (msg.d.error) {
          reject(new Error(msg.d.error));
        } else {
          resolve(msg.d.data);
        }
      }
    };

    const originalHandler = (wsManager as any).voiceSignalHandler;
    const wrappedHandler = (msg: any) => {
      handler(msg);
      originalHandler?.(msg);
    };
    wsManager.setVoiceSignalHandler(wrappedHandler);

    wsManager.send({
      op: WsOpcode.VOICE_SIGNAL,
      d: { requestId, action, data },
    });

    setTimeout(() => {
      wsManager.setVoiceSignalHandler(originalHandler);
      reject(new Error(`Voice signal timeout: ${action}`));
    }, 10_000);
  });
}

// Module-level screen share manager instance
let screenShareManager: ScreenShareManager | null = null;
let currentProducerId: string | null = null;

export const useVoiceStore = create<VoiceStoreState>()((set, get) => ({
  currentChannelId: null,
  currentServerId: null,
  channelUsers: {},
  isMuted: false,
  isDeafened: false,
  isConnecting: false,
  speakingUsers: new Set<string>(),
  userVolumes: {},
  isScreenSharing: false,
  screenShareTracks: {},
  focusedScreenShareUserId: null,
  showScreenSharePicker: false,

  joinChannel: async (channelId, serverId) => {
    const { currentChannelId } = get();
    if (currentChannelId === channelId) return;

    // If already in a channel, leave first
    if (currentChannelId) {
      get().leaveChannel();
    }

    set({ isConnecting: true, currentChannelId: channelId, currentServerId: serverId });

    // Set up LiveKit callbacks (voice/audio only)
    livekitManager.setSpeakingCallback((speakers) => {
      set({ speakingUsers: speakers });
    });

    try {
      // 1. Send VOICE_STATE_UPDATE to register with server
      wsManager.send({
        op: WsOpcode.VOICE_STATE_UPDATE,
        d: { channelId, serverId },
      });

      // 2. Request LiveKit credentials
      const credentials = await voiceSignal("joinVoice", { channelId, serverId });

      // 3. Connect to LiveKit room
      await livekitManager.connect(credentials.token, credentials.url);

      // 4. Enable mic
      await livekitManager.setMicEnabled(true);

      // 5. Restore saved device preferences
      const savedInput = localStorage.getItem("migo-input-device");
      const savedOutput = localStorage.getItem("migo-output-device");
      if (savedInput) livekitManager.setInputDevice(savedInput);
      if (savedOutput) livekitManager.setOutputDevice(savedOutput);

      // 6. Initialize mediasoup device for screen sharing
      screenShareManager = new ScreenShareManager(voiceSignal);
      await screenShareManager.initDevice();

      set({ isConnecting: false });
      playJoinSound();
    } catch (err) {
      console.error("Failed to join voice channel:", err);
      set({ isConnecting: false, currentChannelId: null, currentServerId: null });
      livekitManager.setSpeakingCallback(null);
      screenShareManager = null;
    }
  },

  leaveChannel: () => {
    const { currentChannelId } = get();
    livekitManager.disconnect();
    livekitManager.setSpeakingCallback(null);

    // Dispose mediasoup screen share
    if (screenShareManager) {
      screenShareManager.dispose();
      screenShareManager = null;
    }
    currentProducerId = null;

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
      screenShareTracks: {},
      focusedScreenShareUserId: null,
      showScreenSharePicker: false,
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
          d: { channelId: currentChannelId, serverId: currentServerId, muted: false, deafened: false },
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
        d: { channelId: currentChannelId, serverId: currentServerId, muted: newMuted, deafened: false },
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
      playMuteSound();
    } else {
      playUnmuteSound();
    }

    if (currentChannelId && currentServerId) {
      wsManager.send({
        op: WsOpcode.VOICE_STATE_UPDATE,
        d: { channelId: currentChannelId, serverId: currentServerId, muted: newDeafened, deafened: newDeafened },
      });
    }
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
    livekitManager.setUserVolume(userId, volume);
    set((s) => ({
      userVolumes: { ...s.userVolumes, [userId]: volume },
    }));
    // Persist to localStorage
    try {
      const stored = JSON.parse(localStorage.getItem("migo-user-volumes") || "{}");
      stored[userId] = volume;
      localStorage.setItem("migo-user-volumes", JSON.stringify(stored));
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

  startScreenShare: async (sourceId: string, preset?: CapturePreset) => {
    set({ showScreenSharePicker: false });
    if (!screenShareManager) return;

    try {
      const { producerId, track } = await screenShareManager.startSharing(sourceId, preset);
      currentProducerId = producerId;
      set((s) => ({
        isScreenSharing: true,
        screenShareTracks: { ...s.screenShareTracks, [useAuthStore.getState().user?.id ?? ""]: track },
      }));

      // Notify server about screen share with producerId
      wsManager.send({
        op: WsOpcode.VOICE_SIGNAL,
        d: { requestId: `ss_${Date.now()}`, action: "startScreenShare", data: { producerId } },
      });
    } catch (err) {
      console.error("Failed to start screen share:", err);
      set({ isScreenSharing: false });
    }
  },

  stopScreenShare: () => {
    if (screenShareManager) {
      screenShareManager.stopSharing();
    }

    const userId = useAuthStore.getState().user?.id ?? "";
    set((s) => {
      const screenShareTracks = { ...s.screenShareTracks };
      delete screenShareTracks[userId];
      return { isScreenSharing: false, screenShareTracks };
    });

    wsManager.send({
      op: WsOpcode.VOICE_SIGNAL,
      d: { requestId: `ss_${Date.now()}`, action: "stopScreenShare", data: { producerId: currentProducerId } },
    });
    currentProducerId = null;
  },

  handleScreenShareStart: (data: { userId: string; channelId: string; producerId?: string }) => {
    const { channelUsers } = get();
    const myUserId = useAuthStore.getState().user?.id;

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

    // If this is another user's screen share, consume it via mediasoup
    if (data.userId !== myUserId && data.producerId && screenShareManager) {
      screenShareManager.viewStream(data.producerId).then((track) => {
        set((s) => ({
          screenShareTracks: { ...s.screenShareTracks, [data.userId]: track },
        }));
      }).catch((err) => {
        console.error("Failed to view screen share:", err);
      });
    }
  },

  handleScreenShareStop: (data: { userId: string }) => {
    const myUserId = useAuthStore.getState().user?.id;

    // Stop viewing if it's another user's screen share
    if (data.userId !== myUserId && screenShareManager) {
      screenShareManager.stopViewing();
    }

    set((s) => {
      // Remove track from map
      const screenShareTracks = { ...s.screenShareTracks };
      delete screenShareTracks[data.userId];

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
        screenShareTracks,
        channelUsers,
        focusedScreenShareUserId:
          s.focusedScreenShareUserId === data.userId ? null : s.focusedScreenShareUserId,
      };
    });
  },

  focusScreenShare: (userId: string) => {
    set({ focusedScreenShareUserId: userId });
  },

  unfocusScreenShare: () => {
    set({ focusedScreenShareUserId: null });
  },
}));
