CREATE TABLE "dm_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"channel_id" text NOT NULL,
	"author_id" text NOT NULL,
	"content" text NOT NULL,
	"edited_at" timestamp,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dm_messages" ADD CONSTRAINT "dm_messages_channel_id_dm_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."dm_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dm_messages" ADD CONSTRAINT "dm_messages_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
