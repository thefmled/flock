import { invokeApp } from '../helpers/invoke-app';

const { orderServiceMock, paymentServiceMock } = vi.hoisted(() => ({
  orderServiceMock: {
    createPreOrder: vi.fn(),
    createTableOrder: vi.fn(),
    createGuestTableOrder: vi.fn(),
    getGuestBill: vi.fn(),
  },
  paymentServiceMock: {
    initiateDeposit: vi.fn(),
    captureDeposit: vi.fn(),
    initiateFinalPayment: vi.fn(),
    captureFinalPayment: vi.fn(),
    capturePaymentFromWebhook: vi.fn(),
    settleFinalOffline: vi.fn(),
    refundDeposit: vi.fn(),
  },
}));

vi.mock('../../src/services/order.service', () => orderServiceMock);
vi.mock('../../src/services/payment.service', () => paymentServiceMock);
vi.mock('../../src/integrations/razorpay', async () => {
  const actual = await vi.importActual<typeof import('../../src/integrations/razorpay')>('../../src/integrations/razorpay');
  return {
    ...actual,
    verifyWebhookSignature: vi.fn(() => true),
  };
});

vi.mock('../../src/middleware/auth', () => ({
  requireAuth: (req: any, res: any, next: any) => {
    if (req.header('authorization') !== 'Bearer staff-token') {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }
    req.staff = { id: 'staff_1', role: 'MANAGER', venueId: 'venue_1' };
    req.venue = { id: 'venue_1', slug: 'the-barrel-room-koramangala' };
    next();
  },
  requireGuestAuth: (req: any, res: any, next: any) => {
    if (req.header('authorization') !== 'Bearer guest-token') {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }
    req.guest = { queueEntryId: 'entry_1', venueId: 'venue_1', guestPhone: '9876543210' };
    next();
  },
  requireGuestOrStaffAuth: (req: any, res: any, next: any) => {
    if (req.header('authorization') === 'Bearer guest-token') {
      req.guest = { queueEntryId: 'entry_1', venueId: 'venue_1', guestPhone: '9876543210' };
      next();
      return;
    }
    if (req.header('authorization') === 'Bearer staff-token') {
      req.staff = { id: 'staff_1', role: 'MANAGER', venueId: 'venue_1' };
      req.venue = { id: 'venue_1', slug: 'the-barrel-room-koramangala' };
      next();
      return;
    }
    res.status(401).json({ success: false, error: 'Unauthorized' });
  },
  requireRole: () => (_req: any, _res: any, next: any) => next(),
}));

describe('order and payment routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('covers preorder, guest table order, and bill retrieval', async () => {
    orderServiceMock.createPreOrder.mockResolvedValue({ id: 'order_pre_1' });
    orderServiceMock.createGuestTableOrder.mockResolvedValue({ id: 'order_table_1' });
    orderServiceMock.getGuestBill.mockResolvedValue({ summary: { balanceDue: 1_000 } });

    const app = (await import('../../src/app')).default;

    expect((await invokeApp(app, {
      method: 'POST',
      url: '/api/v1/orders/preorder',
      headers: { authorization: 'Bearer guest-token' },
      body: { queueEntryId: 'entry_1', items: [{ menuItemId: 'item_1', quantity: 1 }] },
    })).status).toBe(201);

    expect((await invokeApp(app, {
      method: 'POST',
      url: '/api/v1/orders/table/guest',
      headers: { authorization: 'Bearer guest-token' },
      body: { queueEntryId: 'entry_1', items: [{ menuItemId: 'item_1', quantity: 2 }] },
    })).status).toBe(201);

    expect((await invokeApp(app, {
      method: 'GET',
      url: '/api/v1/orders/bill/entry_1',
      headers: { authorization: 'Bearer guest-token' },
    })).status).toBe(200);

    expect((await invokeApp(app, {
      method: 'POST',
      url: '/api/v1/orders/preorder',
      headers: { authorization: 'Bearer guest-token' },
      body: { queueEntryId: 'entry_2', items: [{ menuItemId: 'item_1', quantity: 1 }] },
    })).status).toBe(403);
  });

  it('covers deposit/final payment flows, offline settlement, refunds, and webhook capture', async () => {
    paymentServiceMock.initiateDeposit.mockResolvedValue({ paymentId: 'payment_1' });
    paymentServiceMock.captureDeposit.mockResolvedValue({ status: 'captured' });
    paymentServiceMock.initiateFinalPayment.mockResolvedValue({ paymentId: 'payment_2' });
    paymentServiceMock.captureFinalPayment.mockResolvedValue({ status: 'captured' });
    paymentServiceMock.capturePaymentFromWebhook.mockResolvedValue(undefined);
    paymentServiceMock.settleFinalOffline.mockResolvedValue({ status: 'captured', mode: 'offline' });
    paymentServiceMock.refundDeposit.mockResolvedValue({ refundId: 'refund_1' });

    const app = (await import('../../src/app')).default;

    expect((await invokeApp(app, {
      method: 'POST',
      url: '/api/v1/payments/deposit/initiate',
      headers: { authorization: 'Bearer guest-token' },
      body: { venueId: 'venue_1', queueEntryId: 'entry_1', orderId: 'order_1' },
    })).status).toBe(200);

    expect((await invokeApp(app, {
      method: 'POST',
      url: '/api/v1/payments/deposit/capture',
      body: { razorpayOrderId: 'order_rzp_1', razorpayPaymentId: 'pay_1', razorpaySignature: 'sig' },
    })).status).toBe(200);

    expect((await invokeApp(app, {
      method: 'POST',
      url: '/api/v1/payments/final/initiate',
      headers: { authorization: 'Bearer guest-token' },
      body: { venueId: 'venue_1', queueEntryId: 'entry_1' },
    })).status).toBe(200);

    expect((await invokeApp(app, {
      method: 'POST',
      url: '/api/v1/payments/final/capture',
      body: { razorpayOrderId: 'order_rzp_2', razorpayPaymentId: 'pay_2', razorpaySignature: 'sig' },
    })).status).toBe(200);

    expect((await invokeApp(app, {
      method: 'POST',
      url: '/api/v1/payments/final/settle-offline',
      headers: { authorization: 'Bearer staff-token' },
      body: { queueEntryId: 'entry_1' },
    })).status).toBe(200);

    expect((await invokeApp(app, {
      method: 'POST',
      url: '/api/v1/payments/refund',
      headers: { authorization: 'Bearer staff-token' },
      body: { paymentId: 'payment_1' },
    })).status).toBe(200);

    expect((await invokeApp(app, {
      method: 'POST',
      url: '/api/v1/payments/webhook/razorpay',
      headers: { 'x-razorpay-signature': 'sig' },
      rawBody: JSON.stringify({
        event: 'payment.captured',
        payload: {
          payment: {
            entity: {
              order_id: 'order_rzp_2',
              id: 'pay_2',
            },
          },
        },
      }),
    })).status).toBe(200);
  });
});
