import { useState } from "react";
import { cn } from "@/lib/utils";
import { resolveUploadUrl } from "@/lib/api";
import type { ServerMember, UserStatus } from "@nexus/shared";
import { UserProfilePopup } from "./user-profile-popup";

interface MemberItemProps {
  member: ServerMember;
  status: UserStatus;
}

const STATUS_COLORS: Record<UserStatus, string> = {
  online: "bg-green-500",
  idle: "bg-yellow-500",
  dnd: "bg-red-500",
  offline: "bg-gray-500",
};

export function MemberItem({ member, status }: MemberItemProps) {
  const [showProfile, setShowProfile] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setShowProfile(!showProfile)}
        className={cn(
          "w-full flex items-center gap-2 px-4 py-1.5 hover:bg-muted/50 transition-colors text-left",
          status === "offline" && "opacity-50",
        )}
      >
        <div className="relative">
          <div className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-semibold">
            {member.user.avatarUrl ? (
              <img src={resolveUploadUrl(member.user.avatarUrl)!} className="w-8 h-8 rounded-full object-cover" alt="" />
            ) : (
              member.user.displayName.charAt(0).toUpperCase()
            )}
          </div>
          <div
            className={cn(
              "absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-card",
              STATUS_COLORS[status],
            )}
          />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{member.user.displayName}</p>
          {member.user.customStatus && (
            <p className="text-xs text-muted-foreground truncate">{member.user.customStatus}</p>
          )}
        </div>
      </button>
      {showProfile && (
        <UserProfilePopup member={member} onClose={() => setShowProfile(false)} />
      )}
    </div>
  );
}
