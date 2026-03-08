import { prisma } from '../config/database';
import { aggregateGst, calcGstBreakdown } from '../utils/gst';
import { pushOrderToPos } from '../integrations/urbanpiper';
import { AppError } from '../middleware/errorHandler';
import { OrderType, PaymentStatus, PaymentType, QueueEntryStatus } from '@prisma/client';
import { logFlowEvent, OrderFlowEventType } from './orderFlowEvent.service';

export interface OrderItemInput {
  menuItemId: string;
  quantity:   number;
  notes?:     string;
}

// ── Create pre-order ──────────────────────────────────────────────

export async function createPreOrder(params: {
  venueId:      string;
  queueEntryId: string;
  items:        OrderItemInput[];
  notes?:       string;
}) {
  const entry = await prisma.queueEntry.findFirst({
    where: {
      id: params.queueEntryId,
      venueId: params.venueId,
      status: { in: [QueueEntryStatus.WAITING, QueueEntryStatus.NOTIFIED] },
    },
  });
  if (!entry) throw new AppError('Queue entry not found or already seated', 400);
  if (entry.depositPaid > 0) {
    throw new AppError('A deposit-backed pre-order already exists for this guest', 400, 'PREORDER_LOCKED');
  }

  const existingPreOrders = await prisma.order.findMany({
    where: {
      venueId: params.venueId,
      queueEntryId: params.queueEntryId,
      type: OrderType.PRE_ORDER,
      status: { notIn: ['CANCELLED'] },
    },
    select: { id: true },
  });

  if (existingPreOrders.length) {
    const staleOrderIds = existingPreOrders.map((order) => order.id);
    await prisma.$transaction([
      prisma.payment.updateMany({
        where: {
          orderId: { in: staleOrderIds },
          type: PaymentType.DEPOSIT,
          status: { in: [PaymentStatus.PENDING, PaymentStatus.PROCESSING] },
        },
        data: {
          status: PaymentStatus.FAILED,
          failureReason: 'Superseded by a newer pre-order attempt',
        },
      }),
      prisma.order.updateMany({
        where: { id: { in: staleOrderIds } },
        data: { status: 'CANCELLED' },
      }),
    ]);
  }

  const replacedOrderIds = existingPreOrders.length ? existingPreOrders.map(o => o.id) : undefined;
  const order = await buildOrder(params.venueId, params.queueEntryId, OrderType.PRE_ORDER, params.items, params.notes);

  await logFlowEvent({
    queueEntryId: params.queueEntryId,
    venueId: params.venueId,
    type: replacedOrderIds ? OrderFlowEventType.PREORDER_REPLACED : OrderFlowEventType.PREORDER_CREATED,
    orderId: order.id,
    snapshot: { totalIncGst: order.totalIncGst, itemCount: params.items.length, replacedOrderIds },
  });

  return order;
}

// ── Create table order ────────────────────────────────────────────

export async function createTableOrder(params: {
  venueId:      string;
  queueEntryId: string;
  items:        OrderItemInput[];
  notes?:       string;
}) {
  return createTableOrderInternal({
    venueId: params.venueId,
    queueEntryId: params.queueEntryId,
    items: params.items,
    notes: params.notes,
    initiatedBy: 'staff',
  });
}

export async function createGuestTableOrder(params: {
  venueId:      string;
  queueEntryId: string;
  items:        OrderItemInput[];
  notes?:       string;
}) {
  return createTableOrderInternal({
    venueId: params.venueId,
    queueEntryId: params.queueEntryId,
    items: params.items,
    notes: params.notes,
    initiatedBy: 'guest',
  });
}

