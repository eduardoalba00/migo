import { useEffect, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { useWsStore } from "@/stores/ws";

export function VersionMismatchBanner() {
  const versionMismatch = useWsStore((s) => s.versionMismatch);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    const api = window.updaterAPI;
    if (!versionMismatch || !api) return;

    setUpdating(true);
    api.check().catch(() => setUpdating(false));

    const cleanup = api.onStatus((data) => {
      if (data.status === "downloaded") {
        api.install();
      }
      if (data.status === "not-available" || data.status === "error") {
        setUpdating(false);
      }
    });

    return cleanup;
  }, [versionMismatch]);

  if (!versionMismatch) return null;

  return (
    <div className="flex items-center gap-2 bg-[oklch(0.55_0.15_30)] px-4 py-1.5 text-white text-sm">
      {updating ? (
        <>
          <Loader2 className="size-4 shrink-0 animate-spin" />
          <span>A new version is required. Downloading update...</span>
        </>
      ) : (
        <>
          <AlertTriangle className="size-4 shrink-0" />
          <span>
            Your client is outdated. Please update Migo to continue.
          </span>
          {!window.updaterAPI && (
            <button
              onClick={() => window.location.reload()}
              className="shrink-0 rounded-md bg-white/20 px-3 py-1 text-xs font-medium hover:bg-white/30 transition-colors"
            >
              Reload
            </button>
          )}
        </>
      )}
    </div>
  );
}
