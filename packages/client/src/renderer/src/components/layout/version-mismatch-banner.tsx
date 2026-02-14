import { AlertTriangle } from "lucide-react";
import { useWsStore } from "@/stores/ws";

export function VersionMismatchBanner() {
  const versionMismatch = useWsStore((s) => s.versionMismatch);
  const serverVersion = useWsStore((s) => s.serverVersion);

  if (!versionMismatch) return null;

  return (
    <div className="flex items-center gap-2 bg-[oklch(0.55_0.15_30)] px-4 py-1.5 text-white text-sm">
      <AlertTriangle className="size-4 shrink-0" />
      <span>
        Server outdated (v{serverVersion}). Update with:{" "}
        <code className="rounded bg-white/20 px-1.5 py-0.5 text-xs">
          docker compose pull && docker compose up -d --build
        </code>
      </span>
    </div>
  );
}
