-- AlterTable
ALTER TABLE "Venue"
ADD COLUMN "invoiceSequence" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "QueueEntry"
ADD COLUMN "tableReadyDeadlineAt" TIMESTAMP(3),
ADD COLUMN "tableReadyExpiredAt" TIMESTAMP(3);
