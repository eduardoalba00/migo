// ─── Annotation Tool Types ───────────────────────────────────────────────────

export type AnnotationTool =
  | "cursor"
  | "ping"
  | "freehand"
  | "rectangle"
  | "arrow"
  | "text"
  | "eraser";

// ─── Coordinate Types ────────────────────────────────────────────────────────

/** Normalized point in 0..1 coordinate space */
export interface AnnotationPoint {
  x: number;
  y: number;
}

// ─── Event Base ──────────────────────────────────────────────────────────────

export interface AnnotationEventBase {
  sessionId: string;
  senderId: string;
  senderName: string;
  /** Milliseconds since session start */
  t: number;
  color: string;
}

// ─── Discriminated Union Events ──────────────────────────────────────────────

export interface CursorEvent extends AnnotationEventBase {
  type: "cursor";
  point: AnnotationPoint;
}

export interface PingEvent extends AnnotationEventBase {
  type: "ping";
  point: AnnotationPoint;
}

export interface StrokeStartEvent extends AnnotationEventBase {
  type: "strokeStart";
  strokeId: string;
  point: AnnotationPoint;
  lineWidth: number;
}

export interface StrokePointsEvent extends AnnotationEventBase {
  type: "strokePoints";
  strokeId: string;
  points: AnnotationPoint[];
}

export interface StrokeEndEvent extends AnnotationEventBase {
  type: "strokeEnd";
  strokeId: string;
}

export interface RectCreateEvent extends AnnotationEventBase {
  type: "rectCreate";
  shapeId: string;
  topLeft: AnnotationPoint;
  bottomRight: AnnotationPoint;
  filled: boolean;
}

export interface ArrowCreateEvent extends AnnotationEventBase {
  type: "arrowCreate";
  shapeId: string;
  from: AnnotationPoint;
  to: AnnotationPoint;
}

export interface TextCreateEvent extends AnnotationEventBase {
  type: "textCreate";
  shapeId: string;
  point: AnnotationPoint;
  text: string;
  fontSize: number;
}

export interface EraserEvent extends AnnotationEventBase {
  type: "eraser";
  targetId: string;
}

export interface ClearAllEvent extends AnnotationEventBase {
  type: "clearAll";
}

export interface MarkerEvent extends AnnotationEventBase {
  type: "marker";
  label: string;
}

// ─── Session signaling (sent over data channel) ─────────────────────────────

export interface SessionStartEvent extends AnnotationEventBase {
  type: "sessionStart";
}

export interface SessionEndEvent extends AnnotationEventBase {
  type: "sessionEnd";
}

export interface SessionQueryEvent extends AnnotationEventBase {
  type: "sessionQuery";
}

export type AnnotationEvent =
  | CursorEvent
  | PingEvent
  | StrokeStartEvent
  | StrokePointsEvent
  | StrokeEndEvent
  | RectCreateEvent
  | ArrowCreateEvent
  | TextCreateEvent
  | EraserEvent
  | ClearAllEvent
  | MarkerEvent
  | SessionStartEvent
  | SessionEndEvent
  | SessionQueryEvent;

// ─── Color Palette ───────────────────────────────────────────────────────────

export const ANNOTATION_COLORS = [
  "#ef4444", // red
  "#3b82f6", // blue
  "#22c55e", // green
  "#f59e0b", // amber
  "#a855f7", // purple
  "#ec4899", // pink
  "#06b6d4", // cyan
  "#f97316", // orange
] as const;
