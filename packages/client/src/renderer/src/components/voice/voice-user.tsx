import { MicOff, VolumeX } from "lucide-react";
import { cn } from "@/lib/utils";
import { useVoiceStore } from "@/stores/voice";
import { resolveUploadUrl } from "@/lib/api";
import type { VoiceChannelUser } from "@migo/shared";

interface VoiceUserProps {
  user: VoiceChannelUser;
}

export function VoiceUser({ user }: VoiceUserProps) {
  const speaking = useVoiceStore((s) => s.speakingUsers.has(user.userId));
  const focusScreenShare = useVoiceStore((s) => s.focusScreenShare);
  const joinStream = useVoiceStore((s) => s.joinStream);
  const isJoined = useVoiceStore((s) => s.joinedStreams.has(user.userId));
  const avatarSrc = resolveUploadUrl(user.avatarUrl);

  const handleClick = user.screenSharing
    ? () => {
        if (isJoined) {
          focusScreenShare(user.userId);
        } else {
          joinStream(user.userId);
        }
      }
    : undefined;

  return (
    <div
      className={cn(
        "flex items-center gap-2 px-2 py-0.5",
        user.screenSharing && "cursor-pointer hover:bg-sidebar-accent/50 rounded-md",
      )}
      onClick={handleClick}
    >
      <div
        className={cn(
          "w-6 h-6 rounded-full bg-sidebar-primary/60 flex items-center justify-center text-[10px] font-semibold ring-2 transition-colors duration-200 shrink-0 overflow-hidden",
          speaking ? "ring-green-500" : "ring-transparent",
        )}
      >
        {avatarSrc ? (
          <img src={avatarSrc} className="w-6 h-6 rounded-full object-cover" alt="" />
        ) : (
          user.displayName?.charAt(0).toUpperCase() || user.username?.charAt(0).toUpperCase() || "?"
        )}
      </div>
      <span className="text-sm text-muted-foreground truncate flex-1">
        {user.displayName || user.username}
      </span>
      {user.screenSharing && (
        <span className="text-[10px] font-bold text-white bg-red-600 px-1.5 py-0.5 rounded shrink-0 leading-none">
          Live
        </span>
      )}
      {user.muted && <MicOff className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />}
      {user.deafened && <VolumeX className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />}
    </div>
  );
}
