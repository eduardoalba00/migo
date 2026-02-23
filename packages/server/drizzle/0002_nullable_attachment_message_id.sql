ALTER TABLE "attachments" ALTER COLUMN "message_id" DROP NOT NULL;
ALTER TABLE "attachments" DROP CONSTRAINT IF EXISTS "attachments_message_id_messages_id_fk";