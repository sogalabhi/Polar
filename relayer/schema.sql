-- ============================================
-- POLAR BRIDGE - SUPABASE SCHEMA
-- Run this in your Supabase SQL Editor
-- ============================================

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT UNIQUE NOT NULL,
    evm_address TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Wallets table (INR balance)
CREATE TABLE IF NOT EXISTS wallets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) UNIQUE NOT NULL,
    balance_inr DECIMAL(15, 2) DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- INR Deposits (from Razorpay)
CREATE TABLE IF NOT EXISTS inr_deposits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) NOT NULL,
    razorpay_order_id TEXT,
    razorpay_payment_id TEXT UNIQUE,
    amount_inr DECIMAL(15, 2) NOT NULL,
    status TEXT DEFAULT 'pending', -- pending, completed, failed
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Crypto Purchases (INR → PAS)
-- This is the "frozen" table that tracks each purchase
CREATE TABLE IF NOT EXISTS crypto_purchases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) NOT NULL,
    
    -- INR side
    from_amount DECIMAL(15, 2) NOT NULL,        -- INR spent
    
    -- Crypto side
    to_token TEXT NOT NULL DEFAULT 'PAS',       -- Token bought
    to_amount DECIMAL(18, 8) NOT NULL,          -- Amount of PAS
    exchange_rate DECIMAL(15, 6) NOT NULL,      -- Rate at time of purchase (1 PAS = X INR)
    
    -- User's destination
    destination_address TEXT NOT NULL,           -- User's EVM address (MetaMask)
    
    -- Owner's collateral (XLM locked on Stellar)
    xlm_locked DECIMAL(18, 8),                  -- Amount of XLM locked by owner
    
    -- Slippage
    slippage_tolerance DECIMAL(5, 2) DEFAULT 1, -- 0-100%
    
    -- Status tracking
    status TEXT DEFAULT 'pending',              -- pending, frozen, locked, completed, failed
    -- pending: order created
    -- frozen: INR deducted from wallet
    -- locked: XLM locked on Stellar, waiting for relayer
    -- completed: PAS sent to user
    -- failed: something went wrong
    
    -- Transaction hashes
    stellar_tx_hash TEXT,                       -- Lock TX on Stellar
    evm_tx_hash TEXT,                           -- Release TX on Paseo Asset Hub
    
    -- Error handling
    error_message TEXT,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

-- Create indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_wallets_user_id ON wallets(user_id);
CREATE INDEX IF NOT EXISTS idx_crypto_purchases_user_id ON crypto_purchases(user_id);
CREATE INDEX IF NOT EXISTS idx_crypto_purchases_status ON crypto_purchases(status);
CREATE INDEX IF NOT EXISTS idx_crypto_purchases_destination ON crypto_purchases(destination_address);
CREATE INDEX IF NOT EXISTS idx_inr_deposits_user_id ON inr_deposits(user_id);

-- Enable Row Level Security (optional - for production)
-- ALTER TABLE users ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE wallets ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE crypto_purchases ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE inr_deposits ENABLE ROW LEVEL SECURITY;

-- ============================================
-- TEST DATA (optional - for testing)
-- ============================================

-- Insert a test user
-- INSERT INTO users (id, email, evm_address) 
-- VALUES ('test-user-1', 'test@example.com', '0xYourMetaMaskAddress')
-- ON CONFLICT (id) DO NOTHING;

-- Create wallet for test user
-- INSERT INTO wallets (user_id, balance_inr)
-- VALUES ('test-user-1', 1000)
-- ON CONFLICT (user_id) DO NOTHING;
