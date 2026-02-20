import { useEffect, useRef, useCallback, useState } from "react";
import { nanoid } from "nanoid";
import { useAnnotationStore } from "@/stores/annotation";
import { AnnotationRenderer } from "@/lib/annotation/renderer";
import {
  computeContentRect,
  pixelToNormalized,
  type ContentRect,
} from "@/lib/annotation/coordinate-mapping";

interface ViewerCanvasOverlayProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
}

export function ViewerCanvasOverlay({ videoRef }: ViewerCanvasOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<AnnotationRenderer | null>(null);
  const contentRectRef = useRef<ContentRect>({ x: 0, y: 0, width: 0, height: 0 });
  const activeStrokeId = useRef<string | null>(null);
  const shapeStart = useRef<{ nx: number; ny: number } | null>(null);

  const [textInput, setTextInput] = useState<{ nx: number; ny: number; px: number; py: number } | null>(null);
  const [textValue, setTextValue] = useState("");

  const isSessionMode = useAnnotationStore((s) => s.isSessionMode);
  const isAnnotating = useAnnotationStore((s) => s.isAnnotating);
  const activeTool = useAnnotationStore((s) => s.activeTool);
  const lineWidth = useAnnotationStore((s) => s.lineWidth);
  const activeColor = useAnnotationStore((s) => s.activeColor);
  const annotationState = useAnnotationStore((s) => s.annotationState);
  const sendEvent = useAnnotationStore((s) => s.sendEvent);

  const updateContentRect = useCallback(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;

    const container = canvas.parentElement;
    if (!container) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = container.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;

    contentRectRef.current = computeContentRect(
      rect.width,
      rect.height,
      video.videoWidth || rect.width,
      video.videoHeight || rect.height,
    );

    rendererRef.current?.markDirty();
  }, [videoRef]);

  // Create renderer when session mode activates (canvas appears in DOM)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const renderer = new AnnotationRenderer(
      canvas,
      annotationState,
      () => contentRectRef.current,
    );
    rendererRef.current = renderer;
    renderer.start();
    updateContentRect();

    const observer = new ResizeObserver(() => updateContentRect());
    const parent = canvas.parentElement;
    if (parent) observer.observe(parent);

    const video = videoRef.current;
    const onResize = () => updateContentRect();
    video?.addEventListener("resize", onResize);

    return () => {
      renderer.stop();
      rendererRef.current = null;
      observer.disconnect();
      video?.removeEventListener("resize", onResize);
    };
  }, [isSessionMode, annotationState, updateContentRect, videoRef]);

  const getNormalized = useCallback(
    (e: React.PointerEvent): { nx: number; ny: number } | null => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      return pixelToNormalized(e.clientX - rect.left, e.clientY - rect.top, contentRectRef.current);
    },
    [],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!isAnnotating) return;
      const norm = getNormalized(e);
      if (!norm) return;

      if (activeTool === "freehand") {
        const strokeId = nanoid();
        activeStrokeId.current = strokeId;
        sendEvent({ type: "strokeStart", strokeId, point: { x: norm.nx, y: norm.ny }, lineWidth });
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
      } else if (activeTool === "ping") {
        sendEvent({ type: "ping", point: { x: norm.nx, y: norm.ny } });
      } else if (activeTool === "rectangle" || activeTool === "arrow") {
        shapeStart.current = norm;
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
      } else if (activeTool === "text") {
        // Show inline text input at click position
        const canvas = canvasRef.current;
        if (canvas) {
          const rect = canvas.getBoundingClientRect();
          const px = e.clientX - rect.left;
          const py = e.clientY - rect.top;
          setTextInput({ nx: norm.nx, ny: norm.ny, px, py });
          setTextValue("");
        }
      } else if (activeTool === "eraser") {
        const hitId = findHitTarget(norm.nx, norm.ny, annotationState);
        if (hitId) sendEvent({ type: "eraser", targetId: hitId });
      }
    },
    [isAnnotating, activeTool, lineWidth, sendEvent, getNormalized, annotationState],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const norm = getNormalized(e);
      if (!norm) return;

      if (isSessionMode) {
        sendEvent({ type: "cursor", point: { x: norm.nx, y: norm.ny } });
      }

      if (isAnnotating && activeTool === "freehand" && activeStrokeId.current) {
        sendEvent({ type: "strokePoints", strokeId: activeStrokeId.current, points: [{ x: norm.nx, y: norm.ny }] });
      }

      // Live preview for rectangle/arrow
      if (isAnnotating && shapeStart.current && (activeTool === "rectangle" || activeTool === "arrow")) {
        const start = shapeStart.current;
        if (activeTool === "rectangle") {
          annotationState.setDraftShape({
            id: "__draft__",
            senderId: "",
            color: activeColor,
            shape: {
              type: "rect",
              topLeft: { x: Math.min(start.nx, norm.nx), y: Math.min(start.ny, norm.ny) },
              bottomRight: { x: Math.max(start.nx, norm.nx), y: Math.max(start.ny, norm.ny) },
              filled: false,
            },
          });
        } else {
          annotationState.setDraftShape({
            id: "__draft__",
            senderId: "",
            color: activeColor,
            shape: {
              type: "arrow",
              from: { x: start.nx, y: start.ny },
              to: { x: norm.nx, y: norm.ny },
            },
          });
        }
      }
    },
    [isSessionMode, isAnnotating, activeTool, activeColor, sendEvent, getNormalized, annotationState],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!isAnnotating) return;

      if (activeTool === "freehand" && activeStrokeId.current) {
        sendEvent({ type: "strokeEnd", strokeId: activeStrokeId.current });
        activeStrokeId.current = null;
      } else if ((activeTool === "rectangle" || activeTool === "arrow") && shapeStart.current) {
        annotationState.setDraftShape(null);
        const norm = getNormalized(e);
        if (norm) {
          const start = shapeStart.current;
          if (activeTool === "rectangle") {
            sendEvent({
              type: "rectCreate", shapeId: nanoid(), filled: false,
              topLeft: { x: Math.min(start.nx, norm.nx), y: Math.min(start.ny, norm.ny) },
              bottomRight: { x: Math.max(start.nx, norm.nx), y: Math.max(start.ny, norm.ny) },
            });
          } else {
            sendEvent({
              type: "arrowCreate", shapeId: nanoid(),
              from: { x: start.nx, y: start.ny }, to: { x: norm.nx, y: norm.ny },
            });
          }
        }
        shapeStart.current = null;
      }
    },
    [isAnnotating, activeTool, sendEvent, getNormalized, annotationState],
  );

  const handleTextSubmit = useCallback(() => {
    if (textInput && textValue.trim()) {
      sendEvent({
        type: "textCreate",
        shapeId: nanoid(),
        point: { x: textInput.nx, y: textInput.ny },
        text: textValue.trim(),
        fontSize: 16,
      });
    }
    setTextInput(null);
    setTextValue("");
  }, [textInput, textValue, sendEvent]);

  const handleTextCancel = useCallback(() => {
    setTextInput(null);
    setTextValue("");
  }, []);

  if (!isSessionMode) return null;

  return (
    <>
      <canvas
        ref={canvasRef}
        className="absolute inset-0"
        style={{
          pointerEvents: isAnnotating ? "auto" : "none",
          cursor: isAnnotating ? getCursorForTool(activeTool) : "default",
          zIndex: 10,
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      />
      {textInput && (
        <input
          type="text"
          autoFocus
          value={textValue}
          onChange={(e) => setTextValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleTextSubmit();
            if (e.key === "Escape") handleTextCancel();
          }}
          onBlur={handleTextCancel}
          className="absolute bg-black/80 text-white text-sm px-2 py-1 rounded border border-white/30 min-w-[120px] outline-none"
          style={{
            left: textInput.px,
            top: textInput.py,
            zIndex: 20,
          }}
          placeholder="Type text..."
        />
      )}
    </>
  );
}

