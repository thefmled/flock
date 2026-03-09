// @vitest-environment jsdom

import {
  buildCartSummary,
  bucketItemsToCart,
  cartToBucketItems,
  menuItemTotal,
  normaliseDraftCart,
  serialiseDraftCart,
} from '../../web/modules/cart.js';

describe('frontend cart helpers', () => {
  it('computes menu totals including GST', () => {
    expect(menuItemTotal({ priceExGst: 27_500, gstPercent: 18 })).toBe(32_450);
  });

  it('builds a cart summary from venue categories', () => {
    const summary = buildCartSummary([
      {
        items: [
          { id: 'item_1', name: 'IPA', priceExGst: 27_500, gstPercent: 18 },
          { id: 'item_2', name: 'Nachos', priceExGst: 18_000, gstPercent: 5 },
        ],
      },
    ], {
      item_1: 2,
      item_2: 1,
      missing: 3,
    });

    expect(summary).toEqual({
      lines: [
        { id: 'item_1', name: 'IPA', quantity: 2, unitTotal: 32_450, total: 64_900 },
        { id: 'item_2', name: 'Nachos', quantity: 1, unitTotal: 18_900, total: 18_900 },
      ],
      total: 83_800,
    });
  });

  it('normalizes and serializes shared draft carts deterministically', () => {
    expect(normaliseDraftCart({
      item_2: 0,
      item_3: 101.2,
      item_1: 2.9,
    })).toEqual({
      item_1: 2,
      item_3: 99,
    });

    expect(serialiseDraftCart({ item_b: 2, item_a: 1 })).toBe('{"item_a":1,"item_b":2}');
  });

  it('translates between bucket items and local cart state', () => {
    expect(bucketItemsToCart([
      { menuItemId: 'item_1', quantity: 2 },
      { menuItemId: 'item_2', quantity: 0 },
    ])).toEqual({ item_1: 2 });

    expect(cartToBucketItems({ item_2: 3, item_1: 1 })).toEqual([
      { menuItemId: 'item_1', quantity: 1 },
      { menuItemId: 'item_2', quantity: 3 },
    ]);
  });
});
