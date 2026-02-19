import { useRef, useLayoutEffect, useState } from "react";
import { X, MessageCircle } from "lucide-react";
import { createPortal } from "react-dom";
import { resolveUploadUrl } from "@/lib/api";
import type { ServerMember } from "@migo/shared";
import { useAuthStore } from "@/stores/auth";
import { useDmStore } from "@/stores/dms";
import { useServerStore } from "@/stores/servers";

interface UserProfilePopupProps {
  member: ServerMember;
  anchorRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function UserProfilePopup({ member, anchorRef, onClose }: UserProfilePopupProps) {
  const currentUser = useAuthStore((s) => s.user);
  const createDm = useDmStore((s) => s.createDm);
  const setActiveDm = useDmStore((s) => s.setActiveDm);
  const fetchMessages = useDmStore((s) => s.fetchMessages);
  const setActiveServer = useServerStore((s) => s.setActiveServer);
  const popupRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const isMe = currentUser?.id === member.user.id;

  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const popupWidth = 288; // w-72 = 18rem = 288px
    const popupHeight = 320; // approximate
    let top = rect.top;
    let left = rect.left - popupWidth - 8;

    // If it would go off the left edge, show to the right instead
    if (left < 8) {
      left = rect.right + 8;
    }
    // If it would go off the bottom, shift up
    if (top + popupHeight > window.innerHeight - 8) {
      top = window.innerHeight - popupHeight - 8;
    }
    if (top < 8) top = 8;

    setPos({ top, left });
  }, [anchorRef]);

  const handleMessage = async () => {
    const dm = await createDm(member.user.id);
    setActiveServer(null);
    setActiveDm(dm.id);
    fetchMessages(dm.id);
    onClose();
  };

  return createPortal(
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        ref={popupRef}
        className="fixed z-50 w-72 bg-card border border-border rounded-lg shadow-lg overflow-hidden"
        style={pos ? { top: pos.top, left: pos.left } : { visibility: "hidden" }}
      >
        <div className="h-16 bg-primary/20" />
        <div className="px-4 pb-4 -mt-8">
          <div className="w-16 h-16 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xl font-bold border-4 border-card">
            {member.user.avatarUrl ? (
              <img src={resolveUploadUrl(member.user.avatarUrl)!} className="w-16 h-16 rounded-full object-cover" alt="" />
            ) : (
              member.user.displayName.charAt(0).toUpperCase()
            )}
          </div>
          <div className="mt-2">
            <h3 className="text-lg font-bold">{member.user.displayName}</h3>
            <p className="text-sm text-muted-foreground">@{member.user.username}</p>
          </div>
          {member.user.customStatus && (
            <p className="text-sm mt-1">{member.user.customStatus}</p>
          )}
          <div className="mt-3 pt-3 border-t border-border space-y-1.5">
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase">Member Since</p>
              <p className="text-sm">{formatDate(member.joinedAt)}</p>
            </div>
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase">Account Created</p>
              <p className="text-sm">{formatDate(member.user.createdAt)}</p>
            </div>
          </div>
          {!isMe && (
            <button
              onClick={handleMessage}
              className="mt-3 w-full flex items-center justify-center gap-2 px-3 py-2 bg-primary text-primary-foreground rounded text-sm font-medium hover:bg-primary/90"
            >
              <MessageCircle className="h-4 w-4" />
              Message
            </button>
          )}
        </div>
        <button
          onClick={onClose}
          className="absolute top-2 right-2 p-1 text-muted-foreground hover:text-foreground rounded"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </>,
    document.body,
  );
}
