import { Request } from 'express';
import { Staff, Venue } from '@prisma/client';

export interface GuestAuthContext {
  queueEntryId: string;
  venueId: string;
  guestPhone: string;
  partySessionId?: string;
  participantId?: string;
}

export interface AuthenticatedRequest extends Request {
  staff?: Staff;
  venue?: Venue;
  guest?: GuestAuthContext;
}

export interface GstBreakdown {
  subtotalExGst: number;
  cgstPercent: number;
  sgstPercent: number;
  cgstAmount: number;
  sgstAmount: number;
  totalIncGst: number;
}

export interface QueuePositionInfo {
  position: number;
  estimatedWaitMin: number;
  aheadCount: number;
}

export interface PaymentInitiateResult {
  razorpayOrderId: string;
  amount: number;
  currency: string;
  txnRef: string;
  keyId: string;
}

export interface RazorpayWebhookPayload {
  entity: string;
  account_id: string;
  event: string;
  contains: string[];
  payload: {
    payment?: {
      entity: {
        id: string;
        order_id: string;
        amount: number;
        currency: string;
        status: string;
        method: string;
        vpa?: string;
        error_code?: string;
        error_description?: string;
      };
    };
    order?: {
      entity: {
        id: string;
        amount: number;
        status: string;
      };
    };
    refund?: {
      entity: {
        id: string;
        payment_id: string;
        amount: number;
        status: string;
      };
    };
  };
  created_at: number;
}

export interface PaginationQuery {
  page?: number;
  limit?: number;
}

export type ApiResponse<T = unknown> = {
  success: true;
  data: T;
  meta?: Record<string, unknown>;
} | {
  success: false;
  error: string;
  code?: string;
};
