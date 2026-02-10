export interface VoiceState {
  userId: string;
  channelId: string | null;
  serverId: string;
  muted: boolean;
  deafened: boolean;
  screenSharing?: boolean;
  /** Included in server→client broadcasts for display purposes */
  username?: string;
  displayName?: string;
  avatarUrl?: string | null;
}

export type VoiceSignalAction =
  | "routerRtpCapabilities"
  | "createSendTransport"
  | "connectTransport"
  | "produce"
  | "createRecvTransport"
  | "consume"
  | "resumeConsumer"
  | "stopScreenShare";

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
