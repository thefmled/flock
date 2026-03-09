// @vitest-environment jsdom

import { describeClientError, normaliseApiError, renderDependencyWarnings } from '../../web/modules/errors.js';
import { escapeHtml, formatMoney, formatRelativeStamp, renderStatusBadge } from '../../web/modules/format.js';

describe('frontend error and formatting helpers', () => {
  it('normalizes API errors from nested payloads and HTML responses', () => {
    expect(normaliseApiError({ details: [{ message: 'Bad OTP' }] }, 400)).toBe('Bad OTP');
    expect(normaliseApiError('<!DOCTYPE html><html></html>', 502)).toBe('The hosted app is waking up or temporarily unavailable. Please retry in a few seconds.');
    expect(describeClientError(new Error('Too many requests'))).toBe('Too many requests');
  });

  it('escapes HTML and formats money/status/relative time', () => {
    expect(escapeHtml('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(formatMoney(12_345)).toBe('₹123.45');
    expect(renderStatusBadge('SEATED')).toContain('badge-seated');
    expect(formatRelativeStamp(Date.now() - 65_000, Date.now())).toBe('1m ago');
  });

  it('renders dependency warnings for soft-fail dashboard states', () => {
    expect(renderDependencyWarnings(['Venue details', 'Tables'])).toContain('Venue details');
    expect(renderDependencyWarnings([])).toBe('');
  });
});
