import { create } from "zustand";
import type { Server } from "@migo/shared";
import { SERVER_ROUTES, INVITE_ROUTES, buildRoute } from "@migo/shared";
import { api } from "@/lib/api";
import { useWorkspaceStore } from "./workspace";

function getStorageKey(): string {
  const wsId = useWorkspaceStore.getState().activeWorkspaceId ?? "default";
  return `migo-last-server-${wsId}`;
}

interface ServerState {
  servers: Server[];
  activeServerId: string | null;

  fetchServers: () => Promise<void>;
  createServer: (name: string) => Promise<Server>;
  joinServer: (code: string) => Promise<Server>;
  leaveServer: (serverId: string) => Promise<void>;
  deleteServer: (serverId: string) => Promise<void>;
  setActiveServer: (serverId: string | null) => void;
}

export const useServerStore = create<ServerState>()((set, get) => ({
  servers: [],
  activeServerId: null,

  fetchServers: async () => {
    try {
      const servers = await api.get<Server[]>(SERVER_ROUTES.LIST);
      const current = get().activeServerId;
      if (current) {
        // Keep current selection if it still exists, otherwise clear it
        const stillExists = servers.some((s) => s.id === current);
        set({ servers, activeServerId: stillExists ? current : null });
      } else {
        // Restore from localStorage only when no server is selected
        const lastServerId = localStorage.getItem(getStorageKey());
        const restored = lastServerId && servers.some((s) => s.id === lastServerId) ? lastServerId : null;
        set({ servers, activeServerId: restored });
      }
    } catch {
      // Token may be expired; WS reconnect will retry
    }
  },

  createServer: async (name) => {
    const server = await api.post<Server>(SERVER_ROUTES.CREATE, { name });
    set((s) => ({ servers: [...s.servers, server] }));
    return server;
  },

  joinServer: async (code) => {
    const server = await api.post<Server>(INVITE_ROUTES.JOIN, { code });
    set((s) => ({ servers: [...s.servers, server] }));
    return server;
  },

  leaveServer: async (serverId) => {
    await api.delete(buildRoute(SERVER_ROUTES.LEAVE, { serverId }));
    set((s) => ({
      servers: s.servers.filter((sv) => sv.id !== serverId),
      activeServerId: s.activeServerId === serverId ? null : s.activeServerId,
    }));
  },

  deleteServer: async (serverId) => {
    await api.delete(buildRoute(SERVER_ROUTES.DELETE, { serverId }));
    set((s) => ({
      servers: s.servers.filter((sv) => sv.id !== serverId),
      activeServerId: s.activeServerId === serverId ? null : s.activeServerId,
    }));
  },

  setActiveServer: (serverId) => {
    set({ activeServerId: serverId });
    if (serverId) {
      localStorage.setItem(getStorageKey(), serverId);
    } else {
      localStorage.removeItem(getStorageKey());
    }
  },
}));
