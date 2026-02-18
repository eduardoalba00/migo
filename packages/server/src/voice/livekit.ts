import { AccessToken, RoomServiceClient } from "livekit-server-sdk";
import type { Config } from "../config.js";

export class LiveKitService {
  private config: Config;
  private roomService: RoomServiceClient;

  constructor(config: Config) {
    this.config = config;
    // RoomServiceClient uses HTTP API (port 7880 for both WS and HTTP on LiveKit dev server)
    const httpUrl = config.livekitUrl.replace(/^ws/, "http");
    this.roomService = new RoomServiceClient(httpUrl, config.livekitApiKey, config.livekitApiSecret);
  }

  async generateToken(userId: string, displayName: string, roomName: string): Promise<string> {
    const token = new AccessToken(this.config.livekitApiKey, this.config.livekitApiSecret, {
      identity: userId,
      name: displayName,
      ttl: "1h",
    });

    token.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });

    return await token.toJwt();
  }

  get url(): string {
    return this.config.livekitUrl;
  }

  async listParticipants(roomName: string) {
    try {
      return await this.roomService.listParticipants(roomName);
    } catch {
      return [];
    }
  }
}
