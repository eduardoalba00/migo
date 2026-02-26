import { useEffect, useState } from "react";
import { Monitor, AppWindow } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useVoiceStore } from "@/stores/voice";

export function ScreenSharePicker() {
  const showPicker = useVoiceStore((s) => s.showScreenSharePicker);
  const startScreenShare = useVoiceStore((s) => s.startScreenShare);
  const [sources, setSources] = useState<ScreenSources | null>(null);
  const [loading, setLoading] = useState(true);

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

  const handleSelectDisplay = (index: number) => {
    startScreenShare({ type: "display", id: index });
  };

  const handleSelectWindow = (index: number) => {
    startScreenShare({ type: "window", id: index });
  };

  const hasNoSources = !sources || (sources.displays.length === 0 && sources.windows.length === 0);

  return (
    <Dialog open={showPicker} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Share Your Screen</DialogTitle>
          <DialogDescription>Choose a screen or window to share</DialogDescription>
        </DialogHeader>
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
