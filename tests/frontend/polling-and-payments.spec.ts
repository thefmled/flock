// @vitest-environment jsdom

import { computePartyPollBackoff, computeScheduledPartyPollDelay } from '../../web/modules/polling.js';
import { ensureRazorpayLoaded, runHostedPayment } from '../../web/modules/payments.js';

describe('frontend polling and payment helpers', () => {
  it('backs off polling after repeated failures and stretches hidden-tab polling', () => {
    expect(computePartyPollBackoff(3000, 30000, 0)).toBe(3000);
    expect(computePartyPollBackoff(3000, 30000, 3)).toBe(24000);
    expect(computePartyPollBackoff(3000, 30000, 8)).toBe(30000);
    expect(computeScheduledPartyPollDelay(3000, true, 120)).toBe(12120);
  });

  it('loads Razorpay once and captures mock payments without opening checkout', async () => {
    const apiRequest = vi.fn()
      .mockResolvedValueOnce({
        keyId: 'mock_key',
        razorpayOrderId: 'order_mock_1',
        amount: 10_000,
        currency: 'INR',
      })
      .mockResolvedValueOnce({ success: true });

    await runHostedPayment({
      title: 'Deposit',
      initiatePath: '/payments/deposit/initiate',
      initiateBody: { orderId: 'order_1' },
      capturePath: '/payments/deposit/capture',
      prefill: { name: 'Neha', contact: '9876543210' },
      auth: 'guest',
      guestToken: 'token',
      apiRequest,
    });

    expect(apiRequest).toHaveBeenNthCalledWith(2, '/payments/deposit/capture', expect.objectContaining({
      method: 'POST',
      body: expect.objectContaining({
        razorpayOrderId: 'order_mock_1',
        razorpaySignature: 'mock_signature',
      }),
    }));
  });

  it('injects the Razorpay script once when checkout is not already present', async () => {
    const appendChild = vi.spyOn(document.head, 'appendChild').mockImplementation((node) => {
      setTimeout(() => {
        node.onload?.(new Event('load'));
      }, 0);
      return node;
    });

    await ensureRazorpayLoaded({ __flockRazorpayLoaderPromise: null }, document);

    expect(appendChild).toHaveBeenCalledTimes(1);
    appendChild.mockRestore();
  });
});