function getCursorForTool(tool: string): string {
  switch (tool) {
    case "freehand": return "crosshair";
    case "eraser": return "not-allowed";
    case "text": return "text";
    case "ping": return "cell";
    default: return "crosshair";
  }
}

function findHitTarget(
  nx: number, ny: number,
  state: import("@/lib/annotation/state").AnnotationState,
): string | null {
  const threshold = 0.02;

  for (const [id, stroke] of state.strokes) {
    for (const p of stroke.points) {
      if (Math.hypot(p.x - nx, p.y - ny) < threshold) return id;
    }
  }

  for (const [id, shape] of state.shapes) {
    const s = shape.shape;
    if (s.type === "rect") {
      if (nx >= s.topLeft.x - threshold && nx <= s.bottomRight.x + threshold &&
          ny >= s.topLeft.y - threshold && ny <= s.bottomRight.y + threshold) return id;
    } else if (s.type === "arrow") {
      if (pointToSegmentDist(nx, ny, s.from.x, s.from.y, s.to.x, s.to.y) < threshold) return id;
    } else if (s.type === "text") {
      if (Math.abs(nx - s.point.x) < threshold * 3 && Math.abs(ny - s.point.y) < threshold * 2) return id;
    }
  }

  return null;
}

function pointToSegmentDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
