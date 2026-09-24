-- Quittance Database Schema
-- PostgreSQL Database
--
-- Identity is the connected Freighter wallet: every invoice is keyed by
-- seller_public_key. There is no user/email login table.
--
-- Full parity column set (kept in sync with backend/types StoredInvoice via
-- db/migrate.ts + InvoiceService INSERT/SELECT column lists):
--   seller_name, seller_email
--   amount, asset_code, asset_issuer   (credit assets always require both)
--   memo, description
--   customer_name, customer_email
--   status, payment_tx_hash
--   payer_public_key, payer_name, payer_email, paid_at, cancelled_at
--   settled_at, settlement_context, prior_status, late_payment_warning_code
--   created_at, expires_at             (expires_at NOT NULL, default 7d)
--   metadata (JSONB)

-- Invoices Table
-- Issue #555: this schema is the durable half of the shared InvoiceStorage
-- contract. Columns and uniqueness rules (memo, payment_tx_hash, seller+
-- idempotency_key) must keep memory and Postgres behaviour interchangeable.
-- Do not add a second setup guide; cutover lives in docs/POSTGRES_CUTOVER.md.

CREATE TABLE IF NOT EXISTS invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_public_key VARCHAR(56) NOT NULL,
  seller_name VARCHAR(255),
  seller_email VARCHAR(255),
  amount DECIMAL(20, 7) NOT NULL,
  asset_code VARCHAR(12) DEFAULT 'XLM',
  asset_issuer VARCHAR(56),
  memo TEXT UNIQUE NOT NULL,
  description TEXT,
  customer_name VARCHAR(255),
  customer_email VARCHAR(255),
  status VARCHAR(20) DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PAID', 'EXPIRED', 'CANCELLED')),
  payment_tx_hash VARCHAR(64),
  payer_public_key VARCHAR(56),
  payer_name VARCHAR(255),
  payer_email VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  settled_at TIMESTAMPTZ,
  settlement_context VARCHAR(20) CHECK (settlement_context IN ('ON_TIME', 'AFTER_EXPIRY', 'AFTER_CANCEL')),
  prior_status VARCHAR(20) CHECK (prior_status IN ('PENDING', 'PAID', 'EXPIRED', 'CANCELLED')),
  late_payment_warning_code VARCHAR(50) CHECK (late_payment_warning_code IN ('PAYMENT_RECEIVED_AFTER_EXPIRY', 'PAYMENT_RECEIVED_AFTER_CANCEL')),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '7 days',
  metadata JSONB
);

-- One transaction settles at most one invoice (issue #501). The in-process
-- claim index covers the memory MVP; this partial unique index is the durable
-- form on Postgres, so a racing verify/monitor claim fails with 23505 instead
-- of double-settling.
CREATE UNIQUE INDEX IF NOT EXISTS uq_invoices_payment_tx_hash
  ON invoices (payment_tx_hash)
  WHERE payment_tx_hash IS NOT NULL;

-- Transactions Table
CREATE TABLE IF NOT EXISTS transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
  from_address VARCHAR(56) NOT NULL,
  to_address VARCHAR(56) NOT NULL,
  amount DECIMAL(20, 7) NOT NULL,
  asset_code VARCHAR(12) DEFAULT 'XLM',
  asset_issuer VARCHAR(56),
  tx_hash VARCHAR(64) UNIQUE NOT NULL,
  memo TEXT,
  ledger BIGINT,
  processed_at TIMESTAMP DEFAULT NOW(),
  metadata JSONB
);

-- Payment Events Log
CREATE TABLE IF NOT EXISTS payment_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID REFERENCES invoices(id),
  event_type VARCHAR(50) NOT NULL,
  event_data JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

-- The Horizon paging token is committed after each operation is handled. A
-- restart therefore resumes after the last completed operation; replay after
-- a crash is safe because invoice settlement and tx_hash are idempotent.
CREATE TABLE IF NOT EXISTS payment_monitor_checkpoints (
  account VARCHAR(56) NOT NULL,
  network VARCHAR(20) NOT NULL,
  cursor TEXT NOT NULL,
  ledger BIGINT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (account, network)
);

-- Wallet alignment: databases created before wallet-scoped sellers still have
-- the unused users table and invoices.user_id column. Both are dropped here so
-- re-running the migration converges on the wallet-only schema.
ALTER TABLE invoices DROP COLUMN IF EXISTS user_id;
DROP TABLE IF EXISTS users CASCADE;

