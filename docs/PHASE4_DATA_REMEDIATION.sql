-- Phase 4 remediation runbook
-- Purpose:
--   1. Keep only the latest non-cancelled PRE_ORDER per queue entry
--   2. Mark older duplicate PRE_ORDER rows as CANCELLED
--   3. Mark stale PENDING / PROCESSING deposit payments on those duplicates as FAILED
--
-- Known affected queue entry from hosted testing:
--   1f2c4ae7-19d0-431d-adc8-7c159c3a9d95
--
-- Safe usage:
--   - Run inside a transaction
--   - Review the preview SELECT before executing the UPDATEs
--   - This intentionally does NOT mutate already CAPTURED payments automatically

BEGIN;

WITH ranked_preorders AS (
  SELECT
    o.id,
    o."queueEntryId",
    o."createdAt",
    ROW_NUMBER() OVER (
      PARTITION BY o."queueEntryId"
      ORDER BY o."createdAt" DESC, o.id DESC
    ) AS row_num
  FROM "Order" o
  WHERE o.type = 'PRE_ORDER'
    AND o.status <> 'CANCELLED'
),
duplicates AS (
  SELECT id
  FROM ranked_preorders
  WHERE row_num > 1
)
SELECT
  o.id,
  o."queueEntryId",
  o.status,
  o."createdAt",
  p.id AS payment_id,
  p.status AS payment_status,
  p."failureReason"
FROM "Order" o
LEFT JOIN "Payment" p ON p."orderId" = o.id AND p.type = 'DEPOSIT'
WHERE o.id IN (SELECT id FROM duplicates)
ORDER BY o."queueEntryId", o."createdAt" DESC;

WITH ranked_preorders AS (
  SELECT
    o.id,
    ROW_NUMBER() OVER (
      PARTITION BY o."queueEntryId"
      ORDER BY o."createdAt" DESC, o.id DESC
    ) AS row_num
  FROM "Order" o
  WHERE o.type = 'PRE_ORDER'
    AND o.status <> 'CANCELLED'
),
duplicates AS (
  SELECT id
  FROM ranked_preorders
  WHERE row_num > 1
)
UPDATE "Payment"
SET
  status = 'FAILED',
  "failureReason" = 'Superseded cleanup'
WHERE "orderId" IN (SELECT id FROM duplicates)
  AND type = 'DEPOSIT'
  AND status IN ('PENDING', 'PROCESSING');

WITH ranked_preorders AS (
  SELECT
    o.id,
    ROW_NUMBER() OVER (
      PARTITION BY o."queueEntryId"
      ORDER BY o."createdAt" DESC, o.id DESC
    ) AS row_num
  FROM "Order" o
  WHERE o.type = 'PRE_ORDER'
    AND o.status <> 'CANCELLED'
)
UPDATE "Order"
SET status = 'CANCELLED'
WHERE id IN (
  SELECT id
  FROM ranked_preorders
  WHERE row_num > 1
);

COMMIT;
