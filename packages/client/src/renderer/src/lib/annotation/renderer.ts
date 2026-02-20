/**
 * Canvas rendering engine for annotations.
 * Used by the in-app viewer overlay (the sharer's Electron overlay uses its own inline script).
 */

import type { ContentRect } from "./coordinate-mapping";
import { normalizedToPixel } from "./coordinate-mapping";
import type { AnnotationState, StoredStroke, StoredShape, CursorState, PingState } from "./state";

const PING_DURATION_MS = 2000;
const CURSOR_EXPIRE_MS = 3000;

export class AnnotationRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private state: AnnotationState;
  private getContentRect: () => ContentRect;
  private rafId: number | null = null;
  private dirty = true;
  private lastItemCount = 0;

  constructor(canvas: HTMLCanvasElement, state: AnnotationState, getContentRect: () => ContentRect) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
    this.state = state;
    this.getContentRect = getContentRect;
    state.setOnChange(() => this.markDirty());
  }

  start(): void {
    if (this.rafId !== null) return;
    const loop = () => {
      this.rafId = requestAnimationFrame(loop);

      // Safety net: detect state changes even if onChange didn't fire
      let count = this.state.shapes.size + this.state.cursors.size + this.state.pings.length + (this.state.draftShape ? 1 : 0);
      for (const stroke of this.state.strokes.values()) count += stroke.points.length;
      if (count !== this.lastItemCount) {
        this.dirty = true;
        this.lastItemCount = count;
      }

      if (this.dirty) {
        this.render();
        this.dirty = false;
      }
    };
    this.rafId = requestAnimationFrame(loop);
  }

  stop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.state.setOnChange(null);
  }

  markDirty(): void {
    this.dirty = true;
  }

  private render(): void {
    const ctx = this.ctx;
    const dpr = window.devicePixelRatio || 1;
    const w = this.canvas.width;
    const h = this.canvas.height;
    if (w === 0 || h === 0) return;

    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.scale(dpr, dpr);

    const rect = this.getContentRect();
    if (this.state.gc()) this.dirty = true;

    for (const stroke of this.state.strokes.values()) this.drawStroke(ctx, stroke, rect);
    for (const shape of this.state.shapes.values()) this.drawShape(ctx, shape, rect);
    if (this.state.draftShape) {
      ctx.save();
      ctx.globalAlpha = 0.5;
      this.drawShape(ctx, this.state.draftShape, rect);
      ctx.restore();
      this.dirty = true;
    }
    for (const ping of this.state.pings) { this.drawPing(ctx, ping, rect); this.dirty = true; }
    for (const cursor of this.state.cursors.values()) { this.drawCursor(ctx, cursor, rect); this.dirty = true; }

    ctx.restore();
  }

  private drawStroke(ctx: CanvasRenderingContext2D, stroke: StoredStroke, rect: ContentRect): void {
    if (stroke.points.length < 2) return;

    ctx.save();
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.lineWidth;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();

    const pts = stroke.points.map((p) => normalizedToPixel(p.x, p.y, rect));
    ctx.moveTo(pts[0].px, pts[0].py);

    if (pts.length === 2) {
      ctx.lineTo(pts[1].px, pts[1].py);
    } else {
      // Catmull-Rom spline interpolation
      for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[Math.max(i - 1, 0)];
        const p1 = pts[i];
        const p2 = pts[Math.min(i + 1, pts.length - 1)];
        const p3 = pts[Math.min(i + 2, pts.length - 1)];
        ctx.bezierCurveTo(
          p1.px + (p2.px - p0.px) / 6, p1.py + (p2.py - p0.py) / 6,
          p2.px - (p3.px - p1.px) / 6, p2.py - (p3.py - p1.py) / 6,
          p2.px, p2.py,
        );
      }
    }

    ctx.stroke();
    ctx.restore();
  }

  private drawShape(ctx: CanvasRenderingContext2D, shape: StoredShape, rect: ContentRect): void {
    ctx.save();
    ctx.strokeStyle = shape.color;
    ctx.fillStyle = shape.color;
    ctx.lineWidth = 2;

    const s = shape.shape;
    if (s.type === "rect") {
      const tl = normalizedToPixel(s.topLeft.x, s.topLeft.y, rect);
      const br = normalizedToPixel(s.bottomRight.x, s.bottomRight.y, rect);
      const w = br.px - tl.px, h = br.py - tl.py;
      if (s.filled) { ctx.globalAlpha = 0.15; ctx.fillRect(tl.px, tl.py, w, h); ctx.globalAlpha = 1; }
      ctx.strokeRect(tl.px, tl.py, w, h);
    } else if (s.type === "arrow") {
      const from = normalizedToPixel(s.from.x, s.from.y, rect);
      const to = normalizedToPixel(s.to.x, s.to.y, rect);
      ctx.beginPath(); ctx.moveTo(from.px, from.py); ctx.lineTo(to.px, to.py); ctx.stroke();
      const angle = Math.atan2(to.py - from.py, to.px - from.px);
      ctx.beginPath(); ctx.moveTo(to.px, to.py);
      ctx.lineTo(to.px - 12 * Math.cos(angle - Math.PI / 6), to.py - 12 * Math.sin(angle - Math.PI / 6));
      ctx.lineTo(to.px - 12 * Math.cos(angle + Math.PI / 6), to.py - 12 * Math.sin(angle + Math.PI / 6));
      ctx.closePath(); ctx.fill();
    } else if (s.type === "text") {
      const pos = normalizedToPixel(s.point.x, s.point.y, rect);
      ctx.font = `${s.fontSize}px sans-serif`;
      ctx.fillText(s.text, pos.px, pos.py);
    }

    ctx.restore();
  }

  private drawPing(ctx: CanvasRenderingContext2D, ping: PingState, rect: ContentRect): void {
    const progress = Math.min((Date.now() - ping.startTime) / PING_DURATION_MS, 1);
    const pos = normalizedToPixel(ping.point.x, ping.point.y, rect);
    ctx.save();
    for (let i = 0; i < 3; i++) {
      const rp = Math.max(0, progress - i * 0.15);
      if (rp <= 0) continue;
      ctx.beginPath(); ctx.arc(pos.px, pos.py, rp * 40, 0, Math.PI * 2);
      ctx.strokeStyle = ping.color; ctx.globalAlpha = Math.max(0, 1 - rp) * 0.7; ctx.lineWidth = 2; ctx.stroke();
    }
    ctx.beginPath(); ctx.arc(pos.px, pos.py, 4, 0, Math.PI * 2);
    ctx.fillStyle = ping.color; ctx.globalAlpha = Math.max(0, 1 - progress); ctx.fill();
    ctx.restore();
  }

  private drawCursor(ctx: CanvasRenderingContext2D, cursor: CursorState, rect: ContentRect): void {
    const opacity = Math.max(0, 1 - (Date.now() - cursor.lastSeen) / CURSOR_EXPIRE_MS);
    if (opacity <= 0) return;
    const pos = normalizedToPixel(cursor.point.x, cursor.point.y, rect);

    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.beginPath(); ctx.arc(pos.px, pos.py, 6, 0, Math.PI * 2);
    ctx.fillStyle = cursor.color; ctx.fill();
    ctx.lineWidth = 1.5; ctx.strokeStyle = "white"; ctx.stroke();

    ctx.font = "11px sans-serif";
    const tw = ctx.measureText(cursor.senderName).width;
    const lx = pos.px + 10, ly = pos.py - 10;
    ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
    ctx.beginPath(); ctx.roundRect(lx - 4, ly - 12, tw + 8, 16, 3); ctx.fill();
    ctx.fillStyle = "white"; ctx.fillText(cursor.senderName, lx, ly);
    ctx.restore();
  }
}