-- Converge databases created before expiry became an enforced lifecycle.
UPDATE invoices
SET expires_at = COALESCE(created_at, NOW()) + INTERVAL '7 days'
WHERE expires_at IS NULL;
ALTER TABLE invoices ALTER COLUMN expires_at SET DEFAULT NOW() + INTERVAL '7 days';
ALTER TABLE invoices ALTER COLUMN expires_at SET NOT NULL;

-- Converge databases created before deterministic cancel/payment settlement.
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS settled_at TIMESTAMPTZ;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS settlement_context VARCHAR(20);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS prior_status VARCHAR(20);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS late_payment_warning_code VARCHAR(50);

ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_settlement_context_check;
ALTER TABLE invoices ADD CONSTRAINT invoices_settlement_context_check
  CHECK (settlement_context IS NULL OR settlement_context IN ('ON_TIME', 'AFTER_EXPIRY', 'AFTER_CANCEL'));

ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_prior_status_check;
ALTER TABLE invoices ADD CONSTRAINT invoices_prior_status_check
  CHECK (prior_status IS NULL OR prior_status IN ('PENDING', 'PAID', 'EXPIRED', 'CANCELLED'));

ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_late_payment_warning_code_check;
ALTER TABLE invoices ADD CONSTRAINT invoices_late_payment_warning_code_check
  CHECK (
    late_payment_warning_code IS NULL OR
    late_payment_warning_code IN ('PAYMENT_RECEIVED_AFTER_EXPIRY', 'PAYMENT_RECEIVED_AFTER_CANCEL')
  );

-- Unique constraint: one transaction hash may settle at most one invoice.
-- Added idempotently so re-running the migration on an upgraded database is safe.
-- The constraint is partial (WHERE payment_tx_hash IS NOT NULL) so unpaid rows
-- do not consume unique index space and NULL values never collide.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'invoices_payment_tx_hash_unique'
      AND conrelid = 'invoices'::regclass
  ) THEN
    -- Check for any existing duplicates before adding the constraint.
    -- A duplicate means a bug in prior code; surface it rather than silently skip.
    IF (
      SELECT COUNT(*) FROM (
        SELECT payment_tx_hash
        FROM invoices
        WHERE payment_tx_hash IS NOT NULL
        GROUP BY payment_tx_hash
        HAVING COUNT(*) > 1
      ) dupes
    ) > 0 THEN
      RAISE EXCEPTION
        'Cannot add payment_tx_hash uniqueness: duplicate hashes exist in invoices table. '
        'Resolve conflicts before re-running the migration.';
    END IF;

    CREATE UNIQUE INDEX invoices_payment_tx_hash_unique
      ON invoices(payment_tx_hash)
      WHERE payment_tx_hash IS NOT NULL;
  END IF;
END
$$;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_invoices_seller ON invoices(seller_public_key);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_asset_code ON invoices(asset_code);
CREATE INDEX IF NOT EXISTS idx_invoices_memo ON invoices(memo);
CREATE INDEX IF NOT EXISTS idx_invoices_created_at ON invoices(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_seller_created_at ON invoices(seller_public_key, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_pending_expiry ON invoices(expires_at) WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS idx_transactions_tx_hash ON transactions(tx_hash);
CREATE INDEX IF NOT EXISTS idx_transactions_invoice_id ON transactions(invoice_id);

-- Sample view for invoice statistics
CREATE OR REPLACE VIEW invoice_stats AS
SELECT
  seller_public_key,
  COUNT(*) as total_invoices,
  SUM(CASE WHEN status = 'PAID' THEN 1 ELSE 0 END) as paid_invoices,
  SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END) as pending_invoices,
  SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END) as actionable_invoices,
  SUM(CASE WHEN status = 'EXPIRED' THEN 1 ELSE 0 END) as expired_invoices,
  SUM(CASE WHEN status = 'PAID' THEN amount ELSE 0 END) as total_revenue,
  asset_code
FROM invoices
GROUP BY seller_public_key, asset_code;

-- Issue #514: replayed creates collapse onto the original row instead of
-- minting a second memo + pay link. The partial unique index keeps NULL
-- (legacy/keyless) rows untouched while giving the service an atomic
-- ON CONFLICT arbiter for (seller, key) races.
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(255);
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_seller_idempotency
  ON invoices (seller_public_key, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
