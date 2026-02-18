import { useEffect } from "react";
import { useServerStore } from "@/stores/servers";
import { useAuthStore } from "@/stores/auth";
import { useWsStore } from "@/stores/ws";
import { AppLayout } from "@/components/layout/app-layout";

export function AppShell() {
  const fetchServers = useServerStore((s) => s.fetchServers);
  const tokens = useAuthStore((s) => s.tokens);
  const connect = useWsStore((s) => s.connect);
  const disconnect = useWsStore((s) => s.disconnect);
  const connected = useWsStore((s) => s.connected);

  useEffect(() => {
    if (connected) {
      fetchServers();
    }
  }, [connected, fetchServers]);

  useEffect(() => {
    // Request notification permission
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
  }, []);

  useEffect(() => {
    if (tokens?.accessToken) {
      connect(tokens.accessToken);
    }
    return () => {
      disconnect();
    };
  }, [tokens?.accessToken, connect, disconnect]);

  return <AppLayout />;
}
