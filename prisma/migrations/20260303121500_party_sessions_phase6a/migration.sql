DO $$
BEGIN
  CREATE TYPE "PartySessionStatus" AS ENUM ('ACTIVE', 'LOCKED', 'CLOSED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "PartyParticipantRole" AS ENUM ('HOST', 'MEMBER');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "PartySession" (
  "id" TEXT NOT NULL,
  "queueEntryId" TEXT NOT NULL,
  "venueId" TEXT NOT NULL,
  "status" "PartySessionStatus" NOT NULL DEFAULT 'ACTIVE',
  "joinToken" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PartySession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PartyParticipant" (
  "id" TEXT NOT NULL,
  "partySessionId" TEXT NOT NULL,
  "displayName" TEXT,
  "guestPhone" TEXT,
  "role" "PartyParticipantRole" NOT NULL DEFAULT 'MEMBER',
  "isPayer" BOOLEAN NOT NULL DEFAULT false,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PartyParticipant_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PartyBucketItem" (
  "id" TEXT NOT NULL,
  "partySessionId" TEXT NOT NULL,
  "menuItemId" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "updatedByParticipantId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PartyBucketItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PartySession_queueEntryId_key"
ON "PartySession"("queueEntryId");

CREATE UNIQUE INDEX IF NOT EXISTS "PartySession_joinToken_key"
ON "PartySession"("joinToken");

CREATE INDEX IF NOT EXISTS "PartySession_venueId_status_idx"
ON "PartySession"("venueId", "status");

CREATE INDEX IF NOT EXISTS "PartyParticipant_partySessionId_role_idx"
ON "PartyParticipant"("partySessionId", "role");

CREATE INDEX IF NOT EXISTS "PartyParticipant_partySessionId_isPayer_idx"
ON "PartyParticipant"("partySessionId", "isPayer");

CREATE UNIQUE INDEX IF NOT EXISTS "PartyBucketItem_partySessionId_menuItemId_key"
ON "PartyBucketItem"("partySessionId", "menuItemId");

CREATE INDEX IF NOT EXISTS "PartyBucketItem_partySessionId_idx"
ON "PartyBucketItem"("partySessionId");

DO $$
BEGIN
  ALTER TABLE "PartySession"
    ADD CONSTRAINT "PartySession_queueEntryId_fkey"
    FOREIGN KEY ("queueEntryId") REFERENCES "QueueEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "PartySession"
    ADD CONSTRAINT "PartySession_venueId_fkey"
    FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "PartyParticipant"
    ADD CONSTRAINT "PartyParticipant_partySessionId_fkey"
    FOREIGN KEY ("partySessionId") REFERENCES "PartySession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "PartyBucketItem"
    ADD CONSTRAINT "PartyBucketItem_partySessionId_fkey"
    FOREIGN KEY ("partySessionId") REFERENCES "PartySession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "PartyBucketItem"
    ADD CONSTRAINT "PartyBucketItem_menuItemId_fkey"
    FOREIGN KEY ("menuItemId") REFERENCES "MenuItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "PartyBucketItem"
    ADD CONSTRAINT "PartyBucketItem_updatedByParticipantId_fkey"
    FOREIGN KEY ("updatedByParticipantId") REFERENCES "PartyParticipant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
