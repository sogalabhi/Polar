-- ============================================
-- POLAR BRIDGE - LENDING PROTOCOL SCHEMA
-- Migration: 001_lending_schema
-- Run this in your Supabase SQL Editor
-- ============================================

-- ============================================
-- UPDATE CRYPTO_PURCHASES TABLE
-- Add columns for lending protocol
-- ============================================

-- Collateral tracking
ALTER TABLE crypto_purchases ADD COLUMN IF NOT EXISTS collateral_xlm DECIMAL(20, 7);
ALTER TABLE crypto_purchases ADD COLUMN IF NOT EXISTS collateral_value_inr DECIMAL(15, 2);

-- Loan details  
ALTER TABLE crypto_purchases ADD COLUMN IF NOT EXISTS borrowed_pas DECIMAL(20, 10);
ALTER TABLE crypto_purchases ADD COLUMN IF NOT EXISTS borrowed_value_inr DECIMAL(15, 2);
ALTER TABLE crypto_purchases ADD COLUMN IF NOT EXISTS ltv_at_creation DECIMAL(5, 4);

-- Interest tracking
ALTER TABLE crypto_purchases ADD COLUMN IF NOT EXISTS interest_rate_apy DECIMAL(5, 4) DEFAULT 0.08;
ALTER TABLE crypto_purchases ADD COLUMN IF NOT EXISTS interest_accrued DECIMAL(15, 2) DEFAULT 0;
ALTER TABLE crypto_purchases ADD COLUMN IF NOT EXISTS last_interest_update TIMESTAMP WITH TIME ZONE;

-- Health & Liquidation
ALTER TABLE crypto_purchases ADD COLUMN IF NOT EXISTS health_factor DECIMAL(10, 4);
ALTER TABLE crypto_purchases ADD COLUMN IF NOT EXISTS liquidation_threshold DECIMAL(5, 4) DEFAULT 0.85;
ALTER TABLE crypto_purchases ADD COLUMN IF NOT EXISTS liquidation_price_xlm DECIMAL(15, 6);

-- Deadlines
ALTER TABLE crypto_purchases ADD COLUMN IF NOT EXISTS loan_start_date TIMESTAMP WITH TIME ZONE;
ALTER TABLE crypto_purchases ADD COLUMN IF NOT EXISTS repayment_deadline TIMESTAMP WITH TIME ZONE;
ALTER TABLE crypto_purchases ADD COLUMN IF NOT EXISTS grace_period_ends TIMESTAMP WITH TIME ZONE;

-- Fees
ALTER TABLE crypto_purchases ADD COLUMN IF NOT EXISTS late_fee DECIMAL(15, 2) DEFAULT 0;
ALTER TABLE crypto_purchases ADD COLUMN IF NOT EXISTS liquidation_penalty DECIMAL(5, 4) DEFAULT 0.10;

-- Loan type
ALTER TABLE crypto_purchases ADD COLUMN IF NOT EXISTS loan_type VARCHAR(20) DEFAULT 'standard';
ALTER TABLE crypto_purchases ADD COLUMN IF NOT EXISTS loan_duration_days INTEGER DEFAULT 30;

-- Liquidation status
ALTER TABLE crypto_purchases ADD COLUMN IF NOT EXISTS is_liquidated BOOLEAN DEFAULT FALSE;
ALTER TABLE crypto_purchases ADD COLUMN IF NOT EXISTS liquidated_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE crypto_purchases ADD COLUMN IF NOT EXISTS liquidation_tx_hash VARCHAR(128);

-- Update status enum to include new states
-- Status values: pending, locked, active, completed, overdue, liquidated, paid_back, failed

-- ============================================
-- INTEREST HISTORY TABLE
-- Track daily interest accrual
-- ============================================
CREATE TABLE IF NOT EXISTS interest_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    loan_id UUID REFERENCES crypto_purchases(id) ON DELETE CASCADE,
    interest_amount DECIMAL(15, 6) NOT NULL,
    principal_at_calc DECIMAL(15, 2),
    xlm_price_at_calc DECIMAL(15, 6),
    pas_price_at_calc DECIMAL(15, 6),
    health_factor_at_calc DECIMAL(10, 4),
    calculated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_interest_history_loan_id ON interest_history(loan_id);
CREATE INDEX IF NOT EXISTS idx_interest_history_calculated_at ON interest_history(calculated_at DESC);

