'use client';

import { decodeCart } from '@mya/shared';
import { Lock, ShoppingBag } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { use, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Card, ErrorNotice, Field, Input, Notice, Select, Skeleton } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { formatMoney, loadRazorpay, loadStripe, orderToken, shop, type Address, type ShopInfo, type ShopOrder, type ShopQuote } from '@/lib/shop';

type Cart = NonNullable<ReturnType<typeof decodeCart>>;

const COUNTRIES = [['IN', 'India'], ['US', 'United States'], ['GB', 'United Kingdom'], ['AE', 'United Arab Emirates'], ['SG', 'Singapore'], ['AU', 'Australia'], ['CA', 'Canada'], ['DE', 'Germany'], ['FR', 'France'], ['NP', 'Nepal'], ['BD', 'Bangladesh'], ['LK', 'Sri Lanka']] as const;

declare global {
  interface Window {
    Stripe?: (key: string) => { elements: (o: { clientSecret: string }) => { create: (t: 'payment') => { mount: (el: HTMLElement) => void } }; confirmPayment: (o: { elements: unknown; confirmParams: { return_url: string } }) => Promise<{ error?: { message?: string } }> };
  }
}

/**
 * Platform-hosted checkout for generated online stores. Prices, stock and totals always come from the server; payment
 * runs in the store owner's Razorpay or Stripe account; the order becomes paid only after the provider confirms it.
 */
