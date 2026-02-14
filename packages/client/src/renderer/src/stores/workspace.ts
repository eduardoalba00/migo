import { create } from "zustand";
import { persist } from "zustand/middleware";
import { nanoid } from "nanoid";
import { api } from "@/lib/api";
import { wsManager } from "@/lib/ws";
import { httpToWsUrl } from "@/lib/utils";
import { useAuthStore } from "./auth";
import { useWsStore } from "./ws";
import { useServerStore } from "./servers";
import { useChannelStore } from "./channels";
import { useMessageStore } from "./messages";
import { useVoiceStore } from "./voice";

export interface Workspace {
  id: string;
  name: string;
  url: string;
}

interface WorkspaceState {
  workspaces: Workspace[];
  activeWorkspaceId: string | null;

  addWorkspace: (name: string, url: string) => Workspace;
  removeWorkspace: (id: string) => void;
  setActiveWorkspace: (id: string | null) => void;
  switchWorkspace: (id: string) => void;
}

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set, get) => ({
      workspaces: [{ id: "default", name: "Migo", url: "https://migoserver.com" }],
      activeWorkspaceId: "default",

      addWorkspace: (name, url) => {
        const workspace: Workspace = {
          id: nanoid(),
          name,
          url: url.replace(/\/+$/, ""),
        };
        set((s) => ({ workspaces: [...s.workspaces, workspace] }));
        return workspace;
      },

      removeWorkspace: (id) => {
        if (id === "default") return;
        // Clean up auth for this workspace
        localStorage.removeItem(`migo-auth-${id}`);

        const { activeWorkspaceId, workspaces } = get();
        const remaining = workspaces.filter((w) => w.id !== id);
        set({ workspaces: remaining });

        if (activeWorkspaceId === id) {
          if (remaining.length > 0) {
            get().switchWorkspace(remaining[0].id);
          } else {
            useAuthStore.getState().clearAuth();
            useWsStore.getState().disconnect();
            set({ activeWorkspaceId: null });
          }
        }
      },

      setActiveWorkspace: (id) => set({ activeWorkspaceId: id }),

      switchWorkspace: (id) => {
        const { workspaces, activeWorkspaceId } = get();
        const workspace = workspaces.find((w) => w.id === id);
        if (!workspace) return;
        if (activeWorkspaceId === id) return;

        // 1. Leave voice if in a call
        const voiceState = useVoiceStore.getState();
        if (voiceState.currentChannelId) {
          voiceState.leaveChannel();
        }

        // 2. Disconnect WebSocket
        useWsStore.getState().disconnect();

        // 3. Reset all data stores
        useServerStore.setState({ servers: [], activeServerId: null });
        useChannelStore.setState({ channelList: null, activeChannelId: null });
        useMessageStore.setState({ messagesByChannel: {}, hasMore: {} });

        // 4. Reconfigure API and WS URLs
        api.setBaseUrl(workspace.url);
        wsManager.setUrl(httpToWsUrl(workspace.url));

        // 5. Clear current auth and hydrate from workspace
        useAuthStore.getState().clearAuth();
        useAuthStore.getState().hydrateFromWorkspace(id);

        // 6. Set active
        set({ activeWorkspaceId: id });
      },
    }),
    {
      name: "migo-workspaces",
      partialize: (state) => ({
        workspaces: state.workspaces,
        activeWorkspaceId: state.activeWorkspaceId,
      }),
    },
  ),
);
