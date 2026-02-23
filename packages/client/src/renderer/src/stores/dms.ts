import { create } from "zustand";
import type { DmChannel, Message } from "@migo/shared";
import { DM_ROUTES, buildRoute } from "@migo/shared";
import { api } from "@/lib/api";

interface DmState {
  channels: DmChannel[];
  activeDmId: string | null;
  messages: Record<string, Message[]>;
  isLoading: boolean;

  fetchDmChannels: () => Promise<void>;
  createDm: (recipientId: string) => Promise<DmChannel>;
  setActiveDm: (channelId: string | null) => void;
  fetchMessages: (channelId: string) => Promise<void>;
  sendMessage: (channelId: string, content: string, attachmentIds?: string[]) => Promise<void>;
  handleDmMessageCreate: (message: Message) => void;
  handleDmChannelCreate: (channel: DmChannel) => void;
  clearDms: () => void;
}

export const useDmStore = create<DmState>()((set, get) => ({
  channels: [],
  activeDmId: null,
  messages: {},
  isLoading: false,

  fetchDmChannels: async () => {
    const channels = await api.get<DmChannel[]>(DM_ROUTES.LIST);
    set({ channels });
  },

  createDm: async (recipientId) => {
    const channel = await api.post<DmChannel>(DM_ROUTES.CREATE, { recipientId });
    set((s) => {
      const exists = s.channels.find((c) => c.id === channel.id);
      if (exists) return s;
      return { channels: [channel, ...s.channels] };
    });
    return channel;
  },

  setActiveDm: (channelId) => set({ activeDmId: channelId }),

  fetchMessages: async (channelId) => {
    set({ isLoading: true });
    const msgs = await api.get<Message[]>(
      buildRoute(DM_ROUTES.MESSAGES_LIST, { channelId }),
    );
    set((s) => ({
      messages: { ...s.messages, [channelId]: msgs },
      isLoading: false,
    }));
  },

  sendMessage: async (channelId, content, attachmentIds) => {
    const body: Record<string, unknown> = { content };
    if (attachmentIds?.length) body.attachmentIds = attachmentIds;
    await api.post(buildRoute(DM_ROUTES.MESSAGES_CREATE, { channelId }), body);
  },

  handleDmMessageCreate: (message) => {
    set((s) => {
      const existing = s.messages[message.channelId] || [];
      // Deduplicate
      if (existing.some((m) => m.id === message.id)) return s;
      return {
        messages: {
          ...s.messages,
          [message.channelId]: [...existing, message],
        },
        channels: s.channels.map((c) =>
          c.id === message.channelId
            ? { ...c, lastMessageAt: message.createdAt }
            : c,
        ),
      };
    });
  },

  handleDmChannelCreate: (channel) => {
    set((s) => {
      if (s.channels.find((c) => c.id === channel.id)) return s;
      return { channels: [channel, ...s.channels] };
    });
  },

  clearDms: () => set({ channels: [], activeDmId: null, messages: {} }),
}));
