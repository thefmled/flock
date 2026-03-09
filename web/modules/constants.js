export const API_BASE = '/api/v1';
export const DEFAULT_VENUE_SLUG = 'the-barrel-room-koramangala';
export const STAFF_AUTH_KEY = 'flock_staff_auth';
export const STAFF_PENDING_PHONE_KEY = 'flock_staff_pending_phone';
export const ADMIN_PENDING_PHONE_KEY = 'flock_admin_pending_phone';
export const GUEST_SESSION_PREFIX = 'flock_guest_session:';
export const GUEST_ENTRY_PREFIX = 'flock_guest_entry:';
export const PREORDER_CART_PREFIX = 'flock_cart:';
export const TABLE_CART_PREFIX = 'flock_table_cart:';
export const FLASH_KEY = 'flock_flash';

export const EMPTY_VENUE_STATS = {
  today: {
    totalQueueJoins: 0,
    avgWaitMin: 0,
    totalPayments: 0,
    totalRevenuePaise: 0,
    platformFeePaise: 0,
  },
  tables: {},
};

export function createDefaultPartyPollState() {
  return {
    baseDelayMs: 3000,
    maxDelayMs: 30000,
    nextDelayMs: 3000,
    failureCount: 0,
    lastError: '',
  };
}
