import { Mic, MicOff, Headphones, HeadphoneOff, PhoneOff, Monitor, MonitorOff, AudioLines } from "lucide-react";
import { useVoiceStore } from "@/stores/voice";
import { useAuthStore } from "@/stores/auth";
import { cn } from "@/lib/utils";
import { ScreenSharePicker } from "./screen-share-picker";

export function VoicePanel() {
  const currentChannelId = useVoiceStore((s) => s.currentChannelId);
  const isConnecting = useVoiceStore((s) => s.isConnecting);
  const isMuted = useVoiceStore((s) => s.isMuted);
  const isDeafened = useVoiceStore((s) => s.isDeafened);
  const speakingUsers = useVoiceStore((s) => s.speakingUsers);
  const userId = useAuthStore((s) => s.user?.id);
  const isSpeaking = userId ? speakingUsers.has(userId) : false;
  const isScreenSharing = useVoiceStore((s) => s.isScreenSharing);
  const noiseSuppression = useVoiceStore((s) => s.noiseSuppression);
  const noiseSuppressionMode = useVoiceStore((s) => s.noiseSuppressionMode);
  const toggleNoiseSuppression = useVoiceStore((s) => s.toggleNoiseSuppression);
  const leaveChannel = useVoiceStore((s) => s.leaveChannel);
  const toggleMute = useVoiceStore((s) => s.toggleMute);
  const toggleDeafen = useVoiceStore((s) => s.toggleDeafen);
  const toggleScreenShare = useVoiceStore((s) => s.toggleScreenShare);

  if (!currentChannelId) return null;

  return (
    <div className="border-t border-border bg-card px-3 py-2">
      <div className="flex items-center gap-2 mb-2">
        <div
          className={cn(
            "w-2 h-2 rounded-full",
            isConnecting ? "bg-yellow-500 animate-pulse" : "bg-green-500",
            isSpeaking && !isMuted && "ring-2 ring-green-500 ring-offset-1 ring-offset-card",
          )}
        />
        <span className="text-xs font-medium text-green-500">
          {isConnecting ? "Connecting..." : "Voice Connected"}
        </span>
      </div>
      <div className="flex items-center gap-1">
        <button
          onClick={toggleMute}
          className={cn(
            "p-2 rounded-md hover:bg-muted transition-colors",
            isMuted && "text-destructive",
          )}
          title={isMuted ? "Unmute" : "Mute"}
        >
          {isMuted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
        </button>
        <button
          onClick={toggleDeafen}
          className={cn(
            "p-2 rounded-md hover:bg-muted transition-colors",
            isDeafened && "text-destructive",
          )}
          title={isDeafened ? "Undeafen" : "Deafen"}
        >
          {isDeafened ? <HeadphoneOff className="h-4 w-4" /> : <Headphones className="h-4 w-4" />}
        </button>
        <button
          onClick={toggleScreenShare}
          disabled={isConnecting}
          className={cn(
            "p-2 rounded-md hover:bg-muted transition-colors",
            isScreenSharing && "text-green-500 bg-green-500/10",
          )}
          title={isScreenSharing ? "Stop Sharing" : "Share Screen"}
        >
          {isScreenSharing ? <MonitorOff className="h-4 w-4" /> : <Monitor className="h-4 w-4" />}
        </button>
        <button
          onClick={toggleNoiseSuppression}
          disabled={isConnecting}
          className={cn(
            "p-2 rounded-md hover:bg-muted transition-colors",
            noiseSuppression && "text-green-500 bg-green-500/10",
          )}
          title={
            noiseSuppression
              ? noiseSuppressionMode === "krisp"
                ? "Noise Suppression (Enhanced)"
                : "Noise Suppression (Standard)"
              : "Noise Suppression Off"
          }
        >
          <AudioLines className="h-4 w-4" />
        </button>
        <button
          onClick={leaveChannel}
          className="p-2 rounded-md hover:bg-destructive/20 text-destructive transition-colors ml-auto"
          title="Disconnect"
        >
          <PhoneOff className="h-4 w-4" />
        </button>
      </div>
      <ScreenSharePicker />
    </div>
  );
}
