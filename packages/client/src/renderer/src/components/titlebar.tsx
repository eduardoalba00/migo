import { useState, useEffect } from "react";
import { Minus, Square, Copy, X, Sun, Moon } from "lucide-react";
import { useTheme } from "next-themes";

export function Titlebar() {
  const [isMaximized, setIsMaximized] = useState(false);
  const { theme, setTheme } = useTheme();

  useEffect(() => {
    const api = window.windowAPI;
    if (!api) return;
    api.isMaximized().then(setIsMaximized);
    return api.onMaximizedChange(setIsMaximized);
  }, []);

  return (
    <div className="flex h-8 items-center justify-between bg-background text-foreground select-none">
      <div
        className="flex-1 h-full flex items-center px-3 text-xs font-medium text-muted-foreground"
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      >
        Migo
      </div>
      <div className="flex" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
        <button
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          className="inline-flex items-center justify-center w-11 h-8 hover:bg-sidebar-accent/20 transition-colors"
          title="Toggle theme"
        >
          {theme === "dark" ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
        </button>
        <button
          onClick={() => window.windowAPI?.minimize()}
          className="inline-flex items-center justify-center w-11 h-8 hover:bg-sidebar-accent/20 transition-colors"
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => window.windowAPI?.maximize()}
          className="inline-flex items-center justify-center w-11 h-8 hover:bg-sidebar-accent/20 transition-colors"
        >
          {isMaximized ? <Copy className="h-3 w-3" /> : <Square className="h-3 w-3" />}
        </button>
        <button
          onClick={() => window.windowAPI?.close()}
          className="inline-flex items-center justify-center w-11 h-8 hover:bg-destructive hover:text-white transition-colors"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
