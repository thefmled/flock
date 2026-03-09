export async function ensureRazorpayLoaded(windowObject = window, documentObject = document) {
  if (windowObject.Razorpay) {
    return;
  }

  if (!windowObject.__flockRazorpayLoaderPromise) {
    windowObject.__flockRazorpayLoaderPromise = new Promise((resolve, reject) => {
      const script = documentObject.createElement('script');
      script.src = 'https://checkout.razorpay.com/v1/checkout.js';
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => {
        windowObject.__flockRazorpayLoaderPromise = null;
        reject(new Error('Razorpay checkout failed to load. Please refresh and retry.'));
      };
      documentObject.head.appendChild(script);
    });
  }

  await windowObject.__flockRazorpayLoaderPromise;
}

export async function runHostedPayment({
  title,
  initiatePath,
  initiateBody,
  capturePath,
  prefill,
  auth,
  guestToken,
  apiRequest,
  windowObject = window,
  documentObject = document,
}) {
  const initiation = await apiRequest(initiatePath, {
    method: 'POST',
    body: initiateBody,
    auth,
    guestToken,
  });

  if (initiation.keyId === 'mock_key') {
    await apiRequest(capturePath, {
      method: 'POST',
      body: {
        razorpayOrderId: initiation.razorpayOrderId,
        razorpayPaymentId: `pay_mock_${Date.now()}`,
        razorpaySignature: 'mock_signature',
      },
    });
    return initiation;
  }

  await ensureRazorpayLoaded(windowObject, documentObject);

  if (!windowObject.Razorpay) {
    throw new Error('Razorpay checkout failed to load. Please refresh and retry.');
  }

  await new Promise((resolve, reject) => {
    const razorpay = new windowObject.Razorpay({
      key: initiation.keyId,
      amount: initiation.amount,
      currency: initiation.currency,
      name: 'Flock',
      description: title,
      order_id: initiation.razorpayOrderId,
      prefill: {
        name: prefill?.name || '',
        contact: prefill?.contact || '',
      },
      theme: { color: '#e8a830' },
      handler: async (response) => {
        try {
          await apiRequest(capturePath, {
            method: 'POST',
            body: {
              razorpayOrderId: response.razorpay_order_id || initiation.razorpayOrderId,
              razorpayPaymentId: response.razorpay_payment_id,
              razorpaySignature: response.razorpay_signature,
            },
          });
          resolve(response);
        } catch (error) {
          reject(error);
        }
      },
      modal: {
        ondismiss: () => reject(new Error('Payment cancelled before completion.')),
      },
    });
    razorpay.open();
  });

  return initiation;
}
