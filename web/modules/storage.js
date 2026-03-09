import {
  FLASH_KEY,
  GUEST_ENTRY_PREFIX,
  GUEST_SESSION_PREFIX,
  PREORDER_CART_PREFIX,
  STAFF_AUTH_KEY,
  TABLE_CART_PREFIX,
} from './constants.js';

export function normalisePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.slice(-10);
}

export function getGuestEntryId(slug, storage = localStorage) {
  return storage.getItem(`${GUEST_ENTRY_PREFIX}${slug}`);
}

export function setGuestEntryId(slug, entryId, storage = localStorage) {
  storage.setItem(`${GUEST_ENTRY_PREFIX}${slug}`, entryId);
}

export function clearGuestEntryId(slug, storage = localStorage) {
  storage.removeItem(`${GUEST_ENTRY_PREFIX}${slug}`);
}

export function getGuestSession(entryId, storage = localStorage) {
  try {
    return JSON.parse(storage.getItem(`${GUEST_SESSION_PREFIX}${entryId}`) || 'null');
  } catch (_error) {
    return null;
  }
}

export function setGuestSession(session, storage = localStorage) {
  storage.setItem(`${GUEST_SESSION_PREFIX}${session.entryId}`, JSON.stringify(session));
}

export function clearGuestSession(entryId, storage = localStorage) {
  storage.removeItem(`${GUEST_SESSION_PREFIX}${entryId}`);
}

export function getStaffAuth(storage = localStorage) {
  try {
    return JSON.parse(storage.getItem(STAFF_AUTH_KEY) || 'null');
  } catch (_error) {
    return null;
  }
}

export function clearStaffAuth(storage = localStorage) {
  storage.removeItem(STAFF_AUTH_KEY);
}

export function setFlash(kind, message, storage = sessionStorage) {
  storage.setItem(FLASH_KEY, JSON.stringify({ kind, message }));
}

export function consumeFlash(storage = sessionStorage) {
  const raw = storage.getItem(FLASH_KEY);
  if (!raw) return null;
  storage.removeItem(FLASH_KEY);
  try {
    return JSON.parse(raw);
  } catch (_error) {
    return null;
  }
}

export function getCart(entryId, storage = localStorage) {
  try {
    return JSON.parse(storage.getItem(`${PREORDER_CART_PREFIX}${entryId}`) || '{}');
  } catch (_error) {
    return {};
  }
}

export function setCart(entryId, cart, storage = localStorage) {
  storage.setItem(`${PREORDER_CART_PREFIX}${entryId}`, JSON.stringify(cart));
}

export function updateCart(entryId, menuItemId, delta, storage = localStorage) {
  const cart = getCart(entryId, storage);
  const current = cart[menuItemId] || 0;
  const next = Math.max(0, current + delta);
  if (next === 0) {
    delete cart[menuItemId];
  } else {
    cart[menuItemId] = next;
  }
  setCart(entryId, cart, storage);
}

export function getTableCart(entryId, storage = localStorage) {
  try {
    return JSON.parse(storage.getItem(`${TABLE_CART_PREFIX}${entryId}`) || '{}');
  } catch (_error) {
    return {};
  }
}

export function setTableCart(entryId, cart, storage = localStorage) {
  storage.setItem(`${TABLE_CART_PREFIX}${entryId}`, JSON.stringify(cart));
}

export function updateTableCart(entryId, menuItemId, delta, storage = localStorage) {
  const cart = getTableCart(entryId, storage);
  const current = cart[menuItemId] || 0;
  const next = Math.max(0, current + delta);
  if (next === 0) {
    delete cart[menuItemId];
  } else {
    cart[menuItemId] = next;
  }
  setTableCart(entryId, cart, storage);
}
