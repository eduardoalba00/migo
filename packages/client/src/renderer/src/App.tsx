import { useEffect } from "react";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import { Titlebar } from "@/components/titlebar";
import { UpdateNotification } from "@/components/layout/update-notification";
import { VersionMismatchBanner } from "@/components/layout/version-mismatch-banner";
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
    <ThemeProvider attribute="class" defaultTheme="dark" storageKey="migo-theme">
      <div className="flex flex-col h-screen">
        <Titlebar />
        <UpdateNotification />
        <VersionMismatchBanner />
        {!activeWorkspaceId ? (
          <WorkspacePicker />
        ) : isAuthenticated ? (
          <AppShell />
        ) : (
          <AuthPage />
        )}
        <Toaster position="bottom-right" />
      </div>
    </ThemeProvider>
  );
}
