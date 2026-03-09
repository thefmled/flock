import { calculateFees, verifyPaymentSignature, verifyWebhookSignature } from '../../src/integrations/razorpay';

describe('razorpay helpers', () => {
  it('calculates platform and gateway fees', () => {
    expect(calculateFees(10_000)).toEqual({
      platformFee: 200,
      razorpayFee: 200,
      netToVenue: 9_600,
    });
  });

  it('short-circuits signature verification in mock mode', () => {
    expect(verifyPaymentSignature({
      orderId: 'order_1',
      paymentId: 'payment_1',
      signature: 'bad',
    })).toBe(true);

    expect(verifyWebhookSignature('{}', 'bad')).toBe(true);
  });
});
