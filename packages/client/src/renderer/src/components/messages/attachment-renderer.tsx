import { useState } from "react";
import { Download, FileText, Film, Music } from "lucide-react";
import type { Attachment } from "@migo/shared";
import { useWorkspaceStore } from "@/stores/workspace";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";

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

async function downloadFile(url: string, filename: string) {
  const res = await fetch(url);
  const blob = await res.blob();
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = blobUrl;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(blobUrl);
}

function PreviewDialog({
  attachment,
  open,
  onClose,
}: {
  attachment: Attachment;
  open: boolean;
  onClose: () => void;
}) {
  const fullUrl = getFullUrl(attachment.url);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col p-0 gap-0 overflow-hidden">
        <DialogTitle className="sr-only">{attachment.originalName}</DialogTitle>

        {/* Preview area */}
        <div className="flex-1 min-h-0 flex items-center justify-center bg-black/20 overflow-auto p-4">
          {isImage(attachment.mimeType) ? (
            <img
              src={fullUrl}
              alt={attachment.originalName}
              className="max-w-full max-h-[70vh] object-contain rounded"
            />
          ) : isVideo(attachment.mimeType) ? (
            <video
              src={fullUrl}
              controls
              autoPlay
              className="max-w-full max-h-[70vh] rounded"
            >
              <track kind="captions" />
            </video>
          ) : isAudio(attachment.mimeType) ? (
            <div className="flex flex-col items-center gap-4 p-8">
              <Music className="h-16 w-16 text-muted-foreground" />
              <audio src={fullUrl} controls autoPlay className="w-80" />
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 p-8">
              <FileText className="h-20 w-20 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">No preview available</p>
            </div>
          )}
        </div>

        {/* Footer with filename + download */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-border">
          <div className="min-w-0">
            <p className="text-sm font-medium truncate">{attachment.originalName}</p>
            <p className="text-xs text-muted-foreground">{formatSize(attachment.size)}</p>
          </div>
          <button
            onClick={() => downloadFile(fullUrl, attachment.originalName)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors shrink-0"
          >
            <Download className="h-4 w-4" />
            Download
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function AttachmentRenderer({ attachments }: AttachmentRendererProps) {
  const [previewAttachment, setPreviewAttachment] = useState<Attachment | null>(null);

  if (!attachments?.length) return null;

  return (
    <>
      <div className="flex flex-col gap-2 mt-1">
        {attachments.map((attachment) => {
          const fullUrl = getFullUrl(attachment.url);

          if (isImage(attachment.mimeType)) {
            return (
              <button
                key={attachment.id}
                onClick={() => setPreviewAttachment(attachment)}
                className="block text-left"
              >
                <img
                  src={fullUrl}
                  alt={attachment.originalName}
                  className="max-w-sm max-h-80 rounded-lg border border-border object-contain hover:brightness-90 transition-all cursor-pointer"
                  loading="lazy"
                />
              </button>
            );
          }

          if (isVideo(attachment.mimeType)) {
            return (
              <div key={attachment.id} className="relative max-w-sm">
                <video
                  src={fullUrl}
                  controls
                  className="max-w-sm max-h-80 rounded-lg border border-border"
                >
                  <track kind="captions" />
                </video>
                <button
                  onClick={() => setPreviewAttachment(attachment)}
                  className="absolute top-2 right-2 p-1.5 rounded-md bg-black/60 hover:bg-black/80 transition-colors"
                  title="Expand"
                >
                  <Film className="h-3.5 w-3.5 text-white" />
                </button>
              </div>
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

          // Generic file — click to preview
          return (
            <button
              key={attachment.id}
              onClick={() => setPreviewAttachment(attachment)}
              className="flex items-center gap-3 p-3 bg-muted rounded-lg max-w-sm hover:bg-muted/80 transition-colors text-left"
            >
              <FileText className="h-8 w-8 text-primary shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate text-primary">{attachment.originalName}</p>
                <p className="text-xs text-muted-foreground">{formatSize(attachment.size)}</p>
              </div>
              <Download className="h-4 w-4 text-muted-foreground shrink-0" />
            </button>
          );
        })}
      </div>

      {previewAttachment && (
        <PreviewDialog
          attachment={previewAttachment}
          open={!!previewAttachment}
          onClose={() => setPreviewAttachment(null)}
        />
      )}
    </>
  );
}
