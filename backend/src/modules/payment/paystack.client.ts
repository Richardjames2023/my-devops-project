import { AppError } from "../../common/errors/AppError";

const PAYSTACK_BASE_URL = "https://api.paystack.co";

interface PaystackApiResponse<T> {
  status: boolean;
  message: string;
  data: T;
  type?: string;
  code?: string;
  meta?: Record<string, unknown>;
}

class PaystackTransportError extends AppError {
  constructor(message: string) {
    super(message, 502);
    this.name = "PaystackTransportError";
  }
}

export class PaystackInitializationUncertainError extends AppError {
  constructor() {
    super(
      "Paystack initialization outcome is uncertain. Payment reconciliation is required.",
      503,
    );
    this.name = "PaystackInitializationUncertainError";
  }
}

export class PaystackApiError extends AppError {
  public readonly providerStatusCode: number;
  public readonly providerCode: string | undefined;
  public readonly providerType: string | undefined;
  public readonly providerMeta: Record<string, unknown> | undefined;

  constructor(input: {
    message: string;
    providerStatusCode: number;
    providerCode?: string;
    providerType?: string;
    providerMeta?: Record<string, unknown>;
  }) {
    super(input.message, 502);

    this.name = "PaystackApiError";
    this.providerStatusCode = input.providerStatusCode;
    this.providerCode = input.providerCode;
    this.providerType = input.providerType;
    this.providerMeta = input.providerMeta;
  }
}

export interface PaystackInitializeData {
  authorization_url: string;
  access_code: string;
  reference: string;
}

export interface PaystackVerifyData {
  id: number;
  status: string;
  reference: string;
  amount: number;
  currency: string;
  paid_at: string | null;
  gateway_response?: string;
}

export interface PaystackRefundData {
  id: number;
  status: string;
  amount: number;
  currency: string;
  transaction: {
    id: number;
    reference: string;
    currency: string;
  };
  expected_at?: string | null;
}

export interface PaystackRefundStatusData {
  id: number;
  status: string;
  amount: number;
  currency: string;
  transaction:
    | number
    | {
        id: number;
        reference?: string;
        currency?: string;
      };
  refunded_at?: string | null;
  expected_at?: string | null;
}

export interface PaystackRefundListItem {
  id: number;
  status: string;
  amount: number;
  currency: string;
  transaction:
    | number
    | {
        id: number;
        reference?: string;
        currency?: string;
      };
  merchant_note?: string | null;
  customer_note?: string | null;
  createdAt?: string;
  refunded_at?: string | null;
}

function getSecretKey(): string {
  const secretKey = process.env.PAYSTACK_SECRET_KEY;

  if (!secretKey) {
    throw new AppError("Paystack is not configured", 500);
  }

  return secretKey;
}

