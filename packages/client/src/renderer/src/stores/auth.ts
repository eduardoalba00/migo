import { create } from "zustand";
import { nanoid } from "nanoid";
import type { User, AuthResponse, TokenPair } from "@migo/shared";
import { AUTH_ROUTES } from "@migo/shared";
import { api, ApiError } from "@/lib/api";

interface AuthState {
  user: User | null;
  tokens: TokenPair | null;
  isLoading: boolean;
  error: string | null;

  register: (username: string, password: string, displayName?: string) => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  refresh: () => Promise<void>;
  fetchMe: () => Promise<void>;
  clearError: () => void;
  hydrateFromWorkspace: (workspaceId: string) => void;
  clearAuth: () => void;
}

function getActiveWorkspaceId(): string | null {
  try {
    const raw = localStorage.getItem("migo-workspaces");
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.state?.activeWorkspaceId ?? null;
  } catch {
    return null;
  }
}

function persistAuth(tokens: TokenPair | null, user: User | null) {
  const workspaceId = getActiveWorkspaceId();
  if (!workspaceId) return;
  if (tokens && user) {
    localStorage.setItem(
      `migo-auth-${workspaceId}`,
      JSON.stringify({ tokens, user }),
    );
  } else {
    localStorage.removeItem(`migo-auth-${workspaceId}`);
  }
}

export const useAuthStore = create<AuthState>()((set, get) => ({
  user: null,
  tokens: null,
  isLoading: false,
  error: null,

  register: async (username, password, displayName) => {
    set({ isLoading: true, error: null });
    try {
      const data = await api.post<AuthResponse>(AUTH_ROUTES.REGISTER, {
        username,
        password,
        displayName,
      });
      api.setAccessToken(data.tokens.accessToken);
      set({ user: data.user, tokens: data.tokens, isLoading: false });
      persistAuth(data.tokens, data.user);
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Registration failed";
      set({ isLoading: false, error: message });
      throw e;
    }
  },

  login: async (username, password) => {
    set({ isLoading: true, error: null });
    try {
      const data = await api.post<AuthResponse>(AUTH_ROUTES.LOGIN, {
        username,
        password,
      });
      api.setAccessToken(data.tokens.accessToken);
      set({ user: data.user, tokens: data.tokens, isLoading: false });
      persistAuth(data.tokens, data.user);
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Login failed";
      set({ isLoading: false, error: message });
      throw e;
    }
  },

  logout: () => {
    api.setAccessToken(null);
    set({ user: null, tokens: null, error: null });
    persistAuth(null, null);
  },

  refresh: async () => {
    const { tokens } = get();
    if (!tokens?.refreshToken) return;

    try {
      const data = await api.post<AuthResponse>(AUTH_ROUTES.REFRESH, {
        refreshToken: tokens.refreshToken,
      });
      api.setAccessToken(data.tokens.accessToken);
      set({ user: data.user, tokens: data.tokens });
      persistAuth(data.tokens, data.user);
    } catch {
      // Refresh failed — log out
      api.setAccessToken(null);
      set({ user: null, tokens: null });
      persistAuth(null, null);
    }
  },

  fetchMe: async () => {
    const { tokens } = get();
    if (!tokens?.accessToken) return;

    api.setAccessToken(tokens.accessToken);
    try {
      const data = await api.get<{ user: User }>(AUTH_ROUTES.ME);
      set({ user: data.user });
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 404)) {
        // 401 = expired token, 404 = user deleted — try refresh, which logs out on failure
        await get().refresh();
      }
    }
  },

  clearError: () => set({ error: null }),

  hydrateFromWorkspace: (workspaceId: string) => {
    try {
      const raw = localStorage.getItem(`migo-auth-${workspaceId}`);
      if (!raw) {
        set({ user: null, tokens: null });
        api.setAccessToken(null);
        return;
      }
      const { tokens, user } = JSON.parse(raw);
      if (tokens?.accessToken) {
        api.setAccessToken(tokens.accessToken);
        set({ user, tokens });
      }
    } catch {
      set({ user: null, tokens: null });
      api.setAccessToken(null);
    }
  },

  clearAuth: () => {
    api.setAccessToken(null);
    set({ user: null, tokens: null, error: null, isLoading: false });
  },
}));

// One-time migration: if old "migo-auth" key exists and no workspaces yet, create a default workspace
(function migrateOldAuth() {
  const oldAuth = localStorage.getItem("migo-auth");
  const workspaces = localStorage.getItem("migo-workspaces");

  if (oldAuth && !workspaces) {
    try {
      const parsed = JSON.parse(oldAuth);
      const { tokens, user } = parsed?.state ?? parsed;
      if (tokens) {
        const id = nanoid();
        const workspace = { id, name: "Local Server", url: "http://localhost:3000" };

        localStorage.setItem(
          "migo-workspaces",
          JSON.stringify({
            state: {
              workspaces: [workspace],
              activeWorkspaceId: id,
            },
            version: 0,
          }),
        );
        localStorage.setItem(
          `migo-auth-${id}`,
          JSON.stringify({ tokens, user }),
        );
        localStorage.removeItem("migo-auth");
      }
    } catch {
      // Migration failed, ignore
    }
  }
})();
