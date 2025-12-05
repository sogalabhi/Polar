/**
 * ============================================
 * POLAR BRIDGE - LENDING PROTOCOL CONFIGURATION
 * ============================================
 * 
 * Centralized configuration for all lending parameters.
 * Modify these values to adjust protocol behavior.
 */

const LENDING_CONFIG = {
  // ============================================
  // LTV (Loan-to-Value) Settings
  // ============================================
  LTV: {
    MAX_LTV: 0.75,                    // 75% - Maximum borrow against collateral
    LIQUIDATION_THRESHOLD: 0.85,      // 85% - LTV at which liquidation triggers
    MIN_COLLATERAL_INR: 100,          // Minimum ₹100 collateral required
    MAX_COLLATERAL_INR: 1000000,      // Maximum ₹10,00,000 collateral
    MIN_BORROW_INR: 50,               // Minimum ₹50 borrow
  },

  // ============================================
  // Interest Rate Settings
  // ============================================
  INTEREST: {
    BASE_APY: 0.08,                   // 8% base annual interest
    COMPOUND_FREQUENCY: 'daily',      // Interest compounds daily
    MIN_INTEREST_INR: 0.01,           // Minimum interest charge
    
    // Duration-based rates (shorter = higher rate)
    RATE_BY_DURATION: {
      7: 0.12,                        // 7 days: 12% APY
      14: 0.10,                       // 14 days: 10% APY
      30: 0.08,                       // 30 days: 8% APY
      60: 0.07,                       // 60 days: 7% APY
      90: 0.06,                       // 90 days: 6% APY
      180: 0.055,                     // 180 days: 5.5% APY
    },
  },

  // ============================================
  // Loan Types (Presets)
  // ============================================
  LOAN_TYPES: {
    short: {
      id: 'short',
      name: 'Short Term',
      icon: '⚡',
      duration: 7,
      interestRate: 0.12,
      maxLtv: 0.70,
      description: 'Quick loan for immediate needs',
    },
    standard: {
      id: 'standard',
      name: 'Standard',
      icon: '📊',
      duration: 30,
      interestRate: 0.08,
      maxLtv: 0.75,
      description: 'Balanced terms for most borrowers',
      recommended: true,
    },
    long: {
      id: 'long',
      name: 'Long Term',
      icon: '🏦',
      duration: 90,
      interestRate: 0.06,
      maxLtv: 0.65,
      description: 'Extended loan with lower rates',
    },
  },

  // ============================================
  // Health Factor Settings
  // ============================================
  HEALTH_FACTOR: {
    SAFE_THRESHOLD: 1.5,              // > 1.5 = Safe (green)
    WARNING_THRESHOLD: 1.2,           // 1.2 - 1.5 = Moderate risk (yellow)
    DANGER_THRESHOLD: 1.0,            // 1.0 - 1.2 = High risk (orange)
    LIQUIDATION_THRESHOLD: 1.0,       // < 1.0 = Liquidatable (red)
    
    // Status labels
    getStatus: (factor) => {
      if (factor > 1.5) return { status: 'safe', color: 'green', label: 'Safe' };
      if (factor > 1.2) return { status: 'moderate', color: 'yellow', label: 'Moderate Risk' };
      if (factor > 1.0) return { status: 'danger', color: 'orange', label: 'High Risk' };
      return { status: 'liquidatable', color: 'red', label: 'Liquidation Imminent' };
    },
  },

  // ============================================
  // Liquidation Settings
  // ============================================
  LIQUIDATION: {
    PENALTY: 0.10,                    // 10% penalty on total debt
    
    // Penalty distribution
    PROTOCOL_SHARE: 0.70,             // 70% to protocol treasury
    LIQUIDATOR_SHARE: 0.30,           // 30% to liquidator (future: external liquidators)
    
    // Auto-liquidation triggers
    AUTO_LIQUIDATE_ON_HEALTH: true,   // Liquidate when health < 1.0
    AUTO_LIQUIDATE_ON_DEADLINE: true, // Liquidate after max late days
    
    // Grace period before force liquidation
    GRACE_PERIOD_DAYS: 3,
  },

  // ============================================
  // Deadline & Late Fee Settings
  // ============================================
  DEADLINES: {
    DEFAULT_DURATION_DAYS: 30,        // Default 30-day loan term
    MIN_DURATION_DAYS: 7,             // Minimum 7 days
    MAX_DURATION_DAYS: 180,           // Maximum 180 days
    
    // Late fees
    LATE_FEE_PERCENT_PER_DAY: 0.02,   // 2% per day after deadline
    MAX_LATE_DAYS: 7,                 // Force liquidation after 7 days late
    GRACE_PERIOD_DAYS: 3,             // 3-day grace period (warning only)
    
    // Warning notifications (days before deadline)
    WARNING_DAYS: [7, 3, 1],          // Send warnings at 7, 3, 1 days before
  },

  // ============================================
  // Price/Oracle Settings
  // ============================================
  PRICES: {
    CACHE_TTL_MS: 60000,              // Cache prices for 60 seconds
    UPDATE_INTERVAL_MS: 30000,        // Check prices every 30 seconds
    
    // Price sources
    COINGECKO_API: 'https://api.coingecko.com/api/v3',
    
    // Price mapping (PAS uses DOT price since testnet)
    PAS_PRICE_SOURCE: 'polkadot',     // CoinGecko ID
    XLM_PRICE_SOURCE: 'stellar',      // CoinGecko ID
  },

  // ============================================
  // Scheduler Settings
  // ============================================
  SCHEDULER: {
    // Interest accrual
    INTEREST_ACCRUAL_CRON: '0 0 * * *',      // Daily at midnight UTC
    
    // Health factor updates
    HEALTH_CHECK_INTERVAL_MS: 5 * 60 * 1000,  // Every 5 minutes
    
    // Liquidation bot
    LIQUIDATION_CHECK_INTERVAL_MS: 5 * 60 * 1000, // Every 5 minutes
    
    // Late fee calculation
    LATE_FEE_CALC_CRON: '0 0 * * *',         // Daily at midnight UTC
  },
};

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Calculate required collateral for a borrow amount
 * @param {number} borrowAmountInr - Amount to borrow in INR
 * @param {number} ltvRatio - Desired LTV ratio (0-1)
 * @returns {number} Required collateral in INR
 */
