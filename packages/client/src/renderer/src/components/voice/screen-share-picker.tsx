import { useEffect, useState } from "react";
import { Monitor, AppWindow } from "lucide-react";
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
  const [sources, setSources] = useState<ScreenSources | null>(null);
  const [loading, setLoading] = useState(true);
  const [preset, setPreset] = useState<CapturePreset>("1440p60");

  useEffect(() => {
    if (!showPicker) return;
    setLoading(true);
    window.screenAPI
      .getSources()
      .then((s) => setSources(s))
      .catch(() => setSources(null))
      .finally(() => setLoading(false));
  }, [showPicker]);

  const handleClose = () => {
    useVoiceStore.setState({ showScreenSharePicker: false });
  };

  const handleSelectDisplay = (index: number) => {
    startScreenShare({ type: "display", id: index }, preset);
  };

  const handleSelectWindow = (handle: number) => {
    startScreenShare({ type: "window", id: handle }, preset);
  };

  const hasNoSources = !sources || (sources.displays.length === 0 && sources.windows.length === 0);

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
        ) : hasNoSources ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            No screens or windows found
          </div>
        ) : (
          <div className="max-h-[400px] overflow-y-auto space-y-4">
            {sources!.displays.length > 0 && (
              <div>
                <h3 className="text-sm font-medium text-muted-foreground mb-2">Displays</h3>
                <div className="grid grid-cols-2 gap-3">
                  {sources!.displays.map((display) => (
                    <button
                      key={display.index}
                      onClick={() => handleSelectDisplay(display.index)}
                      className="group flex flex-col rounded-lg border border-border bg-card p-3 hover:border-primary hover:bg-accent transition-colors text-left"
                    >
                      <div className="flex items-center gap-3">
                        <Monitor className="h-6 w-6 text-muted-foreground shrink-0" />
                        <div className="min-w-0">
                          <div className="text-sm font-medium truncate">{display.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {display.width}x{display.height}{display.index === 0 ? " (Primary)" : ""}
                          </div>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {sources!.windows.length > 0 && (
              <div>
                <h3 className="text-sm font-medium text-muted-foreground mb-2">Windows</h3>
                <div className="grid grid-cols-2 gap-3">
                  {sources!.windows.map((win) => (
                    <button
                      key={win.handle}
                      onClick={() => handleSelectWindow(win.handle)}
                      className="group flex flex-col rounded-lg border border-border bg-card p-3 hover:border-primary hover:bg-accent transition-colors text-left"
                    >
                      <div className="flex items-center gap-3">
                        <AppWindow className="h-6 w-6 text-muted-foreground shrink-0" />
                        <div className="min-w-0">
                          <div className="text-sm font-medium truncate">{win.title}</div>
                          <div className="text-xs text-muted-foreground truncate">{win.processName}</div>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
