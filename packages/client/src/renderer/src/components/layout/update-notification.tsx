import { useState, useEffect } from "react";
import { Download, X } from "lucide-react";

export function UpdateNotification() {
  const [ready, setReady] = useState(false);
  const [version, setVersion] = useState<string>();
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!window.updaterAPI) return;

    const cleanupStatus = window.updaterAPI.onStatus((data) => {
      if (data.status === "downloaded") {
        setVersion(data.version);
        setReady(true);
      }
    });

    // Silent check — no UI shown until download completes
    window.updaterAPI.check().catch(() => {});

    return cleanupStatus;
  }, []);

  if (!ready || dismissed) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[9999] flex items-center gap-3 rounded-lg bg-card border border-border shadow-lg px-4 py-3 max-w-sm animate-in slide-in-from-bottom-2 fade-in duration-300">
      <div className="flex items-center justify-center size-8 rounded-full bg-primary/10 text-primary shrink-0">
        <Download className="size-4" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground">Update ready</p>
        <p className="text-xs text-muted-foreground">
          v{version} — restart to apply
        </p>
      </div>
      <button
        onClick={() => window.updaterAPI.install()}
        className="shrink-0 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
      >
        Restart
      </button>
      <button
        onClick={() => setDismissed(true)}
        className="shrink-0 rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        title="Later — installs on next quit"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
