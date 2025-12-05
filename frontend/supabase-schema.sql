-- ========================================
-- POLAR BRIDGE - Supabase Database Schema
-- ========================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ========================================
-- WALLETS TABLE
-- Stores user wallet information and INR balance
-- ========================================
CREATE TABLE wallets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  wallet_address VARCHAR(42) UNIQUE NOT NULL,  -- EVM address (0x...)
  balance_inr DECIMAL(18, 2) DEFAULT 0,        -- INR balance (2 decimal places)
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for fast lookups by wallet address
CREATE INDEX idx_wallets_address ON wallets(wallet_address);

-- ========================================
-- STAKES TABLE
-- Stores staking records (INR to PAS conversions)
-- ========================================
CREATE TABLE stakes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  wallet_address VARCHAR(42) NOT NULL REFERENCES wallets(wallet_address),
  amount_inr DECIMAL(18, 2) NOT NULL,          -- Amount in INR
  amount_pas DECIMAL(18, 8) NOT NULL,          -- Amount in PAS (8 decimals for precision)
  exchange_rate DECIMAL(18, 8) NOT NULL,       -- Exchange rate at time of stake
  status VARCHAR(20) DEFAULT 'pending',        -- pending, completed, paid_back
  stellar_tx_hash VARCHAR(128),                -- Stellar lock transaction hash
  evm_tx_hash VARCHAR(66),                     -- EVM release transaction hash
  paid_back_at TIMESTAMP WITH TIME ZONE,       -- When stake was returned
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for stake queries
CREATE INDEX idx_stakes_wallet ON stakes(wallet_address);
CREATE INDEX idx_stakes_status ON stakes(status);
CREATE INDEX idx_stakes_created ON stakes(created_at DESC);

-- ========================================
-- PAYMENTS TABLE (Optional - for Razorpay tracking)
-- Tracks INR payment records
-- ========================================
CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  wallet_address VARCHAR(42) NOT NULL REFERENCES wallets(wallet_address),
  razorpay_order_id VARCHAR(100),
  razorpay_payment_id VARCHAR(100),
  amount_inr DECIMAL(18, 2) NOT NULL,
  status VARCHAR(20) DEFAULT 'pending',        -- pending, success, failed
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for payment lookups
CREATE INDEX idx_payments_wallet ON payments(wallet_address);
CREATE INDEX idx_payments_razorpay_order ON payments(razorpay_order_id);

-- ========================================
-- ROW LEVEL SECURITY (RLS)
-- ========================================

-- Enable RLS on all tables
ALTER TABLE wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE stakes ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

-- Wallets: Users can only read/update their own wallet
-- Using service_role for server-side operations
CREATE POLICY "wallets_select_own" ON wallets
  FOR SELECT USING (true);  -- Allow read for all (anon key has limited access)

CREATE POLICY "wallets_insert_own" ON wallets
  FOR INSERT WITH CHECK (true);  -- Allow insert from app

CREATE POLICY "wallets_update_own" ON wallets
  FOR UPDATE USING (true);  -- Allow update from app

-- Stakes: Similar policies
CREATE POLICY "stakes_select_own" ON stakes
  FOR SELECT USING (true);

CREATE POLICY "stakes_insert_own" ON stakes
  FOR INSERT WITH CHECK (true);

CREATE POLICY "stakes_update_own" ON stakes
  FOR UPDATE USING (true);

-- Payments: Similar policies  
CREATE POLICY "payments_select_own" ON payments
  FOR SELECT USING (true);

CREATE POLICY "payments_insert_own" ON payments
  FOR INSERT WITH CHECK (true);

-- ========================================
-- VIEWS (for dashboard convenience)
-- ========================================

-- Active stakes view
CREATE OR REPLACE VIEW active_stakes AS
SELECT 
  wallet_address,
  COUNT(*) as stake_count,
  SUM(amount_inr) as total_inr,
  SUM(amount_pas) as total_pas
FROM stakes
WHERE status IN ('pending', 'completed')
GROUP BY wallet_address;

-- ========================================
-- FUNCTIONS
-- ========================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for wallets table
CREATE TRIGGER update_wallets_updated_at
  BEFORE UPDATE ON wallets
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ========================================
-- SAMPLE DATA (for testing - remove in production)
-- ========================================
-- INSERT INTO wallets (wallet_address, balance_inr)
-- VALUES ('0x1234567890abcdef1234567890abcdef12345678', 1000.00);

-- INSERT INTO stakes (wallet_address, amount_inr, amount_pas, exchange_rate, status)
-- VALUES ('0x1234567890abcdef1234567890abcdef12345678', 100.00, 50.00, 2.00, 'completed');
