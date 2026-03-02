import { useEffect, useState } from "react";
import { Monitor, AppWindow } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useVoiceStore } from "@/stores/voice";
import { SCREEN_SHARE_PRESETS, DEFAULT_SCREEN_SHARE_RESOLUTION, type ScreenShareResolution } from "@/lib/livekit";

const RESOLUTION_OPTIONS = Object.keys(SCREEN_SHARE_PRESETS) as ScreenShareResolution[];
const STORAGE_KEY = "migo-screen-share-resolution";

function getSavedResolution(): ScreenShareResolution {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved && saved in SCREEN_SHARE_PRESETS) return saved as ScreenShareResolution;
  return DEFAULT_SCREEN_SHARE_RESOLUTION;
}

export function ScreenSharePicker() {
  const showPicker = useVoiceStore((s) => s.showScreenSharePicker);
  const startScreenShare = useVoiceStore((s) => s.startScreenShare);
  const [sources, setSources] = useState<ScreenSources | null>(null);
  const [loading, setLoading] = useState(true);
  const [resolution, setResolution] = useState<ScreenShareResolution>(getSavedResolution);

  useEffect(() => {
    const api = window.screenAPI;
    if (!showPicker || !api) return;
    setLoading(true);
    api
      .getSources()
      .then((s) => setSources(s))
      .catch(() => setSources(null))
      .finally(() => setLoading(false));
  }, [showPicker]);

  const handleClose = () => {
    useVoiceStore.setState({ showScreenSharePicker: false });
  };

  const handleResolutionChange = (value: ScreenShareResolution) => {
    setResolution(value);
    localStorage.setItem(STORAGE_KEY, value);
  };

  const handleSelectDisplay = (index: number) => {
    startScreenShare({ type: "display", id: index }, resolution);
  };

  const handleSelectWindow = (index: number) => {
    startScreenShare({ type: "window", id: index }, resolution);
  };

  const hasNoSources = !sources || (sources.displays.length === 0 && sources.windows.length === 0);

  return (
    <Dialog open={showPicker} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Share Your Screen</DialogTitle>
          <DialogDescription>Choose a screen or window to share</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2 text-sm">
          <label htmlFor="resolution-select" className="text-muted-foreground font-medium">Resolution</label>
          <select
            id="resolution-select"
            value={resolution}
            onChange={(e) => handleResolutionChange(e.target.value as ScreenShareResolution)}
            className="rounded-md border border-border bg-card px-2 py-1 text-sm text-foreground outline-none focus:border-primary"
          >
            {RESOLUTION_OPTIONS.map((key) => (
              <option key={key} value={key}>{key}</option>
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
                      key={display.id}
                      onClick={() => handleSelectDisplay(display.index)}
                      className="group flex flex-col rounded-lg border border-border bg-card p-3 hover:border-primary hover:bg-accent transition-colors text-left"
                    >
                      <div className="flex items-center gap-3">
                        <Monitor className="h-6 w-6 text-muted-foreground shrink-0" />
                        <div className="min-w-0">
                          <div className="text-sm font-medium truncate">
                            {display.name}{display.index === 0 ? " (Primary)" : ""}
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
                      key={win.id}
                      onClick={() => handleSelectWindow(win.index)}
                      className="group flex flex-col rounded-lg border border-border bg-card p-3 hover:border-primary hover:bg-accent transition-colors text-left"
                    >
                      <div className="flex items-center gap-3">
                        <AppWindow className="h-6 w-6 text-muted-foreground shrink-0" />
                        <div className="min-w-0">
                          <div className="text-sm font-medium truncate">{win.name}</div>
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
