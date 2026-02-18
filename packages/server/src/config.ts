import crypto from "node:crypto";

export interface Config {
  port: number;
  host: string;
  databaseUrl: string;
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

function buildDatabaseUrl(): string {
  const user = process.env.POSTGRES_USER || "migo";
  const password = process.env.POSTGRES_PASSWORD || "";
  const host = process.env.POSTGRES_HOST || "localhost";
  const port = process.env.POSTGRES_PORT || "5433";
  const db = process.env.POSTGRES_DB || "migo";
  const auth = password ? `${user}:${password}` : user;
  return `postgres://${auth}@${host}:${port}/${db}`;
}

export function loadConfig(): Config {
  return {
    port: parseInt(process.env.PORT || "3000", 10),
    host: process.env.HOST || "0.0.0.0",
    databaseUrl: process.env.DATABASE_URL || buildDatabaseUrl(),
    jwtAccessSecret: process.env.JWT_ACCESS_SECRET || crypto.randomBytes(32).toString("hex"),
    jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || crypto.randomBytes(32).toString("hex"),
    accessTokenExpiry: process.env.ACCESS_TOKEN_EXPIRY || "15m",
    refreshTokenExpiry: process.env.REFRESH_TOKEN_EXPIRY || "7d",
    livekitUrl: process.env.LIVEKIT_URL || "",
    livekitApiKey: process.env.LIVEKIT_API_KEY || "",
    livekitApiSecret: process.env.LIVEKIT_API_SECRET || "",
    uploadDir: process.env.UPLOAD_DIR || "./uploads",
    maxFileSizeMb: parseInt(process.env.MAX_FILE_SIZE_MB || "25", 10),
  };
}
