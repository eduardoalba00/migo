export interface VoiceState {
  userId: string;
  channelId: string | null;
  serverId: string;
  muted: boolean;
  deafened: boolean;
  screenSharing?: boolean;
  /** mediasoup producerId for screen share consumers */
  producerId?: string;
  /** Included in server→client broadcasts for display purposes */
  username?: string;
  displayName?: string;
  avatarUrl?: string | null;
}

export type VoiceSignalAction =
  | "joinVoice"
  | "screenGetCapabilities"
  | "screenCreateTransport"
  | "screenConnectTransport"
  | "screenProduce"
  | "screenConsume"
  | "screenResumeConsumer";

export interface LiveKitCredentials {
  token: string;
  url: string;
}

export interface VoiceChannelUser {
  userId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  muted: boolean;
  deafened: boolean;
  speaking: boolean;
  screenSharing: boolean;
}
