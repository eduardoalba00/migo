import crypto from "node:crypto";

export interface Config {
  port: number;
  host: string;
  databasePath: string;
  jwtAccessSecret: string;
  jwtRefreshSecret: string;
  accessTokenExpiry: string;
  refreshTokenExpiry: string;
  livekitUrl: string;
  livekitApiKey: string;
  livekitApiSecret: string;
  uploadDir: string;
  maxFileSizeMb: number;
}

export function loadConfig(): Config {
  return {
    port: parseInt(process.env.PORT || "8080", 10),
    host: process.env.HOST || "0.0.0.0",
    databasePath: process.env.DATABASE_PATH || "./migo.db",
    jwtAccessSecret: process.env.JWT_ACCESS_SECRET || crypto.randomBytes(32).toString("hex"),
    jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || crypto.randomBytes(32).toString("hex"),
    accessTokenExpiry: process.env.ACCESS_TOKEN_EXPIRY || "15m",
    refreshTokenExpiry: process.env.REFRESH_TOKEN_EXPIRY || "7d",
    livekitUrl: process.env.LIVEKIT_URL || "ws://localhost:7880",
    livekitApiKey: process.env.LIVEKIT_API_KEY || "devkey",
    livekitApiSecret: process.env.LIVEKIT_API_SECRET || "secret",
    uploadDir: process.env.UPLOAD_DIR || "./uploads",
    maxFileSizeMb: parseInt(process.env.MAX_FILE_SIZE_MB || "25", 10),
  };
}
