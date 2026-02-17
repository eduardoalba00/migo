export const PROTOCOL_VERSION = "0.27.2";

/**
 * Minimum client version the server will accept.
 * Bump this when deploying breaking server changes that require a client update.
 */
export const MIN_CLIENT_VERSION = "0.19.3";

export const AUTH_ROUTES = {
  REGISTER: "/api/auth/register",
  LOGIN: "/api/auth/login",
  REFRESH: "/api/auth/refresh",
  ME: "/api/auth/me",
} as const;

export const SERVER_ROUTES = {
  LIST: "/api/servers",
  CREATE: "/api/servers",
  GET: "/api/servers/:serverId",
  UPDATE: "/api/servers/:serverId",
  DELETE: "/api/servers/:serverId",
  MEMBERS: "/api/servers/:serverId/members",
  LEAVE: "/api/servers/:serverId/members/me",
  CATEGORIES_CREATE: "/api/servers/:serverId/categories",
  CATEGORIES_DELETE: "/api/servers/:serverId/categories/:categoryId",
  CHANNELS_LIST: "/api/servers/:serverId/channels",
  CHANNELS_CREATE: "/api/servers/:serverId/channels",
  CHANNELS_UPDATE: "/api/servers/:serverId/channels/:channelId",
  CHANNELS_DELETE: "/api/servers/:serverId/channels/:channelId",
  INVITES_CREATE: "/api/servers/:serverId/invites",
  INVITES_LIST: "/api/servers/:serverId/invites",
  INVITES_DELETE: "/api/servers/:serverId/invites/:inviteId",
  KICK_MEMBER: "/api/servers/:serverId/members/:userId",
  BANS_LIST: "/api/servers/:serverId/bans",
  BAN_CREATE: "/api/servers/:serverId/bans/:userId",
  BAN_DELETE: "/api/servers/:serverId/bans/:userId",
} as const;

export const INVITE_ROUTES = {
  JOIN: "/api/invites/join",
} as const;

export const MESSAGE_ROUTES = {
  LIST: "/api/channels/:channelId/messages",
  CREATE: "/api/channels/:channelId/messages",
  UPDATE: "/api/channels/:channelId/messages/:messageId",
  DELETE: "/api/channels/:channelId/messages/:messageId",
  REACTION_PUT: "/api/channels/:channelId/messages/:messageId/reactions/:emoji",
  REACTION_DELETE: "/api/channels/:channelId/messages/:messageId/reactions/:emoji",
  PIN: "/api/channels/:channelId/messages/:messageId/pin",
  UNPIN: "/api/channels/:channelId/messages/:messageId/pin",
  PINS_LIST: "/api/channels/:channelId/pins",
} as const;

export const UPLOAD_ROUTES = {
  UPLOAD: "/api/upload",
} as const;

export const SEARCH_ROUTES = {
  SEARCH: "/api/servers/:serverId/search",
} as const;

export const ROLE_ROUTES = {
  LIST: "/api/servers/:serverId/roles",
  CREATE: "/api/servers/:serverId/roles",
  UPDATE: "/api/servers/:serverId/roles/:roleId",
  DELETE: "/api/servers/:serverId/roles/:roleId",
  ASSIGN: "/api/servers/:serverId/members/:userId/roles/:roleId",
  REMOVE: "/api/servers/:serverId/members/:userId/roles/:roleId",
} as const;

export const DM_ROUTES = {
  LIST: "/api/dms",
  CREATE: "/api/dms",
  GET: "/api/dms/:channelId",
  MESSAGES_LIST: "/api/dms/:channelId/messages",
  MESSAGES_CREATE: "/api/dms/:channelId/messages",
} as const;

export const READ_STATE_ROUTES = {
  ACK: "/api/channels/:channelId/ack",
} as const;

export function buildRoute(
  template: string,
  params: Record<string, string>,
): string {
  return template.replace(/:(\w+)/g, (_, key) => {
    const value = params[key];
    if (value === undefined) throw new Error(`Missing route param: ${key}`);
    return encodeURIComponent(value);
  });
}
