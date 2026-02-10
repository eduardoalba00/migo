import { useEffect } from "react";
import { Toaster } from "@/components/ui/sonner";
import { Titlebar } from "@/components/titlebar";
import { AuthPage } from "@/pages/auth";
import { AppShell } from "@/pages/app-shell";
import { WorkspacePicker } from "@/pages/workspace-picker";
import { useAuthStore } from "@/stores/auth";
import { useWorkspaceStore } from "@/stores/workspace";
import { api } from "@/lib/api";
import { wsManager } from "@/lib/ws";
import { httpToWsUrl } from "@/lib/utils";

export default function App() {
  const { user, tokens, fetchMe } = useAuthStore();
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const workspaces = useWorkspaceStore((s) => s.workspaces);

  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId);
  const isAuthenticated = !!user && !!tokens;

  useEffect(() => {
    if (!activeWorkspaceId || !activeWorkspace) return;

    // Configure API and WS URLs for the active workspace
    api.setBaseUrl(activeWorkspace.url);
    wsManager.setUrl(httpToWsUrl(activeWorkspace.url));

    // Hydrate auth from localStorage for this workspace
    useAuthStore.getState().hydrateFromWorkspace(activeWorkspaceId);

    // Validate the session
    const { tokens: currentTokens } = useAuthStore.getState();
    if (currentTokens) {
      fetchMe();
    }
  }, [activeWorkspaceId]);

  return (
    <div className="flex flex-col h-screen">
      <Titlebar />
      {!activeWorkspaceId ? (
        <WorkspacePicker />
      ) : isAuthenticated ? (
        <AppShell />
      ) : (
        <AuthPage />
      )}
      <Toaster position="bottom-right" />
    </div>
  );
}
