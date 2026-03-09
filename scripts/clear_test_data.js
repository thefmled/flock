const { PrismaClient, TableStatus } = require('@prisma/client');

const prisma = new PrismaClient();

function readArg(flag) {
  const entry = process.argv.find((arg) => arg.startsWith(`${flag}=`));
  return entry ? entry.slice(flag.length + 1) : '';
}

function buildPrefix(runTag) {
  return `[FLOCK-TEST:${runTag}]`;
}

async function clearAllData() {
  return prisma.$transaction(async (tx) => {
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
      mode: 'all',
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
}

async function clearTaggedData(runTag) {
  const prefix = buildPrefix(runTag);

  const queueEntries = await prisma.queueEntry.findMany({
    where: {
      guestName: { startsWith: prefix },
    },
    select: {
      id: true,
      tableId: true,
      guestPhone: true,
      guestName: true,
    },
  });

  const queueEntryIds = queueEntries.map((entry) => entry.id);
  const tableIds = [...new Set(queueEntries.map((entry) => entry.tableId).filter(Boolean))];
  const guestPhones = [...new Set(queueEntries.map((entry) => entry.guestPhone).filter(Boolean))];

  const sessions = queueEntryIds.length
    ? await prisma.partySession.findMany({
        where: { queueEntryId: { in: queueEntryIds } },
        select: { id: true },
      })
    : [];
  const sessionIds = sessions.map((session) => session.id);

  const categories = await prisma.menuCategory.findMany({
    where: { name: { startsWith: prefix } },
    select: { id: true, name: true },
  });
  const categoryIds = categories.map((category) => category.id);

  const items = await prisma.menuItem.findMany({
    where: {
      OR: [
        { name: { startsWith: prefix } },
        categoryIds.length ? { categoryId: { in: categoryIds } } : undefined,
      ].filter(Boolean),
    },
    select: { id: true, name: true },
  });
  const itemIds = items.map((item) => item.id);

  return prisma.$transaction(async (tx) => {
    const notifications = queueEntryIds.length
      ? await tx.notification.deleteMany({ where: { queueEntryId: { in: queueEntryIds } } })
      : { count: 0 };

    const invoices = queueEntryIds.length
      ? await tx.invoice.deleteMany({ where: { order: { queueEntryId: { in: queueEntryIds } } } })
      : { count: 0 };

    const payments = queueEntryIds.length
      ? await tx.payment.deleteMany({ where: { order: { queueEntryId: { in: queueEntryIds } } } })
      : { count: 0 };

    const orderItems = queueEntryIds.length
      ? await tx.orderItem.deleteMany({ where: { order: { queueEntryId: { in: queueEntryIds } } } })
      : { count: 0 };

    const orders = queueEntryIds.length
      ? await tx.order.deleteMany({ where: { queueEntryId: { in: queueEntryIds } } })
      : { count: 0 };

    const flowEvents = queueEntryIds.length
      ? await tx.orderFlowEvent.deleteMany({ where: { queueEntryId: { in: queueEntryIds } } })
      : { count: 0 };

    const partyBucket = sessionIds.length
      ? await tx.partyBucketItem.deleteMany({ where: { partySessionId: { in: sessionIds } } })
      : { count: 0 };

    const participants = sessionIds.length
      ? await tx.partyParticipant.deleteMany({ where: { partySessionId: { in: sessionIds } } })
      : { count: 0 };

    const partySessions = queueEntryIds.length
      ? await tx.partySession.deleteMany({ where: { queueEntryId: { in: queueEntryIds } } })
      : { count: 0 };

    const queueDeleted = queueEntryIds.length
      ? await tx.queueEntry.deleteMany({ where: { id: { in: queueEntryIds } } })
      : { count: 0 };

    const otpCodes = guestPhones.length
      ? await tx.otpCode.deleteMany({ where: { phone: { in: guestPhones } } })
      : { count: 0 };

    const resetTables = tableIds.length
      ? await tx.table.updateMany({
          where: { id: { in: tableIds } },
          data: {
            status: TableStatus.FREE,
            occupiedSince: null,
            estimatedFreeAt: null,
            notes: null,
          },
        })
      : { count: 0 };

    const menuItems = itemIds.length
      ? await tx.menuItem.deleteMany({ where: { id: { in: itemIds } } })
      : { count: 0 };

    const menuCategories = categoryIds.length
      ? await tx.menuCategory.deleteMany({ where: { id: { in: categoryIds } } })
      : { count: 0 };

    return {
      mode: 'tagged',
      runTag,
      matchedQueueEntries: queueEntries.length,
      matchedCategories: categories.length,
      matchedItems: items.length,
      notifications: notifications.count,
      invoices: invoices.count,
      payments: payments.count,
      orderItems: orderItems.count,
      orders: orders.count,
      flowEvents: flowEvents.count,
      partyBucket: partyBucket.count,
      participants: participants.count,
      partySessions: partySessions.count,
      queueEntries: queueDeleted.count,
      otpCodes: otpCodes.count,
      tablesReset: resetTables.count,
      menuItems: menuItems.count,
      menuCategories: menuCategories.count,
    };
  });
}

async function main() {
  const clearAll = process.argv.includes('--all');
  const runTag = readArg('--run-tag') || process.env.FLOCK_TEST_RUN_TAG || 'local';
  const result = clearAll
    ? await clearAllData()
    : await clearTaggedData(runTag);

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
