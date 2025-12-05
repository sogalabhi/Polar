-- ============================================
-- POLAR BRIDGE - LENDING LOANS TABLE
-- Migration: 002_lending_loans_table
-- Run this in your Supabase SQL Editor
-- ============================================

-- ============================================
-- CREATE LOANS TABLE
-- Separate table for all lending loans
-- ============================================

CREATE TABLE IF NOT EXISTS lending_loans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id VARCHAR(255) NOT NULL,                    -- EVM wallet address (lowercase)
    
    -- Collateral (XLM locked)
    collateral_xlm DECIMAL(20, 7) NOT NULL,           -- Amount of XLM locked
    collateral_value_inr DECIMAL(15, 2),              -- INR value at time of loan
    
    -- Borrowed (PAS received)
    borrowed_pas DECIMAL(20, 10) NOT NULL,            -- Amount of PAS borrowed
    borrowed_value_inr DECIMAL(15, 2) NOT NULL,       -- INR value at time of loan
    
    -- Loan terms
    ltv_ratio DECIMAL(5, 4) NOT NULL,                 -- LTV at creation (e.g., 0.60 = 60%)
    interest_rate_apy DECIMAL(5, 4) DEFAULT 0.08,     -- Annual interest rate
    loan_type VARCHAR(20) DEFAULT 'standard',         -- short, standard, long, custom
    loan_duration_days INTEGER DEFAULT 30,
    
    -- Risk metrics
    health_factor DECIMAL(10, 4),
    liquidation_price DECIMAL(15, 6),                 -- XLM price at which liquidation triggers
    
    -- Dates
    loan_start_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    repayment_deadline TIMESTAMP WITH TIME ZONE,
    
    -- Transaction hashes
    stellar_lock_tx_hash VARCHAR(128),                -- XLM lock transaction
    evm_release_tx_hash VARCHAR(128),                 -- PAS release transaction
    
    -- Status: 'active', 'repaid', 'liquidated'
    status VARCHAR(20) DEFAULT 'active',
    
    -- Repayment details (filled when repaid)
    repaid_at TIMESTAMP WITH TIME ZONE,
    repaid_pas DECIMAL(20, 10),                       -- Total PAS repaid (principal + interest)
    repaid_value_inr DECIMAL(15, 2),
    interest_paid DECIMAL(15, 2),
    late_fee_paid DECIMAL(15, 2),
    repay_tx_hash VARCHAR(128),                       -- PAS repayment transaction
    
    -- Liquidation details (filled if liquidated)
    liquidated_at TIMESTAMP WITH TIME ZONE,
    liquidation_tx_hash VARCHAR(128),
    
    -- Metadata
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_lending_loans_user_id ON lending_loans(user_id);
CREATE INDEX IF NOT EXISTS idx_lending_loans_status ON lending_loans(status);
CREATE INDEX IF NOT EXISTS idx_lending_loans_created_at ON lending_loans(created_at DESC);

-- Function to auto-update updated_at
CREATE OR REPLACE FUNCTION update_lending_loans_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for auto-updating updated_at
DROP TRIGGER IF EXISTS trigger_lending_loans_updated_at ON lending_loans;
CREATE TRIGGER trigger_lending_loans_updated_at
    BEFORE UPDATE ON lending_loans
    FOR EACH ROW
    EXECUTE FUNCTION update_lending_loans_updated_at();

-- Enable RLS
ALTER TABLE lending_loans ENABLE ROW LEVEL SECURITY;

-- RLS Policies (allow all for service role)
CREATE POLICY "lending_loans_select" ON lending_loans FOR SELECT USING (true);
CREATE POLICY "lending_loans_insert" ON lending_loans FOR INSERT WITH CHECK (true);
CREATE POLICY "lending_loans_update" ON lending_loans FOR UPDATE USING (true);
CREATE POLICY "lending_loans_delete" ON lending_loans FOR DELETE USING (true);

-- ============================================
-- USEFUL VIEWS
-- ============================================

-- Active loans view
-- If a previous view exists that references `crypto_purchases`, drop it first to avoid dependency errors.
-- This avoids errors like "cannot drop columns from view" that occur when altering underlying tables.
DROP VIEW IF EXISTS active_loans;

CREATE OR REPLACE VIEW active_loans AS
SELECT 
    user_id,
    COUNT(*) as loan_count,
    SUM(collateral_xlm) as total_collateral_xlm,
    SUM(borrowed_pas) as total_borrowed_pas,
    SUM(borrowed_value_inr) as total_borrowed_inr
FROM lending_loans
WHERE status = 'active'
GROUP BY user_id;

-- ============================================
-- SAMPLE QUERY TO MIGRATE EXISTING DATA
-- Uncomment and run if you have data in crypto_purchases
-- ============================================
/*
INSERT INTO lending_loans (
    user_id, collateral_xlm, collateral_value_inr, 
    borrowed_pas, borrowed_value_inr, ltv_ratio,
    interest_rate_apy, loan_type, loan_duration_days,
    health_factor, liquidation_price,
    loan_start_date, repayment_deadline,
    stellar_lock_tx_hash, status, created_at
)
SELECT 
    user_id, collateral_xlm, collateral_value_inr,
    borrowed_pas, borrowed_value_inr, ltv_at_creation,
    interest_rate_apy, loan_type, loan_duration_days,
    health_factor, liquidation_price_xlm,
    loan_start_date, repayment_deadline,
    stellar_tx_hash, status, created_at
FROM crypto_purchases
WHERE borrowed_pas IS NOT NULL AND borrowed_pas > 0;
*/