export async function syncPendingPreOrderForSeating(params: {
  venueId: string;
  queueEntryId: string;
  tableId?: string | null;
}) {
  const preOrder = await prisma.order.findFirst({
    where: {
      venueId: params.venueId,
      queueEntryId: params.queueEntryId,
      type: OrderType.PRE_ORDER,
      status: { notIn: ['CANCELLED'] },
    },
    include: {
      items: true,
      queueEntry: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  if (!preOrder) {
    return { attempted: false, status: 'no_preorder' as const };
  }

  if (preOrder.posPushedAt) {
    return { attempted: true, status: 'already_synced' as const, posOrderId: preOrder.posOrderId ?? undefined };
  }

  const venue = await prisma.venue.findUnique({ where: { id: params.venueId } });
  if (!venue?.posOutletId) {
    return { attempted: true, status: 'manual_fallback' as const };
  }

  const result = await pushOrderToPos({
    outletId: venue.posOutletId,
    channelRef: preOrder.id,
    tableNumber: params.tableId ?? preOrder.queueEntry.tableId ?? 'manual-seat',
    guestName: preOrder.queueEntry.guestName,
    notes: preOrder.notes ?? undefined,
    items: preOrder.items.map(item => ({
      id: item.menuItemId,
      name: item.name,
      price: item.priceExGst / 100,
      quantity: item.quantity,
    })),
  });

  await prisma.order.update({
    where: { id: preOrder.id },
    data: { posOrderId: result.posOrderId, posPushedAt: new Date() },
  });

  return { attempted: true, status: 'synced' as const, posOrderId: result.posOrderId };
}

// ── Get full bill for a queue entry ──────────────────────────────

export async function getGuestBill(queueEntryId: string) {
  const entry = await prisma.queueEntry.findUnique({
    where: { id: queueEntryId },
    include: {
      orders: {
        include: { items: { include: { menuItem: true } } },
        where:   { status: { notIn: ['CANCELLED'] } },
      },
    },
  });
  if (!entry) throw new AppError('Queue entry not found', 404);

  const billableOrders = selectBillableOrders(entry.orders);
  const allItems = billableOrders.flatMap(o => o.items);
  const gst      = aggregateGst(allItems.map(i => ({ priceExGst: i.priceExGst, quantity: i.quantity, gstPercent: i.gstPercent })));

  return {
    queueEntryId: entry.id,
    guestName:    entry.guestName,
    orders: billableOrders.map(o => ({
      id:     o.id,
      type:   o.type,
      status: o.status,
      total:  o.totalIncGst,
      items:  o.items,
    })),
    summary: {
      subtotalExGst: gst.subtotalExGst,
      cgst:          gst.cgstAmount,
      sgst:          gst.sgstAmount,
      totalIncGst:   gst.totalIncGst,
      depositPaid:   entry.depositPaid,
      balanceDue:    Math.max(0, gst.totalIncGst - entry.depositPaid),
    },
  };
}

export function selectBillableOrders<T extends { type: OrderType; createdAt: Date; status: string }>(orders: T[]): T[] {
  const activeOrders = orders.filter((order) => order.status !== 'CANCELLED');
  const latestPreOrder = activeOrders
    .filter((order) => order.type === OrderType.PRE_ORDER)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];

  const nonPreOrders = activeOrders.filter((order) => order.type !== OrderType.PRE_ORDER);
  return latestPreOrder ? [latestPreOrder, ...nonPreOrders] : nonPreOrders;
}

// ── Internal ──────────────────────────────────────────────────────

async function buildOrder(
  venueId: string,
  queueEntryId: string,
  type: OrderType,
  items: OrderItemInput[],
  notes?: string
) {
  const menuItemIds = items.map(i => i.menuItemId);
  const menuItems   = await prisma.menuItem.findMany({
    where: { id: { in: menuItemIds }, venueId, isAvailable: true },
  });

  if (menuItems.length !== menuItemIds.length) throw new AppError('One or more menu items unavailable', 400);

  const itemMap = new Map(menuItems.map(m => [m.id, m]));
  const gst = aggregateGst(
    items.map(i => {
      const m = itemMap.get(i.menuItemId)!;
      return { priceExGst: m.priceExGst, quantity: i.quantity, gstPercent: m.gstPercent };
    })
  );

  return prisma.order.create({
    data: {
      venueId,
      queueEntryId,
      type,
      status:       'CONFIRMED',
      subtotalExGst: gst.subtotalExGst,
      cgstAmount:    gst.cgstAmount,
      sgstAmount:    gst.sgstAmount,
      totalIncGst:   gst.totalIncGst,
      notes,
      items: {
        create: items.map(i => {
          const m  = itemMap.get(i.menuItemId)!;
          const lc = calcGstBreakdown(m.priceExGst, i.quantity, m.gstPercent);
          return {
            menuItemId: i.menuItemId,
            name:       m.name,
            priceExGst: m.priceExGst,
            gstPercent: m.gstPercent,
            quantity:   i.quantity,
            subtotal:   lc.subtotal,
            gstAmount:  lc.gstAmount,
            totalIncGst: lc.totalIncGst,
          };
        }),
      },
    },
    include: { items: true },
  });
}

async function createTableOrderInternal(params: {
  venueId: string;
  queueEntryId: string;
  items: OrderItemInput[];
  notes?: string;
  initiatedBy: 'guest' | 'staff';
}) {
  const entry = await prisma.queueEntry.findFirst({
    where: { id: params.queueEntryId, venueId: params.venueId, status: QueueEntryStatus.SEATED },
    select: {
      id: true,
      tableId: true,
      guestName: true,
      table: {
        select: { label: true },
      },
    },
  });
  if (!entry) throw new AppError('Guest is not currently seated', 400);

  const order = await buildOrder(params.venueId, params.queueEntryId, OrderType.TABLE_ORDER, params.items, params.notes);
  const posSync = await syncTableOrderToPos({
    venueId: params.venueId,
    orderId: order.id,
    fallbackTableNumber: entry.table?.label ?? 'unknown',
    guestName: entry.guestName,
    notes: params.notes,
  });

  await logFlowEvent({
    queueEntryId: params.queueEntryId,
    venueId: params.venueId,
    type: OrderFlowEventType.TABLE_ORDER_CREATED,
    orderId: order.id,
    snapshot: { totalIncGst: order.totalIncGst, itemCount: params.items.length, initiatedBy: params.initiatedBy, posSync },
  });

  return {
    ...order,
    posSync,
  };
}

async function syncTableOrderToPos(params: {
  venueId: string;
  orderId: string;
  fallbackTableNumber: string;
  guestName: string;
  notes?: string;
}) {
  try {
    const venue = await prisma.venue.findUnique({ where: { id: params.venueId } });
    if (!venue?.posOutletId) {
      return { attempted: true, status: 'manual_fallback' as const };
    }

    const menuItems = await prisma.orderItem.findMany({
      where: { orderId: params.orderId },
    });
    const result = await pushOrderToPos({
      outletId: venue.posOutletId,
      channelRef: params.orderId,
      tableNumber: params.fallbackTableNumber,
      guestName: params.guestName,
      notes: params.notes,
      items: menuItems.map((item) => ({
        id: item.menuItemId,
        name: item.name,
        price: item.priceExGst / 100,
        quantity: item.quantity,
      })),
    });

    await prisma.order.update({
      where: { id: params.orderId },
      data: { posOrderId: result.posOrderId, posPushedAt: new Date() },
    });

    return { attempted: true, status: 'synced' as const, posOrderId: result.posOrderId };
  } catch (err) {
    console.error('POS push failed (non-fatal):', { err, venueId: params.venueId, orderId: params.orderId });
    return { attempted: true, status: 'manual_fallback' as const };
  }
}