-- ============================================
-- LIQUIDATION EVENTS TABLE
-- Track all liquidation actions
-- ============================================
CREATE TABLE IF NOT EXISTS liquidation_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    loan_id UUID REFERENCES crypto_purchases(id) ON DELETE CASCADE,
    user_id VARCHAR(255) NOT NULL,
    
    -- Amounts
    collateral_seized_xlm DECIMAL(20, 7),
    collateral_value_inr DECIMAL(15, 2),
    debt_repaid_inr DECIMAL(15, 2),
    penalty_amount_inr DECIMAL(15, 2),
    returned_to_user_xlm DECIMAL(20, 7),
    returned_to_user_inr DECIMAL(15, 2),
    
    -- Prices at liquidation
    xlm_price_at_liquidation DECIMAL(15, 6),
    pas_price_at_liquidation DECIMAL(15, 6),
    
    -- Health factor that triggered liquidation
    health_factor_at_liquidation DECIMAL(10, 4),
    liquidation_reason VARCHAR(50), -- 'health_factor', 'deadline', 'manual'
    
    -- Transaction tracking
    stellar_unlock_tx_hash VARCHAR(128),
    
    -- Metadata
    liquidated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_liquidation_events_loan_id ON liquidation_events(loan_id);
CREATE INDEX IF NOT EXISTS idx_liquidation_events_user_id ON liquidation_events(user_id);
CREATE INDEX IF NOT EXISTS idx_liquidation_events_liquidated_at ON liquidation_events(liquidated_at DESC);

-- ============================================
-- PRICE HISTORY TABLE
-- Track XLM/PAS prices for auditing
-- ============================================
CREATE TABLE IF NOT EXISTS price_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    xlm_price_inr DECIMAL(15, 6),
    pas_price_inr DECIMAL(15, 6),
    xlm_price_usd DECIMAL(15, 6),
    source VARCHAR(50) DEFAULT 'coingecko',
    recorded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_price_history_recorded_at ON price_history(recorded_at DESC);

-- ============================================
-- VIEWS
-- ============================================

-- Active loans view
CREATE OR REPLACE VIEW active_loans AS
SELECT 
    cp.*,
    w.balance_inr as wallet_balance,
    EXTRACT(DAY FROM (cp.repayment_deadline - NOW())) as days_until_deadline,
    CASE 
        WHEN cp.repayment_deadline < NOW() THEN TRUE 
        ELSE FALSE 
    END as is_overdue
FROM crypto_purchases cp
LEFT JOIN wallets w ON w.wallet_address = cp.user_id
WHERE cp.status IN ('active', 'locked', 'overdue')
  AND cp.is_liquidated = FALSE;

-- At-risk loans view (health factor < 1.2)
CREATE OR REPLACE VIEW at_risk_loans AS
SELECT *
FROM crypto_purchases
WHERE status IN ('active', 'locked', 'overdue')
  AND is_liquidated = FALSE
  AND health_factor < 1.2
ORDER BY health_factor ASC;

-- Liquidatable loans view (health factor < 1.0 or deadline exceeded)
CREATE OR REPLACE VIEW liquidatable_loans AS
SELECT *
FROM crypto_purchases
WHERE status IN ('active', 'locked', 'overdue')
  AND is_liquidated = FALSE
  AND (
      health_factor < 1.0 
      OR (repayment_deadline IS NOT NULL AND repayment_deadline + INTERVAL '7 days' < NOW())
  )
ORDER BY health_factor ASC;

-- ============================================
-- FUNCTIONS
-- ============================================

-- Function to calculate health factor
CREATE OR REPLACE FUNCTION calculate_health_factor(
    collateral_value DECIMAL,
    total_debt DECIMAL,
    liquidation_threshold DECIMAL DEFAULT 0.85
)
RETURNS DECIMAL AS $$
BEGIN
    IF total_debt <= 0 THEN
        RETURN 999.99;  -- No debt = infinite health
    END IF;
    RETURN (collateral_value * liquidation_threshold) / total_debt;
END;
$$ LANGUAGE plpgsql;

-- Function to calculate accrued interest
CREATE OR REPLACE FUNCTION calculate_interest(
    principal DECIMAL,
    annual_rate DECIMAL,
    days_elapsed INTEGER
)
RETURNS DECIMAL AS $$
BEGIN
    -- Compound interest: A = P(1 + r/365)^days - P
    RETURN principal * (POWER(1 + annual_rate/365, days_elapsed) - 1);
END;
$$ LANGUAGE plpgsql;

-- Function to calculate late fee
CREATE OR REPLACE FUNCTION calculate_late_fee(
    total_due DECIMAL,
    days_overdue INTEGER,
    daily_rate DECIMAL DEFAULT 0.02
)
RETURNS DECIMAL AS $$
BEGIN
    IF days_overdue <= 0 THEN
        RETURN 0;
    END IF;
    RETURN total_due * daily_rate * days_overdue;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- TRIGGER: Auto-update health factor on price change
-- (Called manually via cron job in production)
-- ============================================

-- For now, we'll update health factors via the relayer application
-- This could be converted to a PostgreSQL trigger if needed

COMMENT ON TABLE crypto_purchases IS 'Main loans table - stores collateralized borrowing positions';
COMMENT ON TABLE interest_history IS 'Daily interest accrual log for audit trail';
COMMENT ON TABLE liquidation_events IS 'Record of all liquidation actions taken';
COMMENT ON TABLE price_history IS 'Historical price data for XLM/PAS';