export default function ShopCheckout({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const router = useRouter();
  const [cart, setCart] = useState<Cart | null | undefined>(undefined);
  const [info, setInfo] = useState<ShopInfo | null>(null);
  const [quote, setQuote] = useState<ShopQuote | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [shippingId, setShippingId] = useState<string>('');
  const [email, setEmail] = useState('');
  const [addr, setAddr] = useState<Address>({ name: '', line1: '', line2: '', city: '', state: '', postalCode: '', country: 'IN', phone: '' });
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const [stripeReady, setStripeReady] = useState<null | { confirm: () => Promise<void> }>(null);
  const stripeBox = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const c = decodeCart(new URLSearchParams(window.location.hash.slice(1)).get('c') ?? '');
    setCart(c);
    if (c?.discountCode) setCode(c.discountCode);
    if (c?.shippingId) setShippingId(c.shippingId);
    shop.info(slug).then((i) => { setInfo(i); setShippingId((s) => s || i.shipping[0]?.id || ''); }).catch(setLoadError);
  }, [slug]);

  const body = useMemo(() => (cart ? { items: cart.items, ...(code.trim() ? { discountCode: code.trim() } : {}), ...(shippingId ? { shippingId } : {}) } : null), [cart, code, shippingId]);

  const refreshQuote = async (b = body) => {
    if (!b) return;
    setQuoteError(null);
    try { setQuote(await shop.quote(slug, b)); } catch (e) { setQuoteError(e instanceof ApiError ? e.message : 'Could not price your cart.'); }
  };
  // Re-price whenever the cart or shipping choice changes (the discount code applies on "Apply").
  useEffect(() => { if (info && cart) void refreshQuote({ items: cart.items, ...(shippingId ? { shippingId } : {}), ...(cart.discountCode ? { discountCode: cart.discountCode } : {}) }); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [info, cart, shippingId]);

  // One token per cart: retrying after an error returns the same order instead of creating a second one.
  const checkoutToken = () => {
    const tokenKey = `checkout:${slug}:${window.location.hash}`;
    try {
      let t = sessionStorage.getItem(tokenKey);
      if (!t) { t = crypto.randomUUID() + crypto.randomUUID(); sessionStorage.setItem(tokenKey, t); }
      return t;
    } catch { return crypto.randomUUID() + crypto.randomUUID(); }
  };

  const goToOrder = (o: ShopOrder) => {
    if (o.accessToken) orderToken.save(o.id, o.accessToken);
    router.push(`/shop/${encodeURIComponent(slug)}/order/${o.id}`);
  };

  const pay = async () => {
    if (!body || !info) return;
    setPaying(true); setPayError(null);
    try {
      const shippingAddress = quote?.needsShipping ? { ...addr, line2: addr.line2 || undefined, state: addr.state || undefined, phone: addr.phone || undefined } : undefined;
      const o = await shop.checkout(slug, { ...body, checkoutToken: checkoutToken(), email: email.trim(), ...(addr.name ? { name: addr.name } : {}), ...(shippingAddress ? { shippingAddress } : {}) });
      if (o.status === 'paid' || o.totalMinor === 0) return goToOrder(o);
      const p = o.payment ?? {};
      if (p.provider === 'razorpay') {
        await loadRazorpay();
        const Rzp = (window as unknown as { Razorpay: new (opts: Record<string, unknown>) => { open: () => void } }).Razorpay;
        new Rzp({
          key: p.keyId, order_id: p.razorpayOrderId, amount: p.amount, currency: p.currency, name: info.name,
          description: `Order #${o.number}`, prefill: { email: o.email, ...(addr.phone ? { contact: addr.phone } : {}) },
          handler: async (r: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) => {
            try { goToOrder(await shop.confirmRazorpay(slug, o.id, { accessToken: o.accessToken!, razorpayOrderId: r.razorpay_order_id, razorpayPaymentId: r.razorpay_payment_id, razorpaySignature: r.razorpay_signature })); }
            catch { goToOrder(o); } // the order page keeps checking until the provider's confirmation arrives
          },
          modal: { ondismiss: () => setPaying(false) },
        }).open();
        return;
      }
      if (p.provider === 'stripe' && typeof p.publishableKey === 'string' && typeof p.clientSecret === 'string') {
        await loadStripe();
        const stripe = window.Stripe!(p.publishableKey);
        const elements = stripe.elements({ clientSecret: p.clientSecret });
        if (o.accessToken) orderToken.save(o.id, o.accessToken);
        setStripeReady({ confirm: async () => {
          const r = await stripe.confirmPayment({ elements, confirmParams: { return_url: `${window.location.origin}/shop/${encodeURIComponent(slug)}/order/${o.id}` } });
          if (r.error) setPayError(r.error.message ?? 'Payment failed. Please try again.');
        } });
        requestAnimationFrame(() => { if (stripeBox.current) elements.create('payment').mount(stripeBox.current); });
        setPaying(false);
        return;
      }
      setPayError('This store has not finished setting up payments. Please try again later.');
      setPaying(false);
    } catch (e) {
      setPayError(e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Payment could not start. Please try again.');
      setPaying(false);
    }
  };

  const currency = quote?.currency ?? info?.currency ?? 'INR';
  const m = (n: number) => formatMoney(n, currency);
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
  const addrOk = !quote?.needsShipping || (addr.name.trim() && addr.line1.trim() && addr.city.trim() && addr.postalCode.trim().length >= 2);
  const canPay = !!quote && !quoteError && emailOk && addrOk && quote.lines.every((l) => l.available) && !paying && !stripeReady;

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 lg:py-10">
      <header className="mb-6 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2"><ShoppingBag className="size-5 shrink-0" /><h1 className="truncate text-xl font-semibold tracking-[-0.02em]">{info?.name ?? 'Checkout'}</h1></div>
        <span className="flex items-center gap-1.5 text-xs text-muted"><Lock className="size-3.5" />Secure checkout</span>
      </header>

      {loadError ? (
        <Notice tone="warning">{loadError instanceof ApiError && loadError.status === 404 ? "This store isn't taking orders right now." : 'Could not load this store. Please try again.'}</Notice>
      ) : cart === null ? (
        <Notice tone="info">Your cart is empty. Go back to the store and add something first.</Notice>
      ) : !info || cart === undefined ? (
        <div className="grid gap-4 md:grid-cols-[1fr_380px]"><Skeleton className="h-80" /><Skeleton className="h-64" /></div>
      ) : (
        <div className="grid gap-6 md:grid-cols-[1fr_380px]">
          <div className="space-y-5">
            <Card className="space-y-4">
              <h2 className="text-base font-semibold">Contact</h2>
              <Field label="Email" hint="Your receipt and order updates go here."><Input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" /></Field>
            </Card>
            {quote?.needsShipping && (
              <Card className="space-y-4">
                <h2 className="text-base font-semibold">Delivery address</h2>
                <Field label="Full name"><Input autoComplete="name" value={addr.name} onChange={(e) => setAddr({ ...addr, name: e.target.value })} /></Field>
                <Field label="Address"><Input autoComplete="address-line1" value={addr.line1} onChange={(e) => setAddr({ ...addr, line1: e.target.value })} /></Field>
                <Field label="Apartment, landmark" hint="Optional"><Input autoComplete="address-line2" value={addr.line2} onChange={(e) => setAddr({ ...addr, line2: e.target.value })} /></Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="City"><Input autoComplete="address-level2" value={addr.city} onChange={(e) => setAddr({ ...addr, city: e.target.value })} /></Field>
                  <Field label="State" hint="Optional"><Input autoComplete="address-level1" value={addr.state} onChange={(e) => setAddr({ ...addr, state: e.target.value })} /></Field>
                  <Field label="PIN / postal code"><Input autoComplete="postal-code" value={addr.postalCode} onChange={(e) => setAddr({ ...addr, postalCode: e.target.value })} /></Field>
                  <Field label="Country"><Select autoComplete="country" value={addr.country} onChange={(e) => setAddr({ ...addr, country: e.target.value })}>{COUNTRIES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</Select></Field>
                </div>
                <Field label="Phone" hint="For delivery updates. Optional"><Input type="tel" autoComplete="tel" value={addr.phone} onChange={(e) => setAddr({ ...addr, phone: e.target.value })} /></Field>
                {info.shipping.length > 0 && (
                  <Field label="Delivery method"><Select value={shippingId} onChange={(e) => setShippingId(e.target.value)}>{info.shipping.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.rateMinor === 0 ? 'Free' : m(s.rateMinor)}{s.freeOverMinor ? ` (free over ${m(s.freeOverMinor)})` : ''}</option>)}</Select></Field>
                )}
              </Card>
            )}
            {stripeReady && (
              <Card className="space-y-4">
                <h2 className="text-base font-semibold">Payment</h2>
                <div ref={stripeBox} />
                <Button className="w-full" onClick={async () => { setPaying(true); await stripeReady.confirm(); setPaying(false); }} loading={paying}>Pay {quote ? m(quote.totalMinor) : ''}</Button>
              </Card>
            )}
          </div>

          <aside className="space-y-4">
            <Card className="space-y-4">
              <h2 className="text-base font-semibold">Your order</h2>
              {quoteError ? <Notice tone="warning">{quoteError}</Notice> : !quote ? <Skeleton className="h-24" /> : (
                <ul className="space-y-2 text-sm">
                  {quote.lines.map((l) => (
                    <li key={l.variantId} className="flex justify-between gap-3">
                      <span className="min-w-0"><span className="block truncate">{l.title}</span><span className="text-xs text-muted">Qty {l.quantity}{!l.available && <span className="text-danger"> · not enough stock</span>}</span></span>
                      <span className="shrink-0 tabular-nums">{m(l.unitPriceMinor * l.quantity)}</span>
                    </li>
                  ))}
                </ul>
              )}
              <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void refreshQuote(); }}>
                <Input aria-label="Discount code" placeholder="Discount code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={40} />
                <Button type="submit" variant="secondary" disabled={!code.trim() || !!stripeReady}>Apply</Button>
              </form>
              {quote && (
                <dl className="space-y-1.5 border-t border-border pt-3 text-sm">
                  <div className="flex justify-between"><dt className="text-muted">Subtotal</dt><dd className="tabular-nums">{m(quote.subtotalMinor)}</dd></div>
                  {quote.discountMinor > 0 && <div className="flex justify-between"><dt className="text-muted">Discount</dt><dd className="tabular-nums">−{m(quote.discountMinor)}</dd></div>}
                  {quote.needsShipping && <div className="flex justify-between"><dt className="text-muted">Delivery</dt><dd className="tabular-nums">{quote.shippingMinor === 0 ? 'Free' : m(quote.shippingMinor)}</dd></div>}
                  <div className="flex justify-between"><dt className="text-muted">Tax{info.pricesIncludeTax ? ' (included)' : ''}</dt><dd className="tabular-nums">{m(quote.taxMinor)}</dd></div>
                  <div className="flex justify-between border-t border-border pt-2 text-base font-semibold"><dt>Total</dt><dd className="tabular-nums">{m(quote.totalMinor)}</dd></div>
                </dl>
              )}
              {payError && <Notice tone="danger">{payError}</Notice>}
              {!stripeReady && <Button className="w-full" size="lg" disabled={!canPay} loading={paying} onClick={pay}><Lock className="size-4" />{quote ? `Pay ${m(quote.totalMinor)}` : 'Pay'}</Button>}
              <p className="text-xs text-subtle">Payments are processed by {info.paymentProvider === 'stripe' ? 'Stripe' : 'Razorpay'} for {info.name}. Your card details never reach this store.</p>
            </Card>
          </aside>
        </div>
      )}
      {loadError && !(loadError instanceof ApiError) ? <div className="mt-4"><ErrorNotice error={loadError} /></div> : null}
    </main>
  );
}
