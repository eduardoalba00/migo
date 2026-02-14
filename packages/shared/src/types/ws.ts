import type { Channel } from "./server.js";
import type { Message } from "./message.js";
import type { ServerMember } from "./server.js";
import type { VoiceState, VoiceSignalAction } from "./voice.js";

export const WsOpcode = {
  DISPATCH: 0,
  IDENTIFY: 1,
  HEARTBEAT: 2,
  HEARTBEAT_ACK: 3,
  READY: 4,
  VOICE_STATE_UPDATE: 5,
  VOICE_SIGNAL: 6,
  TYPING_START: 7,
} as const;

export type WsOpcode = (typeof WsOpcode)[keyof typeof WsOpcode];

export const DispatchEvent = {
  MESSAGE_CREATE: "MESSAGE_CREATE",
  MESSAGE_UPDATE: "MESSAGE_UPDATE",
  MESSAGE_DELETE: "MESSAGE_DELETE",
  CHANNEL_CREATE: "CHANNEL_CREATE",
  CHANNEL_UPDATE: "CHANNEL_UPDATE",
  CHANNEL_DELETE: "CHANNEL_DELETE",
  MEMBER_JOIN: "MEMBER_JOIN",
  MEMBER_LEAVE: "MEMBER_LEAVE",
  VOICE_STATE_UPDATE: "VOICE_STATE_UPDATE",
  TYPING_START: "TYPING_START",
  REACTION_ADD: "REACTION_ADD",
  REACTION_REMOVE: "REACTION_REMOVE",
  PRESENCE_UPDATE: "PRESENCE_UPDATE",
  MESSAGE_PIN: "MESSAGE_PIN",
  MESSAGE_UNPIN: "MESSAGE_UNPIN",
  SPEAKING_UPDATE: "SPEAKING_UPDATE",
  DM_MESSAGE_CREATE: "DM_MESSAGE_CREATE",
  DM_CHANNEL_CREATE: "DM_CHANNEL_CREATE",
  SCREEN_SHARE_START: "SCREEN_SHARE_START",
  SCREEN_SHARE_STOP: "SCREEN_SHARE_STOP",
} as const;

export type DispatchEvent = (typeof DispatchEvent)[keyof typeof DispatchEvent];

export interface WsIdentify {
  op: typeof WsOpcode.IDENTIFY;
  d: { token: string };
}

export interface WsHeartbeat {
  op: typeof WsOpcode.HEARTBEAT;
  d: null;
}

export interface WsHeartbeatAck {
  op: typeof WsOpcode.HEARTBEAT_ACK;
  d: null;
}

export interface WsReady {
  op: typeof WsOpcode.READY;
  d: { heartbeatInterval: number; serverVersion: string };
}

export interface WsDispatch<T = unknown> {
  op: typeof WsOpcode.DISPATCH;
  t: DispatchEvent;
  d: T;
}

// Dispatch event data types
export interface MessageDeleteData {
  id: string;
  channelId: string;
}

export interface MemberLeaveData {
  userId: string;
  serverId: string;
}

export interface TypingStartData {
  channelId: string;
  userId: string;
  username: string;
  displayName: string;
}

export interface ReactionData {
  messageId: string;
  channelId: string;
  userId: string;
  emoji: string;
}

export interface PresenceUpdateData {
  userId: string;
  status: "online" | "idle" | "dnd" | "offline";
}

export interface SpeakingUpdateData {
  userId: string;
  channelId: string;
  speaking: boolean;
}

export interface WsVoiceStateUpdate {
  op: typeof WsOpcode.VOICE_STATE_UPDATE;
  d: {
    channelId: string | null;
    serverId: string;
    muted?: boolean;
    deafened?: boolean;
  };
}

export interface WsVoiceSignal {
  op: typeof WsOpcode.VOICE_SIGNAL;
  d: {
    requestId: string;
    action: VoiceSignalAction;
    data?: any;
  };
}

export interface WsVoiceSignalResponse {
  op: typeof WsOpcode.VOICE_SIGNAL;
  d: {
    requestId: string;
    action: VoiceSignalAction;
    data?: any;
    error?: string;
  };
}

export interface WsTypingStart {
  op: typeof WsOpcode.TYPING_START;
  d: { channelId: string };
}

export type WsClientMessage = WsIdentify | WsHeartbeat | WsVoiceStateUpdate | WsVoiceSignal | WsTypingStart;

export type WsServerMessage =
  | WsHeartbeatAck
  | WsReady
  | WsDispatch<Message>
  | WsDispatch<MessageDeleteData>
  | WsDispatch<Channel>
  | WsDispatch<{ id: string; serverId: string }>
  | WsDispatch<ServerMember>
  | WsDispatch<MemberLeaveData>
  | WsDispatch<VoiceState>
  | WsVoiceSignalResponse;
