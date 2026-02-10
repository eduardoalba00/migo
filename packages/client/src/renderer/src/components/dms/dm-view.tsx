import { useState, useRef, useEffect } from "react";
import { Send } from "lucide-react";
import { useDmStore } from "@/stores/dms";
import { useAuthStore } from "@/stores/auth";
import { ScrollArea } from "@/components/ui/scroll-area";
import { resolveUploadUrl } from "@/lib/api";
import { MarkdownRenderer } from "@/components/messages/markdown-renderer";

export function DmView() {
  const activeDmId = useDmStore((s) => s.activeDmId);
  const messages = useDmStore((s) => s.messages);
  const channels = useDmStore((s) => s.channels);
  const sendMessage = useDmStore((s) => s.sendMessage);
  const user = useAuthStore((s) => s.user);

  const [content, setContent] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const channel = channels.find((c) => c.id === activeDmId);
  const recipient = channel?.recipients[0];
  const channelMessages = activeDmId ? messages[activeDmId] || [] : [];

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [channelMessages.length]);

  if (!activeDmId || !channel) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        Select a conversation to start chatting
      </div>
    );
  }

  const handleSend = async () => {
    if (!content.trim()) return;
    await sendMessage(activeDmId, content.trim());
    setContent("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex-1 flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 h-12 border-b-2 border-border">
        <div className="w-6 h-6 rounded-full bg-sidebar-primary text-sidebar-primary-foreground flex items-center justify-center text-xs font-semibold">
          {recipient?.avatarUrl ? (
            <img src={resolveUploadUrl(recipient.avatarUrl)!} className="w-6 h-6 rounded-full object-cover" alt="" />
          ) : (
            recipient?.displayName.charAt(0).toUpperCase() || "?"
          )}
        </div>
        <span className="font-semibold">{recipient?.displayName}</span>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 px-4">
        <div className="py-4 space-y-3">
          {channelMessages.map((msg) => {
            const isMe = msg.author.id === user?.id;
            return (
              <div key={msg.id} className="flex items-start gap-2">
                <div className="w-8 h-8 rounded-full bg-sidebar-primary text-sidebar-primary-foreground flex items-center justify-center text-xs font-semibold shrink-0 mt-0.5">
                  {msg.author.avatarUrl ? (
                    <img src={resolveUploadUrl(msg.author.avatarUrl)!} className="w-8 h-8 rounded-full object-cover" alt="" />
                  ) : (
                    msg.author.displayName.charAt(0).toUpperCase()
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className="font-semibold text-sm">{msg.author.displayName}</span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(msg.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                  <div className="text-sm">
                    <MarkdownRenderer content={msg.content} />
                  </div>
                </div>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      {/* Input */}
      <div className="px-4 pb-4">
        <div className="flex items-center gap-2 bg-muted rounded-lg px-3 py-2">
          <input
            type="text"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`Message @${recipient?.displayName || "..."}`}
            className="flex-1 bg-transparent outline-none text-sm"
          />
          <button
            onClick={handleSend}
            disabled={!content.trim()}
            className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
