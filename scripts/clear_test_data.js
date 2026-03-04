const { PrismaClient, TableStatus } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  const result = await prisma.$transaction(async (tx) => {
    const partyBucket = await tx.partyBucketItem.deleteMany({});
    const participants = await tx.partyParticipant.deleteMany({});
    const sessions = await tx.partySession.deleteMany({});
    const notifications = await tx.notification.deleteMany({});
    const invoices = await tx.invoice.deleteMany({});
    const payments = await tx.payment.deleteMany({});
    const orderItems = await tx.orderItem.deleteMany({});
    const orders = await tx.order.deleteMany({});
    const queueEntries = await tx.queueEntry.deleteMany({});
    const otpCodes = await tx.otpCode.deleteMany({});
    const tables = await tx.table.updateMany({
      data: {
        status: TableStatus.FREE,
        occupiedSince: null,
        estimatedFreeAt: null,
        notes: null,
      },
    });

    return {
      partyBucket: partyBucket.count,
      participants: participants.count,
      sessions: sessions.count,
      notifications: notifications.count,
      invoices: invoices.count,
      payments: payments.count,
      orderItems: orderItems.count,
      orders: orders.count,
      queueEntries: queueEntries.count,
      otpCodes: otpCodes.count,
      tablesReset: tables.count,
    };
  });

  console.log(JSON.stringify({ ok: true, ...result }));
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
