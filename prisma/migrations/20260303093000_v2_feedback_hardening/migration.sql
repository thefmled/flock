DO $$
BEGIN
  CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "Notification"
ALTER COLUMN "status" DROP DEFAULT;

UPDATE "Notification"
SET "status" = LOWER(COALESCE("status", 'pending'));

ALTER TABLE "Notification"
ALTER COLUMN "status" TYPE "NotificationStatus"
USING (
  CASE
    WHEN "status" = 'sent' THEN 'SENT'
    WHEN "status" = 'failed' THEN 'FAILED'
    ELSE 'PENDING'
  END
)::"NotificationStatus";

ALTER TABLE "Notification"
ALTER COLUMN "status" SET DEFAULT 'PENDING';

CREATE INDEX IF NOT EXISTS "QueueEntry_status_tableReadyDeadlineAt_idx"
ON "QueueEntry"("status", "tableReadyDeadlineAt");

CREATE UNIQUE INDEX IF NOT EXISTS "MenuItem_venueId_name_key"
ON "MenuItem"("venueId", "name");
