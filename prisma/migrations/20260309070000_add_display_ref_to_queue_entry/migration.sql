-- AlterTable
ALTER TABLE "QueueEntry" ADD COLUMN "displayRef" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "QueueEntry_displayRef_key" ON "QueueEntry"("displayRef");