async function paystackRequest<T>(
  path: string,
  options: {
    method: "GET" | "POST";
    body?: Record<string, unknown>;
  },
): Promise<PaystackApiResponse<T>> {
  const secretKey = getSecretKey();
  let response: Response;

  try {
    response = await fetch(`${PAYSTACK_BASE_URL}${path}`, {
      method: options.method,
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/json",
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new PaystackTransportError(
      "Unable to confirm the Paystack request outcome.",
    );
  }
  let result: PaystackApiResponse<T>;

  try {
    result = (await response.json()) as PaystackApiResponse<T>;
  } catch {
    throw new PaystackTransportError(
      "Paystack returned an unreadable response.",
    );
  }

  if (!response.ok || !result.status) {
    throw new PaystackApiError({
      message: result.message || "Paystack request failed",
      providerStatusCode: response.status,
      ...(result.code ? { providerCode: result.code } : {}),
      ...(result.type ? { providerType: result.type } : {}),
      ...(result.meta ? { providerMeta: result.meta } : {}),
    });
  }

  return result;
}

export async function initializePaystackTransaction(input: {
  email: string;
  amountKobo: string;
  currency: string;
  reference: string;
  callbackUrl?: string;
}): Promise<PaystackInitializeData> {
  const body: Record<string, unknown> = {
    email: input.email,
    amount: input.amountKobo,
    currency: input.currency,
    reference: input.reference,
  };

  if (input.callbackUrl) {
    body.callback_url = input.callbackUrl;
  }

  try {
    const result = await paystackRequest<PaystackInitializeData>(
      "/transaction/initialize",
      {
        method: "POST",
        body,
      },
    );

    return result.data;
  } catch (error) {
    if (
      error instanceof PaystackTransportError ||
      (error instanceof PaystackApiError && error.providerStatusCode >= 500)
    ) {
      throw new PaystackInitializationUncertainError();
    }

    throw error;
  }
}

export async function verifyPaystackTransaction(
  reference: string,
): Promise<PaystackVerifyData> {
  const result = await paystackRequest<PaystackVerifyData>(
    `/transaction/verify/${encodeURIComponent(reference)}`,
    {
      method: "GET",
    },
  );

  return result.data;
}

export async function createPaystackRefund(input: {
  transactionReference: string;
  amountKobo: string;
  currency: string;
  customerNote?: string;
  merchantNote?: string;
}): Promise<PaystackRefundData> {
  const amount = Number(input.amountKobo);

  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new AppError("Invalid refund amount", 400);
  }

  const body: Record<string, unknown> = {
    transaction: input.transactionReference,
    amount,
    currency: input.currency,
  };

  if (input.customerNote) {
    body.customer_note = input.customerNote;
  }

  if (input.merchantNote) {
    body.merchant_note = input.merchantNote;
  }

  const result = await paystackRequest<PaystackRefundData>("/refund", {
    method: "POST",
    body,
  });

  return result.data;
}

export async function fetchPaystackRefund(
  refundId: string | number,
): Promise<PaystackRefundStatusData> {
  if (!/^\d+$/.test(String(refundId))) {
    throw new AppError("Invalid Paystack refund ID", 400);
  }

  const result = await paystackRequest<PaystackRefundStatusData>(
    `/refund/${encodeURIComponent(String(refundId))}`,
    {
      method: "GET",
    },
  );

  return result.data;
}

export async function listPaystackRefunds(input: {
  transactionReference: string;
  page?: number;
  perPage?: number;
}): Promise<PaystackRefundListItem[]> {
  const page = input.page ?? 1;
  const perPage = input.perPage ?? 100;

  if (
    !Number.isInteger(page) ||
    page < 1 ||
    !Number.isInteger(perPage) ||
    perPage < 1 ||
    perPage > 100
  ) {
    throw new AppError("Invalid refund pagination", 400);
  }

  const params = new URLSearchParams({
    reference: input.transactionReference,
    page: String(page),
    perPage: String(perPage),
  });

  const result = await paystackRequest<PaystackRefundListItem[]>(
    `/refund?${params.toString()}`,
    { method: "GET" },
  );

  return result.data;
}

export interface PaystackRefundRetryData {
  id: number;
  status: string;
  amount: number;
  currency: string;
  refunded_at?: string | null;
  expected_at?: string | null;
}

export async function retryPaystackRefund(input: {
  refundId: string | number;
  accountNumber: string;
  bankId: string;
  currency: string;
}): Promise<PaystackRefundRetryData> {
  if (!/^\d+$/.test(String(input.refundId))) {
    throw new AppError("Invalid Paystack refund ID", 400);
  }

  if (!/^\d{10}$/.test(input.accountNumber)) {
    throw new AppError("Invalid bank account number", 400);
  }

  if (!input.bankId.trim() || input.bankId.length > 64) {
    throw new AppError("Invalid bank ID", 400);
  }

  if (!/^[A-Z]{3}$/.test(input.currency)) {
    throw new AppError("Invalid refund currency", 400);
  }

  const result = await paystackRequest<PaystackRefundRetryData>(
    `/refund/retry_with_customer_details/${encodeURIComponent(
      String(input.refundId),
    )}`,
    {
      method: "POST",
      body: {
        refund_account_details: {
          currency: input.currency,
          account_number: input.accountNumber,
          bank_id: input.bankId,
        },
      },
    },
  );

  return result.data;
}