function calculateRequiredCollateral(borrowAmountInr, ltvRatio = LENDING_CONFIG.LTV.MAX_LTV) {
  return borrowAmountInr / ltvRatio;
}

/**
 * Calculate health factor
 * @param {number} collateralValueInr - Current collateral value in INR
 * @param {number} totalDebtInr - Total debt (principal + interest + fees) in INR
 * @param {number} liquidationThreshold - Liquidation threshold (default 0.85)
 * @returns {number} Health factor
 */
function calculateHealthFactor(collateralValueInr, totalDebtInr, liquidationThreshold = LENDING_CONFIG.LTV.LIQUIDATION_THRESHOLD) {
  if (totalDebtInr <= 0) return 999.99; // No debt = infinite health
  return (collateralValueInr * liquidationThreshold) / totalDebtInr;
}

/**
 * Calculate liquidation price (price at which collateral gets liquidated)
 * @param {number} totalDebtInr - Total debt in INR
 * @param {number} collateralAmount - Amount of collateral (XLM)
 * @param {number} liquidationThreshold - Liquidation threshold (default 0.85)
 * @returns {number} Liquidation price per unit of collateral
 */
function calculateLiquidationPrice(totalDebtInr, collateralAmount, liquidationThreshold = LENDING_CONFIG.LTV.LIQUIDATION_THRESHOLD) {
  if (collateralAmount <= 0) return 0;
  return totalDebtInr / (collateralAmount * liquidationThreshold);
}

