-- Remove all clips system channels
DELETE FROM channels WHERE name = 'clips' AND is_system = true;

-- Drop the is_system column
ALTER TABLE "channels" DROP COLUMN "is_system";
