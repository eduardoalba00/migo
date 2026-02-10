import { MicOff, VolumeX, Monitor } from "lucide-react";
import { cn } from "@/lib/utils";
import type { VoiceChannelUser } from "@nexus/shared";

interface VoiceUserProps {
  user: VoiceChannelUser;
}

export function VoiceUser({ user }: VoiceUserProps) {
  return (
    <div className="flex items-center gap-2 px-2 py-0.5">
      <div
        className={cn(
          "w-6 h-6 rounded-full bg-sidebar-primary/60 flex items-center justify-center text-[10px] font-semibold ring-2 transition-colors",
          user.speaking ? "ring-green-500" : "ring-transparent",
        )}
      >
        {user.displayName?.charAt(0).toUpperCase() || user.username?.charAt(0).toUpperCase() || "?"}
      </div>
      <span className="text-sm text-muted-foreground truncate flex-1">
        {user.displayName || user.username}
      </span>
      {user.screenSharing && <Monitor className="h-3.5 w-3.5 text-green-500 shrink-0" />}
      {user.muted && <MicOff className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />}
      {user.deafened && <VolumeX className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />}
    </div>
  );
}
