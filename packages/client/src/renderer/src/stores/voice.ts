import { create } from "zustand";
import { WsOpcode } from "@migo/shared";
import type { VoiceState, VoiceChannelUser } from "@migo/shared";
import { livekitManager } from "@/lib/livekit";
import { wsManager } from "@/lib/ws";
import {
  playJoinSound,
  playLeaveSound,
  playMuteSound,
  playUnmuteSound,
} from "@/lib/sounds";
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
  startScreenShare: (target: { type: string; id: number }) => Promise<void>;
  stopScreenShare: () => void;
  handleScreenShareStart: (data: { userId: string; channelId: string }) => void;
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
    const { currentChannelId } = get();
    // Stop browser screen share if active
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
      playMuteSound();
    } else {
      playUnmuteSound();
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
      await window.screenAPI.selectSource(target.type, target.id);

      // Use LiveKit SDK's setScreenShareEnabled which calls getDisplayMedia()
      // internally. Chrome's full WebRTC pipeline handles encoding, FEC,
      // congestion control, and NACK (tested at 55fps 1440p).
      await livekitManager.startScreenShare();

      // Notify server so other clients see the screen share icon
      voiceSignal("startScreenShare", {}).catch(() => {});

      set({ isScreenSharing: true });
    } catch (err) {
      console.error("Failed to start screen share:", err);
      set({ isScreenSharing: false });
    }
  },

  stopScreenShare: () => {
    livekitManager.stopScreenShare().catch(() => {});

    set({ isScreenSharing: false });

    // Notify server
    voiceSignal("stopScreenShare", {}).catch(() => {});
  },

  handleScreenShareStart: (data: { userId: string; channelId: string }) => {
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

  focusScreenShare: (userId: string) => {
    set({ focusedScreenShareUserId: userId });
  },

  unfocusScreenShare: () => {
    set({ focusedScreenShareUserId: null });
  },
}));
