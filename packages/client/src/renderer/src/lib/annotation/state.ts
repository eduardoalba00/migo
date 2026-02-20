/**
 * Annotation scene state — plain TypeScript, no React dependency.
 * Shared between viewer canvas overlay and sharer's Electron overlay window.
 */

import type { AnnotationEvent, AnnotationPoint } from "@migo/shared";

// ─── Stored Types ────────────────────────────────────────────────────────────

export interface StoredStroke {
  id: string;
  senderId: string;
  color: string;
  lineWidth: number;
  points: AnnotationPoint[];
  complete: boolean;
}

export interface StoredShape {
  id: string;
  senderId: string;
  color: string;
  shape:
    | { type: "rect"; topLeft: AnnotationPoint; bottomRight: AnnotationPoint; filled: boolean }
    | { type: "arrow"; from: AnnotationPoint; to: AnnotationPoint }
    | { type: "text"; point: AnnotationPoint; text: string; fontSize: number };
}

export interface CursorState {
  senderId: string;
  senderName: string;
  color: string;
  point: AnnotationPoint;
  lastSeen: number;
}

export interface PingState {
  senderId: string;
  color: string;
  point: AnnotationPoint;
  startTime: number;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const CURSOR_EXPIRE_MS = 3000;
const PING_DURATION_MS = 2000;

// ─── State Machine ───────────────────────────────────────────────────────────

export class AnnotationState {
  strokes = new Map<string, StoredStroke>();
  shapes = new Map<string, StoredShape>();
  cursors = new Map<string, CursorState>();
  pings: PingState[] = [];
  draftShape: StoredShape | null = null;

  private onChange: (() => void) | null = null;

  setOnChange(cb: (() => void) | null): void {
    this.onChange = cb;
  }

  private notify(): void {
    this.onChange?.();
  }

  setDraftShape(shape: StoredShape | null): void {
    this.draftShape = shape;
    this.notify();
  }

  apply(event: AnnotationEvent): void {
    switch (event.type) {
      case "cursor":
        this.cursors.set(event.senderId, {
          senderId: event.senderId,
          senderName: event.senderName,
          color: event.color,
          point: event.point,
          lastSeen: Date.now(),
        });
        break;

      case "ping":
        this.pings.push({
          senderId: event.senderId,
          color: event.color,
          point: event.point,
          startTime: Date.now(),
        });
        break;

      case "strokeStart":
        this.strokes.set(event.strokeId, {
          id: event.strokeId,
          senderId: event.senderId,
          color: event.color,
          lineWidth: event.lineWidth,
          points: [event.point],
          complete: false,
        });
        break;

      case "strokePoints": {
        const stroke = this.strokes.get(event.strokeId);
        if (stroke) {
          stroke.points.push(...event.points);
        }
        break;
      }

      case "strokeEnd": {
        const stroke = this.strokes.get(event.strokeId);
        if (stroke) {
          stroke.complete = true;
        }
        break;
      }

      case "rectCreate":
        this.shapes.set(event.shapeId, {
          id: event.shapeId,
          senderId: event.senderId,
          color: event.color,
          shape: {
            type: "rect",
            topLeft: event.topLeft,
            bottomRight: event.bottomRight,
            filled: event.filled,
          },
        });
        break;

      case "arrowCreate":
        this.shapes.set(event.shapeId, {
          id: event.shapeId,
          senderId: event.senderId,
          color: event.color,
          shape: {
            type: "arrow",
            from: event.from,
            to: event.to,
          },
        });
        break;

      case "textCreate":
        this.shapes.set(event.shapeId, {
          id: event.shapeId,
          senderId: event.senderId,
          color: event.color,
          shape: {
            type: "text",
            point: event.point,
            text: event.text,
            fontSize: event.fontSize,
          },
        });
        break;

      case "eraser":
        this.strokes.delete(event.targetId);
        this.shapes.delete(event.targetId);
        break;

      case "clearAll":
        this.strokes.clear();
        this.shapes.clear();
        this.pings = [];
        break;

      case "sessionStart":
      case "sessionEnd":
      case "sessionQuery":
      case "marker":
        // Handled by the annotation store, not the scene state
        break;
    }

    this.notify();
  }

  /**
   * Garbage-collect expired cursors and finished pings.
   * Returns true if anything was removed (caller should re-render).
   */
  gc(): boolean {
    const now = Date.now();
    let changed = false;

    for (const [id, cursor] of this.cursors) {
      if (now - cursor.lastSeen > CURSOR_EXPIRE_MS) {
        this.cursors.delete(id);
        changed = true;
      }
    }

    const before = this.pings.length;
    this.pings = this.pings.filter((p) => now - p.startTime < PING_DURATION_MS);
    if (this.pings.length !== before) changed = true;

    return changed;
  }

  reset(): void {
    this.strokes.clear();
    this.shapes.clear();
    this.cursors.clear();
    this.pings = [];
    this.draftShape = null;
    this.notify();
  }
}
