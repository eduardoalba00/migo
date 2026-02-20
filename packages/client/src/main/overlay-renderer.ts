// Primary brand color — matches --primary in dark theme (oklch 0.6132 0.2294 291.74)
const PRIMARY_COLOR = "#8B5CF6";
const BORDER_WIDTH = 1;

export const OVERLAY_HTML = `<!doctype html>
<html>
<head><style>
*{margin:0;padding:0}
html,body{width:100%;height:100%;overflow:hidden;background:transparent}
canvas{display:block;width:100%;height:100%}
</style></head>
<body><canvas id="canvas"></canvas></body>
</html>`;

/**
 * Self-contained overlay renderer script (no imports, no build step).
 * Receives annotation events via the overlayAPI preload bridge and
 * renders strokes, shapes, pings, and cursors on a transparent canvas.
 */
export const OVERLAY_SCRIPT = `
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const dpr = window.devicePixelRatio || 1;

const strokes = new Map();
const shapes = new Map();
const cursors = new Map();
let pings = [];
let dirty = true;

function updateSize() {
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  canvas.style.width = window.innerWidth + "px";
  canvas.style.height = window.innerHeight + "px";
  dirty = true;
}
window.addEventListener("resize", updateSize);
updateSize();

function apply(ev) {
  switch (ev.type) {
    case "strokeStart":
      strokes.set(ev.strokeId, { color: ev.color, lineWidth: ev.lineWidth, points: [ev.point], complete: false });
      break;
    case "strokePoints": {
      const s = strokes.get(ev.strokeId);
      if (s) s.points.push(...ev.points);
      break;
    }
    case "strokeEnd": {
      const s = strokes.get(ev.strokeId);
      if (s) s.complete = true;
      break;
    }
    case "rectCreate":
      shapes.set(ev.shapeId, { color: ev.color, type: "rect", topLeft: ev.topLeft, bottomRight: ev.bottomRight, filled: ev.filled });
      break;
    case "arrowCreate":
      shapes.set(ev.shapeId, { color: ev.color, type: "arrow", from: ev.from, to: ev.to });
      break;
    case "textCreate":
      shapes.set(ev.shapeId, { color: ev.color, type: "text", point: ev.point, text: ev.text, fontSize: ev.fontSize });
      break;
    case "eraser":
      strokes.delete(ev.targetId); shapes.delete(ev.targetId);
      break;
    case "clearAll":
      strokes.clear(); shapes.clear(); pings = []; cursors.clear();
      break;
    case "cursor":
      cursors.set(ev.senderId, { name: ev.senderName, color: ev.color, point: ev.point, t: Date.now() });
      break;
    case "ping":
      pings.push({ color: ev.color, point: ev.point, t: Date.now() });
      break;
  }
  dirty = true;
}

window.overlayAPI.onAnnotationEvents(function(events) {
  for (const ev of events) apply(ev);
});
window.overlayAPI.onClear(function() {
  strokes.clear(); shapes.clear(); cursors.clear(); pings = []; dirty = true;
});

function toPixel(p) { return { x: p.x * window.innerWidth, y: p.y * window.innerHeight }; }

function drawStroke(s) {
  if (s.points.length < 2) return;
  ctx.save();
  ctx.strokeStyle = s.color; ctx.lineWidth = s.lineWidth; ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.beginPath();
  const p0 = toPixel(s.points[0]);
  ctx.moveTo(p0.x, p0.y);
  for (let i = 1; i < s.points.length; i++) { const p = toPixel(s.points[i]); ctx.lineTo(p.x, p.y); }
  ctx.stroke(); ctx.restore();
}

function drawShape(s) {
  ctx.save(); ctx.strokeStyle = s.color; ctx.fillStyle = s.color; ctx.lineWidth = 2;
  if (s.type === "rect") {
    const tl = toPixel(s.topLeft), br = toPixel(s.bottomRight);
    if (s.filled) { ctx.globalAlpha = 0.15; ctx.fillRect(tl.x, tl.y, br.x-tl.x, br.y-tl.y); ctx.globalAlpha = 1; }
    ctx.strokeRect(tl.x, tl.y, br.x-tl.x, br.y-tl.y);
  } else if (s.type === "arrow") {
    const f = toPixel(s.from), t = toPixel(s.to);
    ctx.beginPath(); ctx.moveTo(f.x, f.y); ctx.lineTo(t.x, t.y); ctx.stroke();
    const a = Math.atan2(t.y-f.y, t.x-f.x);
    ctx.beginPath(); ctx.moveTo(t.x, t.y);
    ctx.lineTo(t.x-12*Math.cos(a-Math.PI/6), t.y-12*Math.sin(a-Math.PI/6));
    ctx.lineTo(t.x-12*Math.cos(a+Math.PI/6), t.y-12*Math.sin(a+Math.PI/6));
    ctx.closePath(); ctx.fill();
  } else if (s.type === "text") {
    const p = toPixel(s.point); ctx.font = s.fontSize+"px sans-serif"; ctx.fillText(s.text, p.x, p.y);
  }
  ctx.restore();
}

function drawPing(ping) {
  const age = Date.now() - ping.t, progress = Math.min(age/2000, 1), p = toPixel(ping.point);
  ctx.save();
  for (let i = 0; i < 3; i++) {
    const rp = Math.max(0, progress - i*0.15);
    if (rp <= 0) continue;
    ctx.beginPath(); ctx.arc(p.x, p.y, rp*40, 0, Math.PI*2);
    ctx.strokeStyle = ping.color; ctx.globalAlpha = Math.max(0,1-rp)*0.7; ctx.lineWidth = 2; ctx.stroke();
  }
  ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI*2);
  ctx.fillStyle = ping.color; ctx.globalAlpha = Math.max(0,1-progress); ctx.fill(); ctx.restore();
}

function drawCursor(c) {
  const age = Date.now()-c.t, opacity = Math.max(0, 1-age/3000);
  if (opacity <= 0) return;
  const p = toPixel(c.point);
  ctx.save(); ctx.globalAlpha = opacity;
  ctx.beginPath(); ctx.arc(p.x, p.y, 6, 0, Math.PI*2); ctx.fillStyle = c.color; ctx.fill();
  ctx.lineWidth = 1.5; ctx.strokeStyle = "white"; ctx.stroke();
  ctx.font = "11px sans-serif";
  const tw = ctx.measureText(c.name).width;
  ctx.fillStyle = "rgba(0,0,0,0.7)";
  ctx.beginPath(); ctx.roundRect(p.x+6, p.y-16, tw+8, 16, 3); ctx.fill();
  ctx.fillStyle = "white"; ctx.fillText(c.name, p.x+10, p.y-4); ctx.restore();
}

function render() {
  requestAnimationFrame(render);
  const now = Date.now();
  for (const [id, c] of cursors) { if (now-c.t > 3000) { cursors.delete(id); dirty = true; } }
  const pl = pings.length;
  pings = pings.filter(p => now-p.t < 2000);
  if (pings.length !== pl) dirty = true;
  if (pings.length > 0 || cursors.size > 0) dirty = true;
  if (!dirty) return;
  dirty = false;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save(); ctx.scale(dpr, dpr);

  // Border — drawn on canvas so it's visible through the transparent window
  ctx.strokeStyle = "${PRIMARY_COLOR}";
  ctx.lineWidth = ${BORDER_WIDTH};
  const bw = ${BORDER_WIDTH}/2;
  ctx.strokeRect(bw, bw, window.innerWidth-${BORDER_WIDTH}, window.innerHeight-${BORDER_WIDTH});

  for (const s of strokes.values()) drawStroke(s);
  for (const s of shapes.values()) drawShape(s);
  for (const p of pings) drawPing(p);
  for (const c of cursors.values()) drawCursor(c);
  ctx.restore();
}
requestAnimationFrame(render);
`;
