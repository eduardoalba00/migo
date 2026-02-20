import { useState, useRef, useEffect } from "react";
import {
  MousePointer2,
  Pencil,
  Square,
  ArrowUpRight,
  Type,
  Eraser,
  Crosshair,
  Trash2,
} from "lucide-react";
import type { AnnotationTool } from "@migo/shared";
import { ANNOTATION_COLORS } from "@migo/shared";
import { useAnnotationStore } from "@/stores/annotation";

const TOOLS: { tool: AnnotationTool; icon: typeof Pencil; label: string }[] = [
  { tool: "cursor", icon: MousePointer2, label: "Cursor" },
  { tool: "ping", icon: Crosshair, label: "Ping" },
  { tool: "freehand", icon: Pencil, label: "Draw" },
  { tool: "rectangle", icon: Square, label: "Rectangle" },
  { tool: "arrow", icon: ArrowUpRight, label: "Arrow" },
  { tool: "text", icon: Type, label: "Text" },
  { tool: "eraser", icon: Eraser, label: "Eraser" },
];

export function AnnotationToolbar() {
  const isSessionMode = useAnnotationStore((s) => s.isSessionMode);
  const isAnnotating = useAnnotationStore((s) => s.isAnnotating);
  const activeTool = useAnnotationStore((s) => s.activeTool);
  const activeColor = useAnnotationStore((s) => s.activeColor);
  const toggleAnnotating = useAnnotationStore((s) => s.toggleAnnotating);
  const setActiveTool = useAnnotationStore((s) => s.setActiveTool);
  const setActiveColor = useAnnotationStore((s) => s.setActiveColor);
  const sendEvent = useAnnotationStore((s) => s.sendEvent);

  const [toolOpen, setToolOpen] = useState(false);
  const [colorOpen, setColorOpen] = useState(false);
  const toolRef = useRef<HTMLDivElement>(null);
  const colorRef = useRef<HTMLDivElement>(null);

  // Close dropdowns on outside click
  useEffect(() => {
    if (!toolOpen && !colorOpen) return;
    const handler = (e: MouseEvent) => {
      if (toolOpen && toolRef.current && !toolRef.current.contains(e.target as Node)) {
        setToolOpen(false);
      }
      if (colorOpen && colorRef.current && !colorRef.current.contains(e.target as Node)) {
        setColorOpen(false);
      }
    };
    document.addEventListener("pointerdown", handler);
    return () => document.removeEventListener("pointerdown", handler);
  }, [toolOpen, colorOpen]);

  if (!isSessionMode) return null;

  const ActiveToolIcon = TOOLS.find((t) => t.tool === activeTool)?.icon ?? Pencil;

  return (
    <div className="flex items-center gap-1.5 bg-black/70 rounded-lg px-2 py-1.5 backdrop-blur-sm">
      {/* Annotate toggle */}
      <button
        onClick={toggleAnnotating}
        className={`px-4 py-1.5 rounded-md text-sm font-semibold transition-colors ${
          isAnnotating
            ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
            : "bg-primary text-primary-foreground hover:bg-primary/90"
        }`}
        title={isAnnotating ? "Stop annotating" : "Start annotating"}
      >
        {isAnnotating ? "Stop" : "Annotate"}
      </button>

      {isAnnotating && (
        <>
          <div className="w-px h-6 bg-white/20" />

          {/* Tool picker dropdown */}
          <div ref={toolRef} className="relative">
            <button
              onClick={() => { setToolOpen(!toolOpen); setColorOpen(false); }}
              className="flex items-center gap-1 p-2 rounded transition-colors bg-white/10 text-white hover:bg-white/20"
              title="Select tool"
            >
              <ActiveToolIcon className="h-5 w-5" />
            </button>
            {toolOpen && (
              <div className="absolute bottom-full mb-1 left-0 bg-black/90 backdrop-blur-sm rounded-lg py-1 min-w-[140px] shadow-lg border border-white/10">
                {TOOLS.map(({ tool, icon: Icon, label }) => (
                  <button
                    key={tool}
                    onClick={() => { setActiveTool(tool); setToolOpen(false); }}
                    className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-sm transition-colors ${
                      activeTool === tool
                        ? "bg-white/20 text-white"
                        : "text-white/70 hover:text-white hover:bg-white/10"
                    }`}
                  >
                    <Icon className="h-4.5 w-4.5" />
                    <span>{label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Color picker dropdown */}
          <div ref={colorRef} className="relative">
            <button
              onClick={() => { setColorOpen(!colorOpen); setToolOpen(false); }}
              className="p-2 rounded transition-colors bg-white/10 hover:bg-white/20"
              title="Select color"
            >
              <div
                className="w-5 h-5 rounded-full border-2 border-white/50"
                style={{ backgroundColor: activeColor }}
              />
            </button>
            {colorOpen && (
              <div className="absolute bottom-full mb-1 left-0 bg-black/90 backdrop-blur-sm rounded-lg p-2 shadow-lg border border-white/10">
                <div className="flex flex-col gap-1.5">
                  {ANNOTATION_COLORS.map((color) => (
                    <button
                      key={color}
                      onClick={() => { setActiveColor(color); setColorOpen(false); }}
                      className={`w-7 h-7 rounded-full border-2 transition-transform ${
                        activeColor === color
                          ? "border-white scale-110"
                          : "border-transparent hover:scale-105 hover:border-white/30"
                      }`}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="w-px h-6 bg-white/20" />

          {/* Clear all */}
          <button
            onClick={() => sendEvent({ type: "clearAll" })}
            className="p-2 rounded text-white/70 hover:text-red-400 hover:bg-white/10 transition-colors"
            title="Clear all annotations"
          >
            <Trash2 className="h-5 w-5" />
          </button>
        </>
      )}
    </div>
  );
}
