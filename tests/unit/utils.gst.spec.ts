import { aggregateGst, calcGstBreakdown, formatRupees } from '../../src/utils/gst';

describe('gst utils', () => {
  it('calculates line-item GST with paise precision', () => {
    expect(calcGstBreakdown(27_500, 2, 18)).toEqual({
      subtotal: 55_000,
      gstAmount: 9_900,
      totalIncGst: 64_900,
      cgst: 4_950,
      sgst: 4_950,
    });
  });

  it('aggregates mixed GST rates across items', () => {
    expect(aggregateGst([
      { priceExGst: 27_500, quantity: 1, gstPercent: 18 },
      { priceExGst: 9_000, quantity: 2, gstPercent: 5 },
    ])).toEqual({
      subtotalExGst: 45_500,
      cgstPercent: 9,
      sgstPercent: 9,
      cgstAmount: 2_925,
      sgstAmount: 2_925,
      totalIncGst: 51_350,
    });
  });

  it('formats paise into rupees for UI-facing output', () => {
    expect(formatRupees(12_345)).toBe('₹123.45');
    expect(formatRupees(0)).toBe('₹0.00');
  });
});
