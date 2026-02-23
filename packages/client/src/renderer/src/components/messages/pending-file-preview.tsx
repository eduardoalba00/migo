import { useState, useEffect } from "react";
import { X, FileText } from "lucide-react";

interface PendingFilePreviewProps {
  files: File[];
  onRemove: (index: number) => void;
}

export function PendingFilePreview({ files, onRemove }: PendingFilePreviewProps) {
  if (files.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 px-4 py-3 bg-muted/50 rounded-t-lg">
      {files.map((file, i) => (
        <FileCard key={`${file.name}-${i}`} file={file} onRemove={() => onRemove(i)} />
      ))}
    </div>
  );
}

function FileCard({ file, onRemove }: { file: File; onRemove: () => void }) {
  const [preview, setPreview] = useState<string | null>(null);
  const isImage = file.type.startsWith("image/");

  useEffect(() => {
    if (!isImage) return;
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file, isImage]);

  return (
    <div className="relative w-44 bg-background rounded-lg border border-border overflow-hidden">
      <button
        onClick={onRemove}
        className="absolute top-1.5 right-1.5 z-10 w-6 h-6 rounded bg-destructive/80 hover:bg-destructive flex items-center justify-center transition-colors"
      >
        <X className="h-3.5 w-3.5 text-destructive-foreground" />
      </button>

      {isImage && preview ? (
        <div className="h-28 bg-muted flex items-center justify-center">
          <img src={preview} alt={file.name} className="h-full w-full object-cover" />
        </div>
      ) : (
        <div className="h-28 bg-muted flex items-center justify-center">
          <FileText className="h-12 w-12 text-muted-foreground/50" />
        </div>
      )}

      <div className="px-2 py-1.5">
        <p className="text-xs truncate text-muted-foreground" title={file.name}>
          {file.name}
        </p>
      </div>
    </div>
  );
}
