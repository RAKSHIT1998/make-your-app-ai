import type { CheckoutParams } from './api';

declare global {
  interface Window {
    Razorpay?: new (opts: Record<string, unknown>) => { open: () => void; on: (e: string, cb: (r: unknown) => void) => void };
  }
}

function loadRazorpay(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Could not load Razorpay Checkout. Check your connection and try again.'));
    document.body.appendChild(s);
  });
}

/**
 * Opens the provider's hosted payment UI. Completing it does NOT grant anything by itself —
 * the server activates the plan or credits only after the provider's signed webhook arrives.
 */
export async function openCheckout(p: CheckoutParams, onDismiss: () => void) {
  if (p.provider === 'stripe' && p.checkoutUrl) {
    window.location.assign(p.checkoutUrl);
    return;
  }
  await loadRazorpay();
  const rzp = new window.Razorpay!({
    key: p.keyId,
    ...(p.subscriptionId ? { subscription_id: p.subscriptionId } : { order_id: p.orderId, amount: p.amount, currency: p.currency }),
    name: 'Make Your App AI',
    description: p.description ?? 'Subscription',
    prefill: { email: p.email },
    theme: { color: '#5B4CF5' },
    modal: { ondismiss: onDismiss },
  });
  rzp.open();
}