/**
 * Calculate accrued interest using compound formula
 * @param {number} principalInr - Principal amount in INR
 * @param {number} annualRate - Annual interest rate (e.g., 0.08 for 8%)
 * @param {number} daysElapsed - Number of days since loan start
 * @returns {object} Interest details
 */
function calculateAccruedInterest(principalInr, annualRate, daysElapsed) {
  // Compound interest: A = P(1 + r/n)^(nt) where n = 365
  const compoundedAmount = principalInr * Math.pow(1 + annualRate / 365, daysElapsed);
  const interestAccrued = compoundedAmount - principalInr;
  const dailyInterest = principalInr * (annualRate / 365);
  
  return {
    principal: principalInr,
    interestAccrued: Math.max(interestAccrued, LENDING_CONFIG.INTEREST.MIN_INTEREST_INR),
    totalOwed: compoundedAmount,
    dailyInterest,
    daysElapsed,
    annualRate,
  };
}

/**
 * Calculate late fee
 * @param {number} totalDueInr - Total amount due (principal + interest)
 * @param {number} daysOverdue - Number of days past deadline
 * @returns {number} Late fee amount in INR
 */
function calculateLateFee(totalDueInr, daysOverdue) {
  if (daysOverdue <= 0) return 0;
  const maxDays = Math.min(daysOverdue, LENDING_CONFIG.DEADLINES.MAX_LATE_DAYS);
  return totalDueInr * LENDING_CONFIG.DEADLINES.LATE_FEE_PERCENT_PER_DAY * maxDays;
}

/**
 * Get interest rate based on loan duration
 * @param {number} durationDays - Loan duration in days
 * @returns {number} Annual interest rate
 */
function getInterestRateForDuration(durationDays) {
  const rates = LENDING_CONFIG.INTEREST.RATE_BY_DURATION;
  const durations = Object.keys(rates).map(Number).sort((a, b) => a - b);
  
  for (const days of durations) {
    if (durationDays <= days) {
      return rates[days];
    }
  }
  
  // For durations longer than max defined, use the lowest rate
  return rates[durations[durations.length - 1]] || LENDING_CONFIG.INTEREST.BASE_APY;
}

/**
 * Calculate liquidation amounts
 * @param {object} loan - Loan object with debt and collateral info
 * @param {number} xlmPrice - Current XLM price in INR
 * @returns {object} Liquidation breakdown
 */
function calculateLiquidationAmounts(loan, xlmPrice) {
  const totalDebt = loan.borrowed_value_inr + (loan.interest_accrued || 0) + (loan.late_fee || 0);
  const penalty = totalDebt * LENDING_CONFIG.LIQUIDATION.PENALTY;
  const totalToRecover = totalDebt + penalty;
  
  const xlmNeededForDebt = totalToRecover / xlmPrice;
  const collateralXlm = loan.collateral_xlm;
  const collateralValueInr = collateralXlm * xlmPrice;
  
  const xlmSeized = Math.min(xlmNeededForDebt, collateralXlm);
  const xlmReturned = Math.max(0, collateralXlm - xlmNeededForDebt);
  const inrReturned = xlmReturned * xlmPrice;
  
  return {
    totalDebt,
    penalty,
    totalToRecover,
    collateralXlm,
    collateralValueInr,
    xlmSeized,
    xlmReturned,
    inrReturned,
    isFullyRecovered: collateralValueInr >= totalToRecover,
    shortfall: Math.max(0, totalToRecover - collateralValueInr),
  };
}

/**
 * Days between two dates
 * @param {Date} startDate 
 * @param {Date} endDate 
 * @returns {number}
 */
function daysBetween(startDate, endDate) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const diffMs = end - start;
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

// Export configuration and helpers
module.exports = {
  LENDING_CONFIG,
  calculateRequiredCollateral,
  calculateHealthFactor,
  calculateLiquidationPrice,
  calculateAccruedInterest,
  calculateLateFee,
  getInterestRateForDuration,
  calculateLiquidationAmounts,
  daysBetween,
};
