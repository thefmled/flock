// @vitest-environment jsdom

import {
  clearGuestEntryId,
  clearGuestSession,
  clearStaffAuth,
  consumeFlash,
  getCart,
  getGuestEntryId,
  getGuestSession,
  getStaffAuth,
  getTableCart,
  normalisePhone,
  setCart,
  setFlash,
  setGuestEntryId,
  setGuestSession,
  setTableCart,
  updateCart,
  updateTableCart,
} from '../../web/modules/storage.js';

describe('frontend storage helpers', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('normalizes phone numbers to Indian 10-digit format', () => {
    expect(normalisePhone('+91 98765-43210')).toBe('9876543210');
  });

  it('persists guest entry and session state', () => {
    setGuestEntryId('venue-slug', 'entry_1');
    setGuestSession({ entryId: 'entry_1', guestToken: 'token_1' });

    expect(getGuestEntryId('venue-slug')).toBe('entry_1');
    expect(getGuestSession('entry_1')).toEqual({ entryId: 'entry_1', guestToken: 'token_1' });

    clearGuestEntryId('venue-slug');
    clearGuestSession('entry_1');

    expect(getGuestEntryId('venue-slug')).toBeNull();
    expect(getGuestSession('entry_1')).toBeNull();
  });

  it('persists flash messages once and consumes them exactly once', () => {
    setFlash('green', 'Saved');
    expect(consumeFlash()).toEqual({ kind: 'green', message: 'Saved' });
    expect(consumeFlash()).toBeNull();
  });

  it('updates preorder and table carts by delta', () => {
    updateCart('entry_1', 'item_1', 2);
    updateCart('entry_1', 'item_1', -1);
    setTableCart('entry_1', { item_2: 1 });
    updateTableCart('entry_1', 'item_2', 2);

    expect(getCart('entry_1')).toEqual({ item_1: 1 });
    expect(getTableCart('entry_1')).toEqual({ item_2: 3 });

    setCart('entry_2', { item_9: 4 });
    expect(getCart('entry_2')).toEqual({ item_9: 4 });
  });

  it('handles staff auth cleanup without throwing on invalid data', () => {
    localStorage.setItem('flock_staff_auth', '{"token":"abc"}');
    expect(getStaffAuth()).toEqual({ token: 'abc' });

    clearStaffAuth();
    expect(getStaffAuth()).toBeNull();

    localStorage.setItem('flock_staff_auth', '{bad json');
    expect(getStaffAuth()).toBeNull();
  });
});
