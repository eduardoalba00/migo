-- Add is_system column to channels
ALTER TABLE "channels" ADD COLUMN "is_system" boolean NOT NULL DEFAULT false;

-- Create clips channel for every existing server that doesn't already have one
INSERT INTO "channels" ("id", "server_id", "name", "type", "position", "is_system")
SELECT
  gen_random_uuid(),
  s.id,
  'clips',
  'text',
  -1,
  true
FROM "servers" s
WHERE NOT EXISTS (
  SELECT 1 FROM "channels" c
  WHERE c.server_id = s.id AND c.name = 'clips' AND c.is_system = true
);