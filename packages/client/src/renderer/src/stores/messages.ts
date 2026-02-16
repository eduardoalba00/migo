import { create } from "zustand";
import type { Message, ReactionData } from "@migo/shared";
import { MESSAGE_ROUTES, buildRoute } from "@migo/shared";
import { api } from "@/lib/api";
import { useAuthStore } from "./auth";

interface ReplyContext {
  messageId: string;
  author: string;
  content: string;
}

interface MessageState {
  messagesByChannel: Record<string, Message[]>;
  hasMore: Record<string, boolean>;
  replyContext: ReplyContext | null;
  typingUsers: Record<string, Record<string, { displayName: string; timeout: ReturnType<typeof setTimeout> }>>;

  fetchMessages: (channelId: string, before?: string) => Promise<void>;
  sendMessage: (channelId: string, content: string, replyToId?: string, attachmentIds?: string[]) => Promise<void>;
  editMessage: (channelId: string, messageId: string, content: string) => Promise<void>;
  deleteMessage: (channelId: string, messageId: string) => Promise<void>;
  handleMessageCreate: (message: Message) => void;
  handleMessageUpdate: (message: Message) => void;
  handleMessageDelete: (data: { id: string; channelId: string }) => void;
  clearMessages: (channelId: string) => void;
  setReplyContext: (ctx: ReplyContext | null) => void;
  addReaction: (channelId: string, messageId: string, emoji: string) => Promise<void>;
  removeReaction: (channelId: string, messageId: string, emoji: string) => Promise<void>;
  handleReactionAdd: (data: ReactionData) => void;
  handleReactionRemove: (data: ReactionData) => void;
  handleTypingStart: (data: { channelId: string; userId: string; displayName: string }) => void;
  pinMessage: (channelId: string, messageId: string) => Promise<void>;
  unpinMessage: (channelId: string, messageId: string) => Promise<void>;
  handleMessagePin: (data: { messageId: string; channelId: string }) => void;
  handleMessageUnpin: (data: { messageId: string; channelId: string }) => void;
}

