// Paystack, kept to the four calls this app actually makes.
//
// Nothing here reads a key at module scope. The key is fetched per call
// so the app boots, builds and serves every non-billing page with no
// Paystack configuration at all, which is the state it is in right now.
// A missing key surfaces as a handled error on the one route that needs
// it, not as a crash on import.

const BASE = "https://api.paystack.co";

export class PaystackNotConfigured extends Error {
  constructor() {
    super("Paystack is not configured");
    this.name = "PaystackNotConfigured";
  }
}

function secret(): string {
  const k = process.env.PAYSTACK_SECRET_KEY;
  if (!k) throw new PaystackNotConfigured();
  return k;
}

/** True when billing can run. Routes check this before offering to charge. */
export function paystackReady(): boolean {
  return !!process.env.PAYSTACK_SECRET_KEY;
}

type PaystackResponse<T> = { status: boolean; message: string; data: T };

async function call<T>(
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<PaystackResponse<T>> {
  // Bounded. Paystack is generally quick, but a hung request here holds
  // a checkout open with a spinner, and the cron would stall on one bad
  // placement and never reach the rest.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20_000);
  try {
    const res = await fetch(BASE + path, {
      method: init?.method ?? "GET",
      headers: {
        Authorization: `Bearer ${secret()}`,
        "Content-Type": "application/json",
      },
      body: init?.body ? JSON.stringify(init.body) : undefined,
      signal: ctrl.signal,
      cache: "no-store",
    });
    const json = (await res.json()) as PaystackResponse<T>;
    if (!res.ok) {
      // Paystack puts the useful part in `message`. The status code on
      // its own tells an advertiser nothing.
      throw new Error(json?.message || `Paystack returned ${res.status}`);
    }
    return json;
  } finally {
    clearTimeout(timer);
  }
}

export interface InitResult {
  authorization_url: string;
  access_code: string;
  reference: string;
}

/** Start a checkout. Returns the URL to send the advertiser to. */
export function initializeTransaction(params: {
  email: string;
  amountKobo: number;
  reference: string;
  callbackUrl: string;
  metadata?: Record<string, unknown>;
}) {
  return call<InitResult>("/transaction/initialize", {
    method: "POST",
    body: {
      email: params.email,
      amount: params.amountKobo,
      reference: params.reference,
      callback_url: params.callbackUrl,
      currency: "NGN",
      // Card only. The whole model depends on getting a reusable
      // authorization back, and a bank transfer or USSD payment does
      // not produce one, so the renewal would silently never happen.
      channels: ["card"],
      metadata: params.metadata ?? {},
    },
  });
}

export interface Authorization {
  authorization_code: string;
  last4: string;
  brand: string;
  exp_month: string;
  exp_year: string;
  reusable: boolean;
}

export interface TransactionData {
  id: number;
  status: string;
  reference: string;
  amount: number;
  gateway_response?: string;
  paid_at?: string | null;
  customer?: { customer_code?: string; email?: string };
  authorization?: Authorization;
}

/**
 * Confirm a transaction with Paystack directly.
 *
 * Always called before anything is marked paid, even when a webhook
 * already said so. A webhook is a notification, not proof: this is the
 * only source of truth about whether money moved.
 */
export function verifyTransaction(reference: string) {
  return call<TransactionData>(`/transaction/verify/${encodeURIComponent(reference)}`);
}

/** Charge a card we already hold, for a renewal. No advertiser present. */
export function chargeAuthorization(params: {
  email: string;
  amountKobo: number;
  authorizationCode: string;
  reference: string;
  metadata?: Record<string, unknown>;
}) {
  return call<TransactionData>("/transaction/charge_authorization", {
    method: "POST",
    body: {
      email: params.email,
      amount: params.amountKobo,
      authorization_code: params.authorizationCode,
      reference: params.reference,
      currency: "NGN",
      metadata: params.metadata ?? {},
    },
  });
}

/** Refund, in full or in part. Amount omitted means the whole transaction. */
export function refundTransaction(params: {
  reference: string;
  amountKobo?: number;
  reason?: string;
}) {
  return call<{ id: number; status: string }>("/refund", {
    method: "POST",
    body: {
      transaction: params.reference,
      ...(params.amountKobo != null ? { amount: params.amountKobo } : {}),
      ...(params.reason ? { merchant_note: params.reason } : {}),
    },
  });
}

/**
 * Is this webhook really from Paystack?
 *
 * HMAC SHA512 of the raw body with the secret key. The raw body matters:
 * parsing and re-serialising the JSON changes the bytes and the digest
 * will not match. Compared in constant time, because a fast reject on
 * the first wrong byte leaks the expected digest one character at a
 * time to anyone willing to send enough requests.
 */
export async function verifyWebhookSignature(rawBody: string, signature: string | null): Promise<boolean> {
  if (!signature) return false;
  const { createHmac, timingSafeEqual } = await import("crypto");
  const expected = createHmac("sha512", secret()).update(rawBody).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Naira to kobo. One conversion point, so nothing rounds twice. */
export const toKobo = (naira: number) => Math.round(naira * 100);
export const toNaira = (kobo: number) => Math.round(kobo / 100);

/**
 * A reference we can trace back without a lookup.
 *
 * Prefixed by what it is for, so an unexplained entry on a Paystack
 * statement can be read by a human at a glance.
 */
export function makeReference(kind: string, placementId: string): string {
  const short = placementId.replace(/-/g, "").slice(0, 12);
  return `peja_${kind}_${short}_${Date.now().toString(36)}`;
}
