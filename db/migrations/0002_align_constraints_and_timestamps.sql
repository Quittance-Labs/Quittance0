-- Migration 0002: Align constraints, timestamps, and enforce PAID row invariant
--
-- 1. Deduplicate payment_tx_hash uniqueness indexes:
--    Keep uq_invoices_payment_tx_hash (referenced by InvoiceService.markAsPaid)
--    and drop invoices_payment_tx_hash_unique.
DROP INDEX IF EXISTS invoices_payment_tx_hash_unique;

-- Ensure uq_invoices_payment_tx_hash is present if it was somehow omitted
CREATE UNIQUE INDEX IF NOT EXISTS uq_invoices_payment_tx_hash
  ON invoices (payment_tx_hash)
  WHERE payment_tx_hash IS NOT NULL;

-- 2. Convert naive timestamps to TIMESTAMPTZ, treating stored values as UTC.
--    Default is updated to NOW() (evaluates to timestamptz).
ALTER TABLE payment_events
  ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN created_at SET DEFAULT NOW();

ALTER TABLE transactions
  ALTER COLUMN processed_at TYPE TIMESTAMPTZ USING processed_at AT TIME ZONE 'UTC',
  ALTER COLUMN processed_at SET DEFAULT NOW();

-- 3. Pre-check for PAID row invariant from docs/postgres-cutover-draft.sql.
--    Fail loudly if any existing row violates (status = 'PAID' requires payment_tx_hash and paid_at).
DO $$
DECLARE
  violating_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO violating_count
  FROM invoices
  WHERE status = 'PAID' AND (payment_tx_hash IS NULL OR paid_at IS NULL);

  IF violating_count > 0 THEN
    RAISE EXCEPTION
      'Cannot add invoices_paid_row_check: % row(s) violate invariant (status = PAID requires payment_tx_hash and paid_at)',
      violating_count;
  END IF;
END $$;

-- 4. Add PAID-row CHECK constraint to enforce that future PAID rows always have
--    both payment_tx_hash and paid_at set.
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_paid_row_check;
ALTER TABLE invoices ADD CONSTRAINT invoices_paid_row_check
  CHECK (
    (status = 'PAID' AND payment_tx_hash IS NOT NULL AND paid_at IS NOT NULL)
    OR status <> 'PAID'
  );
