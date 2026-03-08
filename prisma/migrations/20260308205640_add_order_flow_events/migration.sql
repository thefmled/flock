-- CreateEnum
CREATE TYPE "OrderFlowEventType" AS ENUM ('QUEUE_JOINED', 'PREORDER_CREATED', 'PREORDER_REPLACED', 'DEPOSIT_INITIATED', 'DEPOSIT_CAPTURED', 'TABLE_NOTIFIED', 'GUEST_SEATED', 'TABLE_ORDER_CREATED', 'FINAL_PAYMENT_INITIATED', 'FINAL_PAYMENT_CAPTURED', 'OFFLINE_SETTLED', 'ENTRY_COMPLETED', 'ENTRY_CANCELLED', 'DEPOSIT_REFUNDED');

-- CreateTable
CREATE TABLE "OrderFlowEvent" (
    "id" TEXT NOT NULL,
    "queueEntryId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "type" "OrderFlowEventType" NOT NULL,
    "orderId" TEXT,
    "paymentId" TEXT,
    "snapshot" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderFlowEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrderFlowEvent_queueEntryId_idx" ON "OrderFlowEvent"("queueEntryId");

-- CreateIndex
CREATE INDEX "OrderFlowEvent_venueId_createdAt_idx" ON "OrderFlowEvent"("venueId", "createdAt");

-- AddForeignKey
ALTER TABLE "OrderFlowEvent" ADD CONSTRAINT "OrderFlowEvent_queueEntryId_fkey" FOREIGN KEY ("queueEntryId") REFERENCES "QueueEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderFlowEvent" ADD CONSTRAINT "OrderFlowEvent_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
