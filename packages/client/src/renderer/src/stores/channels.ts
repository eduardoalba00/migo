import { create } from "zustand";
import type { ServerChannelList, Channel, Category } from "@migo/shared";
import { SERVER_ROUTES, READ_STATE_ROUTES, buildRoute } from "@migo/shared";
import { api } from "@/lib/api";
import { useServerStore } from "./servers";

interface ChannelState {
  channelList: ServerChannelList | null;
  activeChannelId: string | null;
  unreadChannels: Set<string>;

  fetchChannels: (serverId: string) => Promise<void>;
  createChannel: (serverId: string, data: { name: string; type?: string; categoryId?: string }) => Promise<Channel>;
  createCategory: (serverId: string, name: string) => Promise<Category>;
  deleteChannel: (serverId: string, channelId: string) => Promise<void>;
  deleteCategory: (serverId: string, categoryId: string) => Promise<void>;
  setActiveChannel: (channelId: string | null) => void;
  clearChannels: () => void;
  handleChannelCreate: (channel: Channel) => void;
  handleChannelUpdate: (channel: Channel) => void;
  handleChannelDelete: (data: { id: string; serverId: string }) => void;
  markUnread: (channelId: string) => void;
  markRead: (channelId: string, messageId: string) => void;
}

export const useChannelStore = create<ChannelState>()((set, get) => ({
  channelList: null,
  activeChannelId: null,
  unreadChannels: new Set<string>(),

  fetchChannels: async (serverId) => {
    const channelList = await api.get<ServerChannelList>(
      buildRoute(SERVER_ROUTES.CHANNELS_LIST, { serverId }),
    );
    set({ channelList });
  },

  createChannel: async (serverId, data) => {
    const channel = await api.post<Channel>(
      buildRoute(SERVER_ROUTES.CHANNELS_CREATE, { serverId }),
      data,
    );
    return channel;
  },

  createCategory: async (serverId, name) => {
    const category = await api.post<Category>(
      buildRoute(SERVER_ROUTES.CATEGORIES_CREATE, { serverId }),
      { name },
    );
    // Refresh the channel list
    await get().fetchChannels(serverId);
    return category;
  },

  deleteChannel: async (serverId, channelId) => {
    await api.delete(
      buildRoute(SERVER_ROUTES.CHANNELS_DELETE, { serverId, channelId }),
    );
  },

  deleteCategory: async (serverId, categoryId) => {
    await api.delete(
      buildRoute(SERVER_ROUTES.CATEGORIES_DELETE, { serverId, categoryId }),
    );
    await get().fetchChannels(serverId);
  },

  setActiveChannel: (channelId) => set({ activeChannelId: channelId }),

  clearChannels: () => set({ channelList: null, activeChannelId: null, unreadChannels: new Set() }),

  handleChannelCreate: (channel) => {
    set((s) => {
      if (!s.channelList) {
        // Channel list not loaded yet — refetch if this is for the active server
        const activeServerId = useServerStore.getState().activeServerId;
        if (activeServerId === channel.serverId) {
          get().fetchChannels(activeServerId);
        }
        return s;
      }
      const list = { ...s.channelList };
      if (channel.categoryId) {
        list.categories = list.categories.map((cat) =>
          cat.id === channel.categoryId
            ? { ...cat, channels: [...cat.channels, channel] }
            : cat,
        );
      } else {
        list.uncategorized = [...list.uncategorized, channel];
      }
      return { channelList: list };
    });
  },

  handleChannelUpdate: (channel) => {
    set((s) => {
      if (!s.channelList) {
        const activeServerId = useServerStore.getState().activeServerId;
        if (activeServerId === channel.serverId) {
          get().fetchChannels(activeServerId);
        }
        return s;
      }
      const updateInList = (channels: Channel[]) =>
        channels.map((ch) => (ch.id === channel.id ? channel : ch));
      return {
        channelList: {
          uncategorized: updateInList(s.channelList.uncategorized),
          categories: s.channelList.categories.map((cat) => ({
            ...cat,
            channels: updateInList(cat.channels),
          })),
        },
      };
    });
  },

  handleChannelDelete: (data) => {
    set((s) => {
      if (!s.channelList) {
        const activeServerId = useServerStore.getState().activeServerId;
        if (activeServerId === data.serverId) {
          get().fetchChannels(activeServerId);
        }
        return s;
      }
      const filterOut = (channels: Channel[]) =>
        channels.filter((ch) => ch.id !== data.id);
      return {
        channelList: {
          uncategorized: filterOut(s.channelList.uncategorized),
          categories: s.channelList.categories.map((cat) => ({
            ...cat,
            channels: filterOut(cat.channels),
          })),
        },
        activeChannelId:
          s.activeChannelId === data.id ? null : s.activeChannelId,
      };
    });
  },

  markUnread: (channelId) => {
    set((s) => {
      // Don't mark current channel as unread
      if (s.activeChannelId === channelId) return s;
      const next = new Set(s.unreadChannels);
      next.add(channelId);
      return { unreadChannels: next };
    });
  },

  markRead: (channelId, messageId) => {
    set((s) => {
      const next = new Set(s.unreadChannels);
      next.delete(channelId);
      return { unreadChannels: next };
    });
    // Send ack to server
    api.post(buildRoute(READ_STATE_ROUTES.ACK, { channelId }), { messageId }).catch(() => {});
  },
}));
