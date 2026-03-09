export function computePartyPollBackoff(baseDelayMs, maxDelayMs, failureCount) {
  return Math.min(
    maxDelayMs,
    baseDelayMs * (2 ** Math.min(failureCount, 4)),
  );
}

export function computeScheduledPartyPollDelay(nextDelayMs, isHidden, jitterMs = 0) {
  const hiddenDelay = isHidden ? Math.max(nextDelayMs, 12000) : nextDelayMs;
  return hiddenDelay + Math.max(0, jitterMs);
}
