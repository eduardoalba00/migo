import type { User } from "./user.js";

export type ChannelType = "text" | "voice";

export interface Server {
  id: string;
  name: string;
  iconUrl: string | null;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
}

export interface ServerMember {
  id: string;
  serverId: string;
  userId: string;
  user: User;
  joinedAt: string;
}

export interface Category {
  id: string;
  serverId: string;
  name: string;
  position: number;
}

export interface Channel {
  id: string;
  serverId: string;
  categoryId: string | null;
  name: string;
  type: ChannelType;
  topic: string | null;
  position: number;
  isSystem?: boolean;
}

export interface CategoryWithChannels extends Category {
  channels: Channel[];
}

export interface ServerChannelList {
  uncategorized: Channel[];
  categories: CategoryWithChannels[];
}

export interface Invite {
  id: string;
  serverId: string;
  code: string;
  creatorId: string;
  maxUses: number | null;
  uses: number;
  expiresAt: string | null;
  createdAt: string;
}
