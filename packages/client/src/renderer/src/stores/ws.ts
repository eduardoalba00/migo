import { create } from "zustand";
import { DispatchEvent } from "@migo/shared";
import type { WsDispatch, Message, Channel, DmChannel, ServerMember, MessageDeleteData, MemberLeaveData, VoiceState, TypingStartData, ReactionData, PresenceUpdateData } from "@migo/shared";
import { toast } from "sonner";
import { wsManager } from "@/lib/ws";
import { playMessageSound, playMentionSound } from "@/lib/sounds";
import { useAuthStore } from "./auth";
import { useChannelStore } from "./channels";
import { useMessageStore } from "./messages";

import { useServerStore } from "./servers";
import { useVoiceStore } from "./voice";
import { useMemberStore } from "./members";
import { useDmStore } from "./dms";

interface WsState {
  connected: boolean;
  versionMismatch: boolean;
  connect: (token: string) => void;
  disconnect: () => void;
}

export const useWsStore = create<WsState>()((set) => ({
  connected: false,
  versionMismatch: false,

  connect: (token) => {
    wsManager.setStatusChangeHandler((connected) => {
      set({ connected });
    });

    wsManager.setVersionMismatchHandler(() => {
      set({ versionMismatch: true, connected: false });
    });

    wsManager.setTokenRefresher(async () => {
      await useAuthStore.getState().refresh();
      return useAuthStore.getState().tokens?.accessToken ?? null;
    });

    wsManager.setDispatchHandler((event: WsDispatch) => {
      switch (event.t) {
        case DispatchEvent.MESSAGE_CREATE: {
          const msg = event.d as Message;
          useMessageStore.getState().handleMessageCreate(msg);
          const myId = useAuthStore.getState().user?.id;
          const isOwnMsg = msg.author.id === myId;
          // Mark channel as unread if it's not the active channel
          useChannelStore.getState().markUnread(msg.channelId);
          // Notification sounds & desktop notification
          if (!isOwnMsg) {
            const activeChannel = useChannelStore.getState().activeChannelId;
            const isMention = msg.content.includes(`@${myId}`) || msg.content.includes("@everyone");
            if (isMention) {
              playMentionSound();
            } else if (activeChannel !== msg.channelId) {
              playMessageSound();
            }
            // Desktop notification if window is not focused
            if (!document.hasFocus()) {
              try {
                new Notification(msg.author.displayName, {
                  body: msg.content.slice(0, 100),
                  silent: true,
                });
              } catch {}
            }
          }
          break;
        }
        case DispatchEvent.MESSAGE_UPDATE:
          useMessageStore.getState().handleMessageUpdate(event.d as Message);
          break;
        case DispatchEvent.MESSAGE_DELETE:
          useMessageStore.getState().handleMessageDelete(event.d as MessageDeleteData);
          break;
        case DispatchEvent.CHANNEL_CREATE:
          useChannelStore.getState().handleChannelCreate(event.d as Channel);
          break;
        case DispatchEvent.CHANNEL_UPDATE:
          useChannelStore.getState().handleChannelUpdate(event.d as Channel);
          break;
        case DispatchEvent.CHANNEL_DELETE:
          useChannelStore.getState().handleChannelDelete(event.d as { id: string; serverId: string });
          break;
        case DispatchEvent.MEMBER_JOIN:
          useMemberStore.getState().handleMemberJoin(event.d as ServerMember);
          break;
        case DispatchEvent.MEMBER_LEAVE:
          useMemberStore.getState().handleMemberLeave(event.d as MemberLeaveData);
          break;
        case DispatchEvent.VOICE_STATE_UPDATE:
          useVoiceStore.getState().handleVoiceStateUpdate(event.d as VoiceState);
          break;
        case DispatchEvent.TYPING_START:
          useMessageStore.getState().handleTypingStart(event.d as TypingStartData);
          break;
        case DispatchEvent.REACTION_ADD:
          useMessageStore.getState().handleReactionAdd(event.d as ReactionData);
          break;
        case DispatchEvent.REACTION_REMOVE:
          useMessageStore.getState().handleReactionRemove(event.d as ReactionData);
          break;
        case DispatchEvent.MESSAGE_PIN:
          useMessageStore.getState().handleMessagePin(event.d as { messageId: string; channelId: string });
          break;
        case DispatchEvent.MESSAGE_UNPIN:
          useMessageStore.getState().handleMessageUnpin(event.d as { messageId: string; channelId: string });
          break;
        case DispatchEvent.PRESENCE_UPDATE:
          useMemberStore.getState().handlePresenceUpdate(event.d as PresenceUpdateData);
          break;
        case DispatchEvent.DM_MESSAGE_CREATE: {
          const dmMsg = event.d as Message;
          useDmStore.getState().handleDmMessageCreate(dmMsg);
          if (dmMsg.author.id !== useAuthStore.getState().user?.id) {
            playMessageSound();
            toast(`${dmMsg.author.displayName}`, {
              description: dmMsg.content.slice(0, 100),
              action: {
                label: "View",
                onClick: () => {
                  useServerStore.getState().setActiveServer(null);
                  useDmStore.getState().setActiveDm(dmMsg.channelId);
                  useDmStore.getState().fetchMessages(dmMsg.channelId);
                },
              },
            });
            if (!document.hasFocus()) {
              try {
                new Notification(`DM from ${dmMsg.author.displayName}`, {
                  body: dmMsg.content.slice(0, 100),
                  silent: true,
                });
              } catch {}
            }
          }
          break;
        }
        case DispatchEvent.DM_CHANNEL_CREATE:
          useDmStore.getState().handleDmChannelCreate(event.d as DmChannel);
          break;
        case DispatchEvent.SCREEN_SHARE_START:
          useVoiceStore.getState().handleScreenShareStart(event.d as { userId: string; channelId: string; producerId?: string });
          break;
        case DispatchEvent.SCREEN_SHARE_STOP:
          useVoiceStore.getState().handleScreenShareStop(event.d as { userId: string });
          break;
      }
    });

    wsManager.connect(token);
  },

  disconnect: () => {
    wsManager.disconnect();
    set({ connected: false });
  },
}));
