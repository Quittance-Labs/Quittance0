-- Sample seed data for local development
--
-- Two demo sellers (wallets) so list/stats scoping is visible locally:
--   Seller A: GAYWLLX32JT5MOLN5TAF3OGFLJBNSTDVAOQONW7QVEUC352TCGRBJYHP
--   Seller B: GCBAENYI5GN7X7J5ANCI3TMRTAWCRYAVJN3Q5OPZMUXULO5SYIVJQ6AV
--
-- These are throwaway testnet addresses (public keys only, no secrets).
-- Replace them with your own Freighter address to see seeded invoices in the
-- dashboard while your wallet is connected.

-- Seller A: two pending, one paid
INSERT INTO invoices (
  id,
  seller_public_key,
  seller_name,
  amount,
  asset_code,
  memo,
  description,
  customer_name,
  customer_email,
  status,
  payment_tx_hash,
  payer_public_key,
  created_at,
  paid_at,
  expires_at
)
VALUES
  (
    '660e8400-e29b-41d4-a716-446655440001',
    'GAYWLLX32JT5MOLN5TAF3OGFLJBNSTDVAOQONW7QVEUC352TCGRBJYHP',
    'Seller A',
    100.50,
    'XLM',
    'INV-DEMO-A001',
    'Landing page design',
    'Test Customer',
    'customer@example.com',
    'PENDING',
    NULL,
    NULL,
    NOW(),
    NULL,
    NOW() + INTERVAL '7 days'
  ),
  (
    '660e8400-e29b-41d4-a716-446655440002',
    'GAYWLLX32JT5MOLN5TAF3OGFLJBNSTDVAOQONW7QVEUC352TCGRBJYHP',
    'Seller A',
    250.00,
    'XLM',
    'INV-DEMO-A002',
    'Monthly retainer',
    'Another Customer',
    NULL,
    'PAID',
    '3389e9f0f1a60f1eb4b1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f7',
    'GCBAENYI5GN7X7J5ANCI3TMRTAWCRYAVJN3Q5OPZMUXULO5SYIVJQ6AV',
    NOW() - INTERVAL '2 days',
    NOW() - INTERVAL '1 day',
    NOW() + INTERVAL '5 days'
  ),
  (
    '660e8400-e29b-41d4-a716-446655440003',
    'GAYWLLX32JT5MOLN5TAF3OGFLJBNSTDVAOQONW7QVEUC352TCGRBJYHP',
    'Seller A',
    75.25,
    'USDC',
    'INV-DEMO-A003',
    'Consulting hours',
    'USDC Customer',
    NULL,
    'PENDING',
    NULL,
    NULL,
    NOW() - INTERVAL '3 hours',
    NULL,
    NOW() + INTERVAL '6 days'
  ),
  -- Seller B: one paid invoice, must never show up for Seller A
  (
    '770e8400-e29b-41d4-a716-446655440001',
    'GCBAENYI5GN7X7J5ANCI3TMRTAWCRYAVJN3Q5OPZMUXULO5SYIVJQ6AV',
    'Seller B',
    500.00,
    'XLM',
    'INV-DEMO-B001',
    'Mobile app build',
    'Client of Seller B',
    NULL,
    'PAID',
    '9a8b7c6d5e4f30291a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f7081',
    'GAYWLLX32JT5MOLN5TAF3OGFLJBNSTDVAOQONW7QVEUC352TCGRBJYHP',
    NOW() - INTERVAL '4 days',
    NOW() - INTERVAL '3 days',
    NOW() + INTERVAL '3 days'
  )
ON CONFLICT DO NOTHING;
