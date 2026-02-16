import { useEffect, useState } from "react";
import { Monitor } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useVoiceStore } from "@/stores/voice";

export type CapturePreset = "720p30" | "1080p30" | "1080p60" | "1440p60";

const qualityOptions: { value: CapturePreset; label: string }[] = [
  { value: "720p30", label: "720p 30fps" },
  { value: "1080p30", label: "1080p 30fps" },
  { value: "1080p60", label: "1080p 60fps" },
  { value: "1440p60", label: "1440p 60fps" },
];

export function ScreenSharePicker() {
  const showPicker = useVoiceStore((s) => s.showScreenSharePicker);
  const startScreenShare = useVoiceStore((s) => s.startScreenShare);
  const [sources, setSources] = useState<ScreenSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [preset, setPreset] = useState<CapturePreset>("1440p60");

  useEffect(() => {
    if (!showPicker) return;
    setLoading(true);
    window.screenAPI
      .getSources()
      .then((s) => setSources(s))
      .catch(() => setSources([]))
      .finally(() => setLoading(false));
  }, [showPicker]);

  const handleClose = () => {
    useVoiceStore.setState({ showScreenSharePicker: false });
  };

  const handleSelect = (sourceId: string) => {
    startScreenShare(sourceId, preset);
  };

  return (
    <Dialog open={showPicker} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Share Your Screen</DialogTitle>
          <DialogDescription>Choose a screen or window to share</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-muted-foreground">Quality</label>
          <select
            value={preset}
            onChange={(e) => setPreset(e.target.value as CapturePreset)}
            className="h-8 rounded-md border border-border bg-background px-2 text-sm"
          >
            {qualityOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            Loading sources...
          </div>
        ) : sources.length === 0 ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            No screens or windows found
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 max-h-[400px] overflow-y-auto">
            {sources.map((source) => (
              <button
                key={source.id}
                onClick={() => handleSelect(source.id)}
                className="group flex flex-col rounded-lg border border-border bg-card p-2 hover:border-primary hover:bg-accent transition-colors text-left"
              >
                <div className="relative aspect-video w-full rounded bg-muted overflow-hidden">
                  {source.thumbnail ? (
                    <img
                      src={source.thumbnail}
                      alt={source.name}
                      className="w-full h-full object-contain"
                    />
                  ) : (
                    <div className="flex items-center justify-center h-full">
                      <Monitor className="h-8 w-8 text-muted-foreground" />
                    </div>
                  )}
                </div>
                <span className="mt-2 text-xs font-medium truncate w-full">
                  {source.name}
                </span>
              </button>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
