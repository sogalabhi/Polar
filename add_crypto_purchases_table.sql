-- ============================================
-- ADD crypto_purchases TABLE
-- Run this in your Supabase SQL Editor
-- ============================================

-- Crypto Purchases (INR → PAS)
-- Tracks each purchase - blockchain-first approach
CREATE TABLE IF NOT EXISTS crypto_purchases (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- User identification (wallet address, not UUID)
    user_id VARCHAR(42) NOT NULL,               -- User's EVM wallet address (lowercase)
    
    -- INR side
    from_amount DECIMAL(15, 2) NOT NULL,        -- INR spent
    
    -- Crypto side
    to_token TEXT NOT NULL DEFAULT 'PAS',       -- Token bought
    to_amount DECIMAL(18, 8) NOT NULL,          -- Amount of PAS
    exchange_rate DECIMAL(15, 6) NOT NULL,      -- Rate at time of purchase (1 PAS = X INR)
    
    -- User's destination
    destination_address VARCHAR(42) NOT NULL,   -- User's EVM address (MetaMask)
    
    -- Owner's collateral (XLM locked on Stellar)
    xlm_locked DECIMAL(18, 8),                  -- Amount of XLM locked by owner
    
    -- Slippage
    slippage_tolerance DECIMAL(5, 2) DEFAULT 1, -- 0-100%
    
    -- Status tracking
    status TEXT DEFAULT 'pending',              -- pending, locked, completed, failed
    -- pending: order created
    -- locked: XLM locked on Stellar, waiting for relayer
    -- completed: PAS sent to user
    -- failed: something went wrong
    
    -- Transaction hashes
    stellar_tx_hash VARCHAR(128),               -- Lock TX on Stellar
    evm_tx_hash VARCHAR(66),                    -- Release TX on Paseo Asset Hub
    
    -- Error handling
    error_message TEXT,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE
);

-- Create indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_crypto_purchases_user_id ON crypto_purchases(user_id);
CREATE INDEX IF NOT EXISTS idx_crypto_purchases_status ON crypto_purchases(status);
CREATE INDEX IF NOT EXISTS idx_crypto_purchases_destination ON crypto_purchases(destination_address);
CREATE INDEX IF NOT EXISTS idx_crypto_purchases_created ON crypto_purchases(created_at DESC);

-- Enable RLS
ALTER TABLE crypto_purchases ENABLE ROW LEVEL SECURITY;

-- RLS Policies (allow all operations for now - app uses anon key)
CREATE POLICY "crypto_purchases_select" ON crypto_purchases
  FOR SELECT USING (true);

CREATE POLICY "crypto_purchases_insert" ON crypto_purchases
  FOR INSERT WITH CHECK (true);

CREATE POLICY "crypto_purchases_update" ON crypto_purchases
  FOR UPDATE USING (true);

-- Verify table was created
SELECT 'crypto_purchases table created successfully!' as status;
