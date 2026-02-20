/**
 * LiveKit data channel wrapper for annotation events.
 * Handles publish/subscribe, batching, and reliability routing.
 */

import { DataPacket_Kind, RoomEvent, type Room } from "livekit-client";
import type { AnnotationEvent } from "@migo/shared";

const TOPIC = "annotation";
const BATCH_INTERVAL_MS = 50;

/** Events that can tolerate packet loss — high frequency, latest-wins */
const UNRELIABLE_TYPES = new Set<AnnotationEvent["type"]>(["cursor", "strokePoints"]);

export type AnnotationEventHandler = (event: AnnotationEvent) => void;

export class AnnotationDataChannel {
  private room: Room;
  private handler: AnnotationEventHandler;
  private batchBuffer: AnnotationEvent[] = [];
  private batchTimer: ReturnType<typeof setInterval> | null = null;
  private boundOnData: (...args: any[]) => void;

  constructor(room: Room, handler: AnnotationEventHandler) {
    this.room = room;
    this.handler = handler;

    // Listen for incoming data
    this.boundOnData = (
      payload: Uint8Array,
      participant: any,
      _kind: any,
      topic: string | undefined,
    ) => {
      if (topic !== TOPIC) return;
      // Don't process our own messages (local echo is handled by the store)
      if (participant?.identity === room.localParticipant.identity) return;

      try {
        const text = new TextDecoder().decode(payload);
        const events: AnnotationEvent[] = JSON.parse(text);
        for (const event of events) {
          this.handler(event);
        }
      } catch {
        // Malformed data — ignore
      }
    };

    this.room.on(RoomEvent.DataReceived, this.boundOnData);

    // Start batch flush timer
    this.batchTimer = setInterval(() => this.flushBatch(), BATCH_INTERVAL_MS);
  }

  send(event: AnnotationEvent): void {
    if (UNRELIABLE_TYPES.has(event.type)) {
      // Buffer unreliable events for batching
      this.batchBuffer.push(event);
    } else {
      // Reliable events sent immediately
      this.publishEvents([event], DataPacket_Kind.RELIABLE);
    }
  }

  private flushBatch(): void {
    if (this.batchBuffer.length === 0) return;
    const events = this.batchBuffer;
    this.batchBuffer = [];
    this.publishEvents(events, DataPacket_Kind.LOSSY);
  }

  private publishEvents(events: AnnotationEvent[], kind: DataPacket_Kind): void {
    const data = new TextEncoder().encode(JSON.stringify(events));
    this.room.localParticipant
      .publishData(data, { reliable: kind === DataPacket_Kind.RELIABLE, topic: TOPIC })
      .catch(() => {});
  }

  dispose(): void {
    // Flush remaining batch
    this.flushBatch();

    if (this.batchTimer !== null) {
      clearInterval(this.batchTimer);
      this.batchTimer = null;
    }

    this.room.off(RoomEvent.DataReceived, this.boundOnData);
  }
}
