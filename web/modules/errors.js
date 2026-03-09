import { escapeHtml } from './format.js';

export function extractErrorText(rawError, depth = 0) {
  if (!rawError || depth > 3) {
    return '';
  }

  if (typeof rawError === 'string') {
    return rawError.trim();
  }

  if (rawError instanceof Error) {
    return rawError.message.trim();
  }

  if (Array.isArray(rawError)) {
    for (const item of rawError) {
      const nested = extractErrorText(item, depth + 1);
      if (nested) return nested;
    }
    return '';
  }

  if (typeof rawError === 'object') {
    if (Array.isArray(rawError.details)) {
      const nested = extractErrorText(rawError.details, depth + 1);
      if (nested) return nested;
    }

    for (const key of ['message', 'error', 'detail']) {
      if (key in rawError) {
        const nested = extractErrorText(rawError[key], depth + 1);
        if (nested) return nested;
      }
    }
  }

  return '';
}

export function normaliseApiError(rawError, status) {
  const fallback = status >= 500
    ? 'The service is temporarily unavailable. Please retry in a few seconds.'
    : `Request failed (${status})`;

  if (!rawError) {
    return fallback;
  }

  const errorText = typeof rawError === 'string'
    ? rawError.trim()
    : String(rawError).trim();
  const looksLikeHtml = errorText.startsWith('<!DOCTYPE') || errorText.startsWith('<html');

  if (looksLikeHtml) {
    if (status === 502 || status === 503 || status === 504) {
      return 'The hosted app is waking up or temporarily unavailable. Please retry in a few seconds.';
    }
    return fallback;
  }

  const extractedMessage = extractErrorText(rawError);
  if (extractedMessage) {
    return extractedMessage;
  }

  if (status === 502 || status === 503 || status === 504) {
    return 'The hosted app is temporarily unavailable. Please retry in a few seconds.';
  }

  return errorText;
}

export function describeClientError(error) {
  if (error instanceof Error) {
    return normaliseApiError(error.message, 500);
  }

  if (typeof error === 'string') {
    return normaliseApiError(error, 500);
  }

  if (error && typeof error === 'object') {
    return normaliseApiError(error, 500);
  }

  return 'Something broke';
}

export function isAuthErrorMessage(message) {
  return /Unauthorized|expired|invalid token|session invalid/i.test(String(message || ''));
}

export function isTransientServiceErrorMessage(message) {
  return /too many|temporarily unavailable|waking up|retry|429|502|503|504/i.test(String(message || ''));
}

export function renderDependencyWarnings(messages) {
  if (!messages.length) return '';
  return `
    <div class="alert alert-amber" data-transient-error="true">
      <div>Some live data is temporarily unavailable:</div>
      <div>${escapeHtml(messages.join(' • '))}</div>
    </div>
  `;
}