export const useMessageStore = create<MessageState>()((set, get) => ({
  messagesByChannel: {},
  hasMore: {},
  replyContext: null,
  typingUsers: {},

  fetchMessages: async (channelId, before) => {
    const params = new URLSearchParams();
    if (before) params.set("before", before);
    params.set("limit", "50");

    const path = buildRoute(MESSAGE_ROUTES.LIST, { channelId });
    const url = params.toString() ? `${path}?${params}` : path;
    const messages = await api.get<Message[]>(url);

    set((s) => {
      const existing = before ? (s.messagesByChannel[channelId] || []) : [];
      return {
        messagesByChannel: {
          ...s.messagesByChannel,
          [channelId]: before ? [...messages, ...existing] : messages,
        },
        hasMore: {
          ...s.hasMore,
          [channelId]: messages.length === 50,
        },
      };
    });
  },

  sendMessage: async (channelId, content, replyToId, attachmentIds) => {
    const body: Record<string, unknown> = { content };
    if (replyToId) body.replyToId = replyToId;
    if (attachmentIds?.length) body.attachmentIds = attachmentIds;
    await api.post(buildRoute(MESSAGE_ROUTES.CREATE, { channelId }), body);
  },

  editMessage: async (channelId, messageId, content) => {
    await api.patch(
      buildRoute(MESSAGE_ROUTES.UPDATE, { channelId, messageId }),
      { content },
    );
  },

  deleteMessage: async (channelId, messageId) => {
    await api.delete(
      buildRoute(MESSAGE_ROUTES.DELETE, { channelId, messageId }),
    );
  },

  handleMessageCreate: (message) => {
    set((s) => {
      const existing = s.messagesByChannel[message.channelId] || [];
      return {
        messagesByChannel: {
          ...s.messagesByChannel,
          [message.channelId]: [...existing, message],
        },
      };
    });
  },

  handleMessageUpdate: (message) => {
    set((s) => {
      const existing = s.messagesByChannel[message.channelId] || [];
      return {
        messagesByChannel: {
          ...s.messagesByChannel,
          [message.channelId]: existing.map((m) =>
            m.id === message.id ? message : m,
          ),
        },
      };
    });
  },

  handleMessageDelete: (data) => {
    set((s) => {
      const existing = s.messagesByChannel[data.channelId] || [];
      return {
        messagesByChannel: {
          ...s.messagesByChannel,
          [data.channelId]: existing.filter((m) => m.id !== data.id),
        },
      };
    });
  },

  clearMessages: (channelId) => {
    set((s) => {
      const { [channelId]: _, ...rest } = s.messagesByChannel;
      const { [channelId]: __, ...restHasMore } = s.hasMore;
      return { messagesByChannel: rest, hasMore: restHasMore };
    });
  },

  setReplyContext: (ctx) => set({ replyContext: ctx }),

  addReaction: async (channelId, messageId, emoji) => {
    await api.put(
      buildRoute(MESSAGE_ROUTES.REACTION_PUT, { channelId, messageId, emoji: encodeURIComponent(emoji) }),
      {},
    );
  },

  removeReaction: async (channelId, messageId, emoji) => {
    await api.delete(
      buildRoute(MESSAGE_ROUTES.REACTION_DELETE, { channelId, messageId, emoji: encodeURIComponent(emoji) }),
    );
  },

  handleReactionAdd: (data) => {
    set((s) => {
      const existing = s.messagesByChannel[data.channelId] || [];
      return {
        messagesByChannel: {
          ...s.messagesByChannel,
          [data.channelId]: existing.map((m) => {
            if (m.id !== data.messageId) return m;
            const reactions = [...m.reactions];
            const idx = reactions.findIndex((r) => r.emoji === data.emoji);
            if (idx >= 0) {
              reactions[idx] = {
                ...reactions[idx],
                count: reactions[idx].count + 1,
                me: reactions[idx].me || data.userId === useAuthStore.getState().user?.id,
              };
            } else {
              reactions.push({
                emoji: data.emoji,
                count: 1,
                me: data.userId === useAuthStore.getState().user?.id,
              });
            }
            return { ...m, reactions };
          }),
        },
      };
    });
  },

  handleReactionRemove: (data) => {
    set((s) => {
      const existing = s.messagesByChannel[data.channelId] || [];
      return {
        messagesByChannel: {
          ...s.messagesByChannel,
          [data.channelId]: existing.map((m) => {
            if (m.id !== data.messageId) return m;
            const reactions = m.reactions
              .map((r) => {
                if (r.emoji !== data.emoji) return r;
                return {
                  ...r,
                  count: r.count - 1,
                  me: data.userId === useAuthStore.getState().user?.id ? false : r.me,
                };
              })
              .filter((r) => r.count > 0);
            return { ...m, reactions };
          }),
        },
      };
    });
  },

  handleTypingStart: (data) => {
    set((s) => {
      const channelTypers = { ...(s.typingUsers[data.channelId] || {}) };

      // Clear previous timeout
      if (channelTypers[data.userId]) {
        clearTimeout(channelTypers[data.userId].timeout);
      }

      // Set new timeout (8s auto-expire)
      const timeout = setTimeout(() => {
        set((s2) => {
          const updated = { ...(s2.typingUsers[data.channelId] || {}) };
          delete updated[data.userId];
          return {
            typingUsers: { ...s2.typingUsers, [data.channelId]: updated },
          };
        });
      }, 8000);

      channelTypers[data.userId] = { displayName: data.displayName, timeout };

      return {
        typingUsers: { ...s.typingUsers, [data.channelId]: channelTypers },
      };
    });
  },

  pinMessage: async (channelId, messageId) => {
    await api.put(
      buildRoute(MESSAGE_ROUTES.PIN, { channelId, messageId }),
      {},
    );
  },

  unpinMessage: async (channelId, messageId) => {
    await api.delete(
      buildRoute(MESSAGE_ROUTES.UNPIN, { channelId, messageId }),
    );
  },

  handleMessagePin: (data) => {
    set((s) => {
      const existing = s.messagesByChannel[data.channelId] || [];
      return {
        messagesByChannel: {
          ...s.messagesByChannel,
          [data.channelId]: existing.map((m) =>
            m.id === data.messageId ? { ...m, pinnedAt: new Date().toISOString() } : m,
          ),
        },
      };
    });
  },

  handleMessageUnpin: (data) => {
    set((s) => {
      const existing = s.messagesByChannel[data.channelId] || [];
      return {
        messagesByChannel: {
          ...s.messagesByChannel,
          [data.channelId]: existing.map((m) =>
            m.id === data.messageId ? { ...m, pinnedAt: null } : m,
          ),
        },
      };
    });
  },
}));
