import { OrderType, QueueEntryStatus } from '@prisma/client';
import { AppError } from '../../src/middleware/errorHandler';
import { createPrismaMock } from '../helpers/mock-prisma';

const prismaMock = createPrismaMock();
const logFlowEventMock = vi.fn();
const pushOrderToPosMock = vi.fn();

vi.mock('../../src/config/database', () => ({
  prisma: prismaMock,
}));

vi.mock('../../src/services/orderFlowEvent.service', () => ({
  OrderFlowEventType: {
    PREORDER_CREATED: 'PREORDER_CREATED',
    PREORDER_REPLACED: 'PREORDER_REPLACED',
    TABLE_ORDER_CREATED: 'TABLE_ORDER_CREATED',
  },
  logFlowEvent: logFlowEventMock,
}));

vi.mock('../../src/integrations/urbanpiper', () => ({
  pushOrderToPos: pushOrderToPosMock,
}));

describe('order service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps only the latest preorder when selecting billable orders', async () => {
    const { selectBillableOrders } = await import('../../src/services/order.service');

    const older = {
      id: 'pre_old',
      type: OrderType.PRE_ORDER,
      status: 'CONFIRMED',
      createdAt: new Date('2026-03-08T10:00:00.000Z'),
    };
    const newer = {
      id: 'pre_new',
      type: OrderType.PRE_ORDER,
      status: 'CONFIRMED',
      createdAt: new Date('2026-03-08T12:00:00.000Z'),
    };
    const table = {
      id: 'table_order',
      type: OrderType.TABLE_ORDER,
      status: 'CONFIRMED',
      createdAt: new Date('2026-03-08T13:00:00.000Z'),
    };

    expect(selectBillableOrders([older, newer, table])).toEqual([newer, table]);
  });

  it('calculates the guest bill using only active orders and subtracts deposit', async () => {
    const { getGuestBill } = await import('../../src/services/order.service');

    prismaMock.queueEntry.findUnique.mockResolvedValue({
      id: 'entry_1',
      guestName: 'Priya',
      depositPaid: 20_000,
      orders: [
        {
          id: 'order_1',
          type: OrderType.PRE_ORDER,
          status: 'CONFIRMED',
          totalIncGst: 32_450,
          createdAt: new Date('2026-03-09T10:00:00.000Z'),
          items: [
            { priceExGst: 27_500, quantity: 1, gstPercent: 18, name: 'IPA' },
          ],
        },
        {
          id: 'order_2',
          type: OrderType.TABLE_ORDER,
          status: 'CONFIRMED',
          totalIncGst: 18_900,
          createdAt: new Date('2026-03-09T11:00:00.000Z'),
          items: [
            { priceExGst: 18_000, quantity: 1, gstPercent: 5, name: 'Nachos' },
          ],
        },
        {
          id: 'order_cancelled',
          type: OrderType.TABLE_ORDER,
          status: 'CANCELLED',
          totalIncGst: 999_999,
          createdAt: new Date('2026-03-09T12:00:00.000Z'),
          items: [],
        },
      ],
    });

    const bill = await getGuestBill('entry_1');

    expect(bill.summary).toEqual({
      subtotalExGst: 45_500,
      cgst: 2_925,
      sgst: 2_925,
      totalIncGst: 51_350,
      depositPaid: 20_000,
      balanceDue: 31_350,
    });
    expect(bill.orders).toHaveLength(2);
  });

  it('replaces stale preorders before creating a new one', async () => {
    const { createPreOrder } = await import('../../src/services/order.service');

    prismaMock.queueEntry.findFirst.mockResolvedValue({
      id: 'entry_1',
      venueId: 'venue_1',
      status: QueueEntryStatus.WAITING,
      depositPaid: 0,
    });
    prismaMock.order.findMany.mockResolvedValue([{ id: 'order_old' }]);
    prismaMock.menuItem.findMany.mockResolvedValue([
      { id: 'item_1', venueId: 'venue_1', name: 'IPA', priceExGst: 27_500, gstPercent: 18, isAvailable: true },
    ]);
    prismaMock.order.create.mockResolvedValue({
      id: 'order_new',
      totalIncGst: 32_450,
      items: [],
    });

    const order = await createPreOrder({
      venueId: 'venue_1',
      queueEntryId: 'entry_1',
      items: [{ menuItemId: 'item_1', quantity: 1 }],
    });

    expect(prismaMock.payment.updateMany).toHaveBeenCalled();
    expect(prismaMock.order.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { in: ['order_old'] } },
      data: { status: 'CANCELLED' },
    }));
    expect(order.id).toBe('order_new');
    expect(logFlowEventMock).toHaveBeenCalledWith(expect.objectContaining({
      type: 'PREORDER_REPLACED',
      snapshot: expect.objectContaining({ replacedOrderIds: ['order_old'] }),
    }));
  });

  it('rejects guest table orders when the entry is not seated', async () => {
    const { createGuestTableOrder } = await import('../../src/services/order.service');

    prismaMock.queueEntry.findFirst.mockResolvedValue(null);

    await expect(createGuestTableOrder({
      venueId: 'venue_1',
      queueEntryId: 'entry_1',
      items: [{ menuItemId: 'item_1', quantity: 1 }],
    })).rejects.toBeInstanceOf(AppError);
  });
});
