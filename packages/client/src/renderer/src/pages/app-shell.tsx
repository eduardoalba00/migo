import { useEffect } from "react";
import { useServerStore } from "@/stores/servers";
import { useAuthStore } from "@/stores/auth";
import { useWsStore } from "@/stores/ws";
import { useChannelStore } from "@/stores/channels";
import { useMemberStore } from "@/stores/members";
import { useVoiceStore } from "@/stores/voice";
import { AppLayout } from "@/components/layout/app-layout";

export function AppShell() {
  const fetchServers = useServerStore((s) => s.fetchServers);
  const activeServerId = useServerStore((s) => s.activeServerId);
  const tokens = useAuthStore((s) => s.tokens);
  const connect = useWsStore((s) => s.connect);
  const disconnect = useWsStore((s) => s.disconnect);
  const connected = useWsStore((s) => s.connected);
  const fetchChannels = useChannelStore((s) => s.fetchChannels);
  const fetchMembers = useMemberStore((s) => s.fetchMembers);
  const reannounceVoiceState = useVoiceStore((s) => s.reannounceVoiceState);

  useEffect(() => {
    if (connected) {
      fetchServers();
      // On reconnect, refresh channels + members for the active server
      // and re-announce voice state so the server knows we're still in a channel
      if (activeServerId) {
        fetchChannels(activeServerId);
        fetchMembers(activeServerId);
      }
      reannounceVoiceState();
    }
  }, [connected, fetchServers, activeServerId, fetchChannels, fetchMembers, reannounceVoiceState]);

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
