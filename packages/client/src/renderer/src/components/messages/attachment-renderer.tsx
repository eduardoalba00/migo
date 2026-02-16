import { Download, FileText, Film, Music } from "lucide-react";
import type { Attachment } from "@migo/shared";
import { useWorkspaceStore } from "@/stores/workspace";

interface AttachmentRendererProps {
  attachments: Attachment[];
}

function getFullUrl(url: string): string {
  const workspace = useWorkspaceStore.getState();
  const active = workspace.workspaces.find((w) => w.id === workspace.activeWorkspaceId);
  const baseUrl = active?.url || "http://localhost:3000";
  return `${baseUrl}${url}`;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isImage(mimeType: string): boolean {
  return mimeType.startsWith("image/");
}

function isVideo(mimeType: string): boolean {
  return mimeType.startsWith("video/");
}

function isAudio(mimeType: string): boolean {
  return mimeType.startsWith("audio/");
}

export function AttachmentRenderer({ attachments }: AttachmentRendererProps) {
  if (!attachments?.length) return null;

  return (
    <div className="flex flex-col gap-2 mt-1">
      {attachments.map((attachment) => {
        const fullUrl = getFullUrl(attachment.url);

        if (isImage(attachment.mimeType)) {
          return (
            <a key={attachment.id} href={fullUrl} target="_blank" rel="noopener noreferrer">
              <img
                src={fullUrl}
                alt={attachment.originalName}
                className="max-w-sm max-h-80 rounded-lg border border-border object-contain"
                loading="lazy"
              />
            </a>
          );
        }

        if (isVideo(attachment.mimeType)) {
          return (
            <video
              key={attachment.id}
              src={fullUrl}
              controls
              className="max-w-sm max-h-80 rounded-lg border border-border"
            >
              <track kind="captions" />
            </video>
          );
        }

        if (isAudio(attachment.mimeType)) {
          return (
            <div key={attachment.id} className="flex items-center gap-2 p-2 bg-muted rounded-lg max-w-sm">
              <Music className="h-5 w-5 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{attachment.originalName}</p>
                <audio src={fullUrl} controls className="w-full mt-1" />
              </div>
            </div>
          );
        }

        // Generic file
        return (
          <a
            key={attachment.id}
            href={fullUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 p-3 bg-muted rounded-lg max-w-sm hover:bg-muted/80 transition-colors"
          >
            <FileText className="h-8 w-8 text-primary shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate text-primary">{attachment.originalName}</p>
              <p className="text-xs text-muted-foreground">{formatSize(attachment.size)}</p>
            </div>
            <Download className="h-4 w-4 text-muted-foreground shrink-0" />
          </a>
        );
      })}
    </div>
  );
}
