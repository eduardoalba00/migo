import { useState } from "react";
import { Pencil, Trash2, Reply, Pin, PinOff, Smile } from "lucide-react";
import { useAuthStore } from "@/stores/auth";
import { useMessageStore } from "@/stores/messages";
import { cn } from "@/lib/utils";
import { MarkdownRenderer } from "@/components/messages/markdown-renderer";
import { EmojiPicker } from "@/components/messages/emoji-picker";
import { AttachmentRenderer } from "@/components/messages/attachment-renderer";
import { resolveUploadUrl } from "@/lib/api";
import type { Message } from "@migo/shared";

interface MessageItemProps {
  message: Message;
  compact: boolean;
}

function formatTime(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (d.toDateString() === today.toDateString()) return `Today at ${formatTime(dateStr)}`;
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday at ${formatTime(dateStr)}`;
  return `${d.toLocaleDateString()} ${formatTime(dateStr)}`;
}

export function MessageItem({ message, compact }: MessageItemProps) {
  const user = useAuthStore((s) => s.user);
  const editMessage = useMessageStore((s) => s.editMessage);
  const deleteMessage = useMessageStore((s) => s.deleteMessage);
  const setReplyContext = useMessageStore((s) => s.setReplyContext);
  const addReaction = useMessageStore((s) => s.addReaction);
  const removeReaction = useMessageStore((s) => s.removeReaction);
  const pinMessage = useMessageStore((s) => s.pinMessage);
  const unpinMessage = useMessageStore((s) => s.unpinMessage);
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState(message.content);

  const isOwn = user?.id === message.author.id;

  const handleEdit = async () => {
    if (!editContent.trim() || editContent === message.content) {
      setEditing(false);
      return;
    }
    await editMessage(message.channelId, message.id, editContent.trim());
    setEditing(false);
  };

  const handleEditKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleEdit();
    }
    if (e.key === "Escape") {
      setEditing(false);
      setEditContent(message.content);
    }
  };

  const handleDelete = async () => {
    await deleteMessage(message.channelId, message.id);
  };

  const handleReply = () => {
    setReplyContext({
      messageId: message.id,
      author: message.author.displayName,
      content: message.content,
    });
  };

  const handleReactionClick = (emoji: string, hasReacted: boolean) => {
    if (hasReacted) {
      removeReaction(message.channelId, message.id, emoji);
    } else {
      addReaction(message.channelId, message.id, emoji);
    }
  };

  const handlePin = () => {
    if (message.pinnedAt) {
      unpinMessage(message.channelId, message.id);
    } else {
      pinMessage(message.channelId, message.id);
    }
  };

  const ReplyRef = () => {
    if (!message.replyTo) return null;
    return (
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-0.5 ml-10 pl-4 border-l-2 border-muted-foreground/30">
        <Reply className="h-3 w-3 rotate-180" />
        <span className="font-semibold text-foreground/70">{message.replyTo.author.displayName}</span>
        <span className="truncate max-w-[300px]">{message.replyTo.content}</span>
      </div>
    );
  };

  const Reactions = () => {
    if (!message.reactions?.length) return null;
    return (
      <div className="flex flex-wrap gap-1 mt-1">
        {message.reactions.map((r) => (
          <button
            key={r.emoji}
            onClick={() => handleReactionClick(r.emoji, r.me)}
            className={cn(
              "inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs border transition-colors",
              r.me
                ? "bg-primary/20 border-primary/40 text-primary"
                : "bg-muted border-border text-muted-foreground hover:border-primary/40",
            )}
          >
            <span>{r.emoji}</span>
            <span>{r.count}</span>
          </button>
        ))}
        <EmojiPicker
          onSelect={(emoji) => addReaction(message.channelId, message.id, emoji)}
          trigger={<Smile className="h-3.5 w-3.5" />}
        />
      </div>
    );
  };

  const ActionToolbar = () => {
    if (editing) return null;
    return (
      <div className="hidden group-hover:flex absolute p-1 -top-2 right-5 bg-card border border-border rounded-md shadow-sm gap-0.5">
        <button
          onClick={handleReply}
          className="p-1 text-muted-foreground hover:text-foreground rounded transition-colors"
          title="Reply"
        >
          <Reply className="h-3.5 w-3.5" />
        </button>
        <EmojiPicker
          onSelect={(emoji) => addReaction(message.channelId, message.id, emoji)}
        />
        <button
          onClick={handlePin}
          className="p-1 text-muted-foreground hover:text-foreground rounded transition-colors"
          title={message.pinnedAt ? "Unpin" : "Pin"}
        >
          {message.pinnedAt ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
        </button>
        {isOwn && (
          <button
            onClick={() => { setEditing(true); setEditContent(message.content); }}
            className="p-1 text-muted-foreground hover:text-foreground rounded transition-colors"
            title="Edit"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        )}
        {isOwn && (
          <button
            onClick={handleDelete}
            className="p-1 text-muted-foreground hover:text-destructive rounded transition-colors"
            title="Delete"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    );
  };

  const MessageContent = () => {
    if (editing) {
      return (
        <div className="space-y-1">
          <textarea
            ref={(el) => {
              if (el) {
                el.focus();
                el.setSelectionRange(el.value.length, el.value.length);
              }
            }}
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            onKeyDown={handleEditKeyDown}
            className="w-full bg-muted border-none rounded-md px-2 py-1 text-sm resize-none outline-none"
            rows={1}
          />
          <p className="text-xs text-muted-foreground">
            Press Escape to cancel, Enter to save
          </p>
        </div>
      );
    }
    return (
      <>
        <MarkdownRenderer content={message.content} className="text-sm" />
        {message.editedAt && (
          <span className="text-[10px] text-muted-foreground ml-1">(edited)</span>
        )}
        {message.pinnedAt && (
          <Pin className="inline h-3 w-3 text-muted-foreground ml-1" />
        )}
        <AttachmentRenderer attachments={message.attachments} />
      </>
    );
  };

  if (compact) {
    return (
      <>
        <ReplyRef />
        <div className="relative group flex items-start hover:bg-muted/30 pl-4 pr-4 py-0.5">
          <div className="w-10 shrink-0 flex justify-center">
            <span className="hidden group-hover:inline text-[10px] text-muted-foreground leading-[22px]">
              {formatTime(message.createdAt)}
            </span>
          </div>
          <div className="flex-1 min-w-0 ml-4">
            <MessageContent />
            <Reactions />
          </div>
          <ActionToolbar />
        </div>
      </>
    );
  }

  return (
    <>
      <ReplyRef />
      <div className="relative group flex items-start hover:bg-muted/30 p-4 gap-4">
        <div className="w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-semibold shrink-0 hover:drop-shadow-md">
          {message.author.avatarUrl ? (
            <img src={resolveUploadUrl(message.author.avatarUrl)!} className="w-10 h-10 rounded-full object-cover" alt="" />
          ) : (
            message.author.displayName.charAt(0).toUpperCase()
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="font-semibold text-sm hover:underline cursor-pointer">{message.author.displayName}</span>
            <span className="text-xs text-muted-foreground">{formatDate(message.createdAt)}</span>
          </div>
          {editing ? (
            <div className="space-y-1 mt-1">
              <textarea
                ref={(el) => {
                  if (el) {
                    el.focus();
                    el.setSelectionRange(el.value.length, el.value.length);
                  }
                }}
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                onKeyDown={handleEditKeyDown}
                className="w-full bg-muted border-none rounded-md px-2 py-1 text-sm resize-none outline-none"
                rows={1}
              />
              <p className="text-xs text-muted-foreground">
                Press Escape to cancel, Enter to save
              </p>
            </div>
          ) : (
            <>
              <MessageContent />
              <Reactions />
            </>
          )}
        </div>
        <ActionToolbar />
      </div>
    </>
  );
}
