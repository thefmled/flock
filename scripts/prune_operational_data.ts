import { PrismaClient, QueueEntryStatus } from '@prisma/client';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

function cutoffDate(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

async function main() {
  const cutoffs = {
    otpCode: cutoffDate(7),
    notifications: cutoffDate(90),
    tableEvents: cutoffDate(90),
    queueEntries: cutoffDate(180),
  };

  const queueEntryWhere = {
    status: { in: [QueueEntryStatus.COMPLETED, QueueEntryStatus.CANCELLED, QueueEntryStatus.NO_SHOW] },
    updatedAt: { lt: cutoffs.queueEntries },
    orders: { none: {} },
    notifications: { none: {} },
  };

  const counts = {
    otpCode: await prisma.otpCode.count({
      where: { createdAt: { lt: cutoffs.otpCode } },
    }),
    notifications: await prisma.notification.count({
      where: { createdAt: { lt: cutoffs.notifications } },
    }),
    tableEvents: await prisma.tableEvent.count({
      where: { createdAt: { lt: cutoffs.tableEvents } },
    }),
    queueEntries: await prisma.queueEntry.count({
      where: queueEntryWhere,
    }),
  };

  console.log(JSON.stringify({
    mode: APPLY ? 'apply' : 'dry-run',
    counts,
    retained: ['Order', 'Payment', 'Invoice'],
  }, null, 2));

  if (!APPLY) {
    return;
  }

  await prisma.$transaction([
    prisma.otpCode.deleteMany({
      where: { createdAt: { lt: cutoffs.otpCode } },
    }),
    prisma.notification.deleteMany({
      where: { createdAt: { lt: cutoffs.notifications } },
    }),
    prisma.tableEvent.deleteMany({
      where: { createdAt: { lt: cutoffs.tableEvents } },
    }),
    prisma.queueEntry.deleteMany({
      where: queueEntryWhere,
    }),
  ]);

  console.log('Operational pruning applied.');
}

main()
  .catch((error) => {
    console.error('Failed to prune operational data', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
