import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as usersSchema from "./schema/users.js";
import * as serversSchema from "./schema/servers.js";
import * as channelsSchema from "./schema/channels.js";
import * as invitesSchema from "./schema/invites.js";
import * as messagesSchema from "./schema/messages.js";
import * as reactionsSchema from "./schema/reactions.js";
import * as attachmentsSchema from "./schema/attachments.js";
import * as bansSchema from "./schema/bans.js";
import * as rolesSchema from "./schema/roles.js";
import * as dmChannelsSchema from "./schema/dm-channels.js";
import * as readStatesSchema from "./schema/read-states.js";

const schema = {
  ...usersSchema,
  ...serversSchema,
  ...channelsSchema,
  ...invitesSchema,
  ...messagesSchema,
  ...reactionsSchema,
  ...attachmentsSchema,
  ...bansSchema,
  ...rolesSchema,
  ...dmChannelsSchema,
  ...readStatesSchema,
};

export function createDatabase(databaseUrl: string) {
  const client = postgres(databaseUrl);
  const db = drizzle(client, { schema });
  return { db, client };
}

export type AppDatabase = ReturnType<typeof createDatabase>["db"];
