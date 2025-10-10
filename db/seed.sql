-- Sample seed data for testing
-- Replace with your actual Stellar test account

-- Insert sample user
INSERT INTO users (id, email, stellar_public_key, name, created_at)
VALUES 
  ('550e8400-e29b-41d4-a716-446655440000', 'demo@example.com', 'GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX', 'Demo User', NOW())
ON CONFLICT DO NOTHING;

-- Insert sample invoices
INSERT INTO invoices (
  id, 
  user_id, 
  seller_public_key, 
  amount, 
  asset_code, 
  memo, 
  description, 
  customer_name, 
  status, 
  created_at, 
  expires_at
)
VALUES 
  (
    '660e8400-e29b-41d4-a716-446655440001',
    '550e8400-e29b-41d4-a716-446655440000',
    'GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
    100.50,
    'XLM',
    'INV-DEMO-001',
    'Sample invoice for testing',
    'Test Customer',
    'PENDING',
    NOW(),
    NOW() + INTERVAL '7 days'
  ),
  (
    '660e8400-e29b-41d4-a716-446655440002',
    '550e8400-e29b-41d4-a716-446655440000',
    'GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
    250.00,
    'XLM',
    'INV-DEMO-002',
    'Another test invoice',
    'Another Customer',
    'PAID',
    NOW() - INTERVAL '2 days',
    NOW() + INTERVAL '5 days'
  )
ON CONFLICT DO NOTHING;

-- Note: Update the stellar_public_key with your actual test account public key

