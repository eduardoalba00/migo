import { useEffect } from "react";
import { MessageCircle } from "lucide-react";
import { useDmStore } from "@/stores/dms";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { resolveUploadUrl } from "@/lib/api";

export function DmSidebar() {
  const channels = useDmStore((s) => s.channels);
  const activeDmId = useDmStore((s) => s.activeDmId);
  const setActiveDm = useDmStore((s) => s.setActiveDm);
  const fetchDmChannels = useDmStore((s) => s.fetchDmChannels);
  const fetchMessages = useDmStore((s) => s.fetchMessages);

  useEffect(() => {
    fetchDmChannels();
  }, [fetchDmChannels]);

  const handleSelect = (channelId: string) => {
    setActiveDm(channelId);
    fetchMessages(channelId);
  };

  return (
    <div className="flex flex-col w-60 bg-card">
      <div className="flex items-center px-4 h-12 border-b-2 border-border">
        <span className="font-semibold">Direct Messages</span>
      </div>

      <ScrollArea className="flex-1">
        <div className="px-2 py-2 space-y-0.5">
          {channels.length === 0 && (
            <p className="text-xs text-muted-foreground px-2 py-4 text-center">
              No conversations yet
            </p>
          )}
          {channels.map((dm) => {
            const recipient = dm.recipients[0];
            if (!recipient) return null;
            return (
              <button
                key={dm.id}
                onClick={() => handleSelect(dm.id)}
                className={cn(
                  "flex items-center gap-2 w-full px-2 py-2 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors",
                  activeDmId === dm.id && "bg-muted text-foreground",
                )}
              >
                <div className="w-8 h-8 rounded-full bg-sidebar-primary text-sidebar-primary-foreground flex items-center justify-center text-xs font-semibold shrink-0">
                  {recipient.avatarUrl ? (
                    <img src={resolveUploadUrl(recipient.avatarUrl)!} className="w-8 h-8 rounded-full object-cover" alt="" />
                  ) : (
                    recipient.displayName.charAt(0).toUpperCase()
                  )}
                </div>
                <span className="truncate">{recipient.displayName}</span>
              </button>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
