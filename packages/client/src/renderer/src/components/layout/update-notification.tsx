import { useState, useEffect } from "react";
import { Download, Loader2, X } from "lucide-react";

type Phase = "idle" | "downloading" | "ready";

export function UpdateNotification() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [version, setVersion] = useState<string>();
  const [percent, setPercent] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const api = window.updaterAPI;
    if (!api) return;

    const cleanupStatus = api.onStatus((data) => {
      if (data.status === "available") {
        setVersion(data.version);
        setPhase("downloading");
        setDismissed(false);
      }
      if (data.status === "downloaded") {
        setVersion(data.version);
        setPhase("ready");
        setDismissed(false);
      }
    });

    const cleanupProgress = api.onProgress((data) => {
      setPercent(Math.round(data.percent));
    });

    return () => {
      cleanupStatus();
      cleanupProgress();
    };
  }, []);

  if (phase === "idle" || dismissed) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[9999] flex items-center gap-3 rounded-lg bg-card border border-border shadow-lg px-4 py-3 max-w-sm animate-in slide-in-from-bottom-2 fade-in duration-300">
      <div className="flex items-center justify-center size-8 rounded-full bg-primary/10 text-primary shrink-0">
        {phase === "downloading" ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Download className="size-4" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        {phase === "downloading" ? (
          <>
            <p className="text-sm font-medium text-foreground">
              Downloading v{version}
            </p>
            <p className="text-xs text-muted-foreground">{percent}%</p>
          </>
        ) : (
          <>
            <p className="text-sm font-medium text-foreground">Update ready</p>
            <p className="text-xs text-muted-foreground">
              v{version} — restart to apply
            </p>
          </>
        )}
      </div>
      {phase === "ready" && (
        <button
          onClick={() => window.updaterAPI?.install()}
          className="shrink-0 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          Restart
        </button>
      )}
      <button
        onClick={() => setDismissed(true)}
        className="shrink-0 rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        title={
          phase === "ready"
            ? "Later — installs on next quit"
            : "Dismiss"
        }
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
