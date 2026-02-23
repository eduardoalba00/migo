import { useState, useRef, useEffect } from "react";
import { Send, Plus } from "lucide-react";
import { useDmStore } from "@/stores/dms";
import { useAuthStore } from "@/stores/auth";
import { ScrollArea } from "@/components/ui/scroll-area";
import { api, resolveUploadUrl } from "@/lib/api";
import { UPLOAD_ROUTES } from "@migo/shared";
import { MarkdownRenderer } from "@/components/messages/markdown-renderer";
import { AttachmentRenderer } from "@/components/messages/attachment-renderer";
import { PendingFilePreview } from "@/components/messages/pending-file-preview";

export function DmView() {
  const activeDmId = useDmStore((s) => s.activeDmId);
  const messages = useDmStore((s) => s.messages);
  const channels = useDmStore((s) => s.channels);
  const sendMessage = useDmStore((s) => s.sendMessage);
  const user = useAuthStore((s) => s.user);

  const [content, setContent] = useState("");
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
    const trimmed = content.trim();
    if (!trimmed && pendingFiles.length === 0) return;

    const filesToUpload = [...pendingFiles];
    setContent("");
    setPendingFiles([]);

    try {
      let attachmentIds: string[] | undefined;
      if (filesToUpload.length > 0) {
        setUploading(true);
        try {
          attachmentIds = await Promise.all(
            filesToUpload.map(async (file) => {
              const formData = new FormData();
              formData.append("attachment", file);
              const res = await api.upload<{ id: string }>(UPLOAD_ROUTES.UPLOAD, formData);
              return res.id;
            }),
          );
        } finally {
          setUploading(false);
        }
      }
      await sendMessage(activeDmId, trimmed || "", attachmentIds);
    } catch {
      setContent(trimmed);
      setPendingFiles(filesToUpload);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setPendingFiles((prev) => [...prev, ...Array.from(e.target.files!)]);
    }
    e.target.value = "";
  };

  const removePendingFile = (index: number) => {
    setPendingFiles((prev) => prev.filter((_, i) => i !== index));
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
          {channelMessages.map((msg) => (
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
                {msg.content && (
                  <div className="text-sm">
                    <MarkdownRenderer content={msg.content} />
                  </div>
                )}
                {msg.attachments && msg.attachments.length > 0 && (
                  <AttachmentRenderer attachments={msg.attachments} />
                )}
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      {/* Input */}
      <div className="px-4 pb-4">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleFileSelect}
        />
        <PendingFilePreview files={pendingFiles} onRemove={removePendingFile} />
        <div className={`flex items-center bg-muted/50 ${pendingFiles.length > 0 ? "rounded-b-lg" : "rounded-lg"}`}>
          <div className="flex items-center px-3 py-2">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-7 h-7 rounded-full bg-muted-foreground/20 flex items-center justify-center hover:bg-muted-foreground/30 transition-colors"
            >
              <Plus className="h-4 w-4 text-muted-foreground" />
            </button>
          </div>
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
            disabled={(!content.trim() && pendingFiles.length === 0) || uploading}
            className="p-2 text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
