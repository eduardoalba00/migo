import { useState, useRef, useCallback, useEffect } from "react";
import { Plus, SendHorizontal, X, Smile } from "lucide-react";
import { useMessageStore } from "@/stores/messages";
import { useServerStore } from "@/stores/servers";
import { EmojiPicker } from "@/components/messages/emoji-picker";
import { wsManager } from "@/lib/ws";
import { WsOpcode, SERVER_ROUTES, UPLOAD_ROUTES, buildRoute } from "@migo/shared";
import type { ServerMember } from "@migo/shared";
import { api, resolveUploadUrl } from "@/lib/api";
import { PendingFilePreview } from "@/components/messages/pending-file-preview";

interface MessageInputProps {
  channelId: string;
  channelName?: string;
}

export function MessageInput({ channelId, channelName }: MessageInputProps) {
  const [content, setContent] = useState("");
  const sendMessage = useMessageStore((s) => s.sendMessage);
  const replyContext = useMessageStore((s) => s.replyContext);
  const setReplyContext = useMessageStore((s) => s.setReplyContext);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastTypingSent = useRef(0);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);

  // Mention autocomplete state
  const [showMentions, setShowMentions] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [members, setMembers] = useState<ServerMember[]>([]);
  const [mentionIdx, setMentionIdx] = useState(0);
  const activeServerId = useServerStore((s) => s.activeServerId);

  // Fetch members for autocomplete
  useEffect(() => {
    if (!activeServerId) return;
    api
      .get<ServerMember[]>(buildRoute(SERVER_ROUTES.MEMBERS, { serverId: activeServerId }))
      .then(setMembers)
      .catch(() => {});
  }, [activeServerId]);

  const filteredMembers = mentionQuery
    ? members.filter(
        (m) =>
          m.user.username.toLowerCase().includes(mentionQuery.toLowerCase()) ||
          m.user.displayName.toLowerCase().includes(mentionQuery.toLowerCase()),
      )
    : members;

  // Clear reply context when channel changes
  useEffect(() => {
    setReplyContext(null);
  }, [channelId, setReplyContext]);

  const handleSubmit = async () => {
    const trimmed = content.trim();
    if (!trimmed && pendingFiles.length === 0) return;

    const filesToUpload = [...pendingFiles];
    setContent("");
    setPendingFiles([]);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }

    const replyToId = replyContext?.messageId;
    setReplyContext(null);

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
      await sendMessage(channelId, trimmed || "", replyToId, attachmentIds);
    } catch {
      setContent(trimmed);
      setPendingFiles(filesToUpload);
    }
  };

  const sendTyping = useCallback(() => {
    const now = Date.now();
    if (now - lastTypingSent.current > 5000) {
      lastTypingSent.current = now;
      wsManager.send({
        op: WsOpcode.TYPING_START,
        d: { channelId },
      });
    }
  }, [channelId]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (showMentions && filteredMembers.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionIdx((i) => Math.min(i + 1, filteredMembers.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionIdx((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Tab" || e.key === "Enter") {
        e.preventDefault();
        insertMention(filteredMembers[mentionIdx]);
        return;
      }
      if (e.key === "Escape") {
        setShowMentions(false);
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const insertMention = (member: ServerMember) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const cursor = textarea.selectionStart;
    const text = content;
    // Find the @ that triggered this
    const beforeCursor = text.slice(0, cursor);
    const atIdx = beforeCursor.lastIndexOf("@");
    if (atIdx === -1) return;

    const before = text.slice(0, atIdx);
    const after = text.slice(cursor);
    const newContent = `${before}@${member.user.username} ${after}`;
    setContent(newContent);
    setShowMentions(false);
    setMentionQuery("");

    // Focus and set cursor
    setTimeout(() => {
      const newPos = atIdx + member.user.username.length + 2;
      textarea.focus();
      textarea.setSelectionRange(newPos, newPos);
    }, 0);
  };

  const handleInput = () => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setContent(val);
    sendTyping();

    // Check for @ mention trigger
    const cursor = e.target.selectionStart;
    const textBefore = val.slice(0, cursor);
    const atMatch = textBefore.match(/@(\w*)$/);
    if (atMatch) {
      setShowMentions(true);
      setMentionQuery(atMatch[1]);
      setMentionIdx(0);
    } else {
      setShowMentions(false);
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

  const handleEmojiInsert = (emoji: string) => {
    const textarea = textareaRef.current;
    if (textarea) {
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const newContent = content.slice(0, start) + emoji + content.slice(end);
      setContent(newContent);
      setTimeout(() => {
        textarea.focus();
        textarea.setSelectionRange(start + emoji.length, start + emoji.length);
      }, 0);
    } else {
      setContent((c) => c + emoji);
    }
  };

  return (
    <div className="px-4 pb-4 pt-1 shrink-0">
      {replyContext && (
        <div className="flex items-center gap-2 px-4 py-1.5 mb-1 bg-muted/50 rounded-t-lg text-xs text-muted-foreground">
          <span>
            Replying to <span className="font-semibold text-foreground">{replyContext.author}</span>
          </span>
          <span className="truncate max-w-[300px]">{replyContext.content}</span>
          <button
            onClick={() => setReplyContext(null)}
            className="ml-auto text-muted-foreground hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      <div className="relative">
        {showMentions && filteredMembers.length > 0 && (
          <div className="absolute bottom-full left-0 right-0 mb-1 bg-card border border-border rounded-lg shadow-lg max-h-48 overflow-y-auto z-50">
            {filteredMembers.slice(0, 10).map((member, i) => (
              <button
                key={member.id}
                className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-muted ${
                  i === mentionIdx ? "bg-muted" : ""
                }`}
                onClick={() => insertMention(member)}
              >
                <div className="w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-semibold">
                  {member.user.avatarUrl ? (
                    <img src={resolveUploadUrl(member.user.avatarUrl)!} className="w-6 h-6 rounded-full object-cover" alt="" />
                  ) : (
                    member.user.displayName.charAt(0).toUpperCase()
                  )}
                </div>
                <span className="font-medium">{member.user.displayName}</span>
                <span className="text-muted-foreground">@{member.user.username}</span>
              </button>
            ))}
          </div>
        )}
        <PendingFilePreview files={pendingFiles} onRemove={removePendingFile} />
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleFileSelect}
        />
        <div className={`flex items-center bg-muted/50 ${pendingFiles.length > 0 ? "rounded-b-lg" : "rounded-lg"}`}>
          <div className="flex items-center px-3 pb-3 pt-3">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-7 h-7 rounded-full bg-muted-foreground/20 flex items-center justify-center hover:bg-muted-foreground/30 transition-colors"
            >
              <Plus className="h-4 w-4 text-muted-foreground" />
            </button>
          </div>
          <textarea
            ref={textareaRef}
            value={content}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onInput={handleInput}
            placeholder={channelName ? `Message #${channelName}` : "Send a message..."}
            className="flex-1 py-3 bg-transparent border-none text-sm resize-none outline-none max-h-[200px] placeholder:text-muted-foreground"
            rows={1}
          />
          <div className="flex items-center gap-1 px-3 pb-3 pt-3">
            <EmojiPicker onSelect={handleEmojiInsert} />
            <button
              onClick={handleSubmit}
              disabled={(!content.trim() && pendingFiles.length === 0) || uploading}
              className="text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
            >
              <SendHorizontal className="h-5 w-5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
