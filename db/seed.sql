-- Sample seed data for local development
--
-- Two demo sellers (wallets) so list/stats scoping is visible locally:
--   Seller A: GAYWLLX32JT5MOLN5TAF3OGFLJBNSTDVAOQONW7QVEUC352TCGRBJYHP
--   Seller B: GCBAENYI5GN7X7J5ANCI3TMRTAWCRYAVJN3Q5OPZMUXULO5SYIVJQ6AV
--
-- These are throwaway testnet addresses (public keys only, no secrets).
-- Replace them with your own Freighter address to see seeded invoices in the
-- dashboard while your wallet is connected.

-- Seller A: one pending, one paid, one expired (visible in history, never actionable)
INSERT INTO invoices (
  id,
  seller_public_key,
  seller_name,
  seller_email,
  amount,
  asset_code,
  asset_issuer,
  memo,
  description,
  customer_name,
  customer_email,
  status,
  payment_tx_hash,
  payer_public_key,
  payer_name,
  payer_email,
  created_at,
  paid_at,
  expires_at,
  metadata
)
VALUES
  (
    '660e8400-e29b-41d4-a716-446655440001',
    'GAYWLLX32JT5MOLN5TAF3OGFLJBNSTDVAOQONW7QVEUC352TCGRBJYHP',
    'Seller A',
    'seller.a@example.com',
    100.50,
    'XLM',
    NULL,
    'INV-DEMO-A001',
    'Landing page design',
    'Test Customer',
    'customer@example.com',
    'PENDING',
    NULL,
    NULL,
    NULL,
    NULL,
    NOW(),
    NULL,
    NOW() + INTERVAL '7 days',
    '{"source":"seed","demo":true}'::jsonb
  ),
  (
    '660e8400-e29b-41d4-a716-446655440002',
    'GAYWLLX32JT5MOLN5TAF3OGFLJBNSTDVAOQONW7QVEUC352TCGRBJYHP',
    'Seller A',
    'seller.a@example.com',
    250.00,
    'XLM',
    NULL,
    'INV-DEMO-A002',
    'Monthly retainer',
    'Another Customer',
    NULL,
    'PAID',
    '3389e9f0f1a60f1eb4b1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f7',
    'GCBAENYI5GN7X7J5ANCI3TMRTAWCRYAVJN3Q5OPZMUXULO5SYIVJQ6AV',
    'Payer B',
    'payer.b@example.com',
    NOW() - INTERVAL '2 days',
    NOW() - INTERVAL '1 day',
    NOW() + INTERVAL '5 days',
    '{"source":"seed","demo":true}'::jsonb
  ),
  (
    '660e8400-e29b-41d4-a716-446655440003',
    'GAYWLLX32JT5MOLN5TAF3OGFLJBNSTDVAOQONW7QVEUC352TCGRBJYHP',
    'Seller A',
    'seller.a@example.com',
    75.25,
    'USDC',
    'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
    'INV-DEMO-A003',
    'Consulting hours',
    'USDC Customer',
    NULL,
    'EXPIRED',
    NULL,
    NULL,
    NULL,
    NULL,
    NOW() - INTERVAL '8 days',
    NULL,
    NOW() - INTERVAL '1 day',
    '{"source":"seed","demo":true,"assetIssuer":"GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"}'::jsonb
  ),
  -- Seller B: one paid invoice, must never show up for Seller A
  (
    '770e8400-e29b-41d4-a716-446655440001',
    'GCBAENYI5GN7X7J5ANCI3TMRTAWCRYAVJN3Q5OPZMUXULO5SYIVJQ6AV',
    'Seller B',
    'seller.b@example.com',
    500.00,
    'XLM',
    NULL,
    'INV-DEMO-B001',
    'Mobile app build',
    'Client of Seller B',
    NULL,
    'PAID',
    '9a8b7c6d5e4f30291a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f7081',
    'GAYWLLX32JT5MOLN5TAF3OGFLJBNSTDVAOQONW7QVEUC352TCGRBJYHP',
    'Payer A',
    'payer.a@example.com',
    NOW() - INTERVAL '4 days',
    NOW() - INTERVAL '3 days',
    NOW() + INTERVAL '3 days',
    '{"source":"seed","demo":true}'::jsonb
  )
ON CONFLICT DO NOTHING;
