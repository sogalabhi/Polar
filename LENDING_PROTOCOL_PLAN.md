# 🏦 Polar Bridge - DeFi Lending Protocol Implementation Plan

## Overview

Transform Polar Bridge from a simple swap/bridge into a proper **collateralized lending protocol** with liquidations, interest rates, health factors, and deadlines.

---

## 📊 Current State vs Target State

| Feature | Current | Target |
|---------|---------|--------|
| LTV Ratio | 100% (1:1) | 75% max |
| Collateralization | None | 133% minimum |
| Interest Rate | 0% | 8% APY |
| Liquidation | Manual sell | Auto-liquidation |
| Health Factor | Not shown | Real-time display |
| Repayment Deadline | None | 30 days |
| Liquidation Penalty | None | 10% |

---

## 🏗️ Architecture

### Database Schema Changes

```sql
-- Update crypto_purchases table (or create new loans table)
ALTER TABLE crypto_purchases ADD COLUMN IF NOT EXISTS
  -- Collateral tracking
  collateral_xlm DECIMAL(20, 7),           -- XLM locked as collateral
  collateral_value_inr DECIMAL(15, 2),     -- INR value at time of loan
  
  -- Loan details  
  borrowed_pas DECIMAL(20, 10),            -- PAS borrowed
  borrowed_value_inr DECIMAL(15, 2),       -- INR value of borrowed amount
  ltv_at_creation DECIMAL(5, 2),           -- LTV when loan was created (e.g., 0.75)
  
  -- Interest tracking
  interest_rate_apy DECIMAL(5, 4),         -- Annual interest rate (e.g., 0.08 = 8%)
  interest_accrued DECIMAL(15, 2),         -- Total interest accrued in INR
  last_interest_update TIMESTAMP,          -- When interest was last calculated
  
  -- Health & Liquidation
  health_factor DECIMAL(10, 4),            -- Current health factor
  liquidation_threshold DECIMAL(5, 2),     -- Threshold for liquidation (e.g., 1.1 = 110%)
  liquidation_price_xlm DECIMAL(15, 6),    -- XLM price at which liquidation triggers
  
  -- Deadlines
  loan_start_date TIMESTAMP,               -- When loan was created
  repayment_deadline TIMESTAMP,            -- Must repay by this date
  grace_period_ends TIMESTAMP,             -- Grace period after deadline
  
  -- Fees
  liquidation_penalty DECIMAL(5, 2),       -- Penalty if liquidated (e.g., 0.10 = 10%)
  
  -- Status tracking
  is_liquidated BOOLEAN DEFAULT FALSE,
  liquidated_at TIMESTAMP,
  liquidation_tx_hash VARCHAR(66);

-- Create interest_history table for tracking
CREATE TABLE IF NOT EXISTS interest_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_id UUID REFERENCES crypto_purchases(id),
  interest_amount DECIMAL(15, 2),
  calculated_at TIMESTAMP DEFAULT NOW(),
  xlm_price_at_calc DECIMAL(15, 6),
  pas_price_at_calc DECIMAL(15, 6)
);

-- Create liquidation_events table
CREATE TABLE IF NOT EXISTS liquidation_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_id UUID REFERENCES crypto_purchases(id),
  user_id VARCHAR(255),
  collateral_seized_xlm DECIMAL(20, 7),
  debt_repaid_pas DECIMAL(20, 10),
  penalty_amount_inr DECIMAL(15, 2),
  liquidator_address VARCHAR(66),
  tx_hash VARCHAR(66),
  liquidated_at TIMESTAMP DEFAULT NOW()
);
```

---

## 💰 1. LTV (Loan-to-Value) Ratio

### Configuration
```javascript
const LENDING_CONFIG = {
  MAX_LTV: 0.75,              // 75% - Can borrow up to 75% of collateral value
  LIQUIDATION_LTV: 0.85,      // 85% - Liquidation triggers at this LTV
  MIN_COLLATERAL_INR: 100,    // Minimum ₹100 collateral
};
```

### User Experience

**When Borrowing:**
```
┌─────────────────────────────────────────────────────────┐
│  💎 Borrow PAS Tokens                                   │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Collateral (XLM locked): ₹1,000                       │
│  ──────────────────────────────                        │
│  Maximum Borrow (75% LTV): ₹750 worth of PAS           │
│                                                         │
│  ┌─────────────────────────────────────┐               │
│  │ Borrow Amount: [₹500        ]       │               │
│  └─────────────────────────────────────┘               │
│                                                         │
│  📊 Loan Summary:                                       │
│  • You deposit: 52.86 XLM (₹1,000)                     │
│  • You receive: 2.65 PAS (₹500)                        │
│  • Your LTV: 50%                                        │
│  • Health Factor: 1.70 ✅ Safe                         │
│  • Liquidation Price: XLM drops to ₹11.10              │
│                                                         │
│  ⚠️ If XLM price drops 41%, you'll be liquidated       │
│                                                         │
│  [        Borrow PAS        ]                          │
└─────────────────────────────────────────────────────────┘
```

### Implementation

```javascript
// routes.js - Updated buy-pas endpoint
app.post('/api/borrow-pas', async (req, res) => {
  const { userId, borrowAmountInr, evmAddress } = req.body;
  
  // Calculate required collateral (133% of borrow amount)
  const requiredCollateralInr = borrowAmountInr / MAX_LTV;
  const xlmPrice = await getXlmPrice();
  const requiredXlm = requiredCollateralInr / xlmPrice;
  
  // Calculate LTV
  const ltv = borrowAmountInr / requiredCollateralInr;
  
  // Calculate health factor
  const healthFactor = (requiredCollateralInr * LIQUIDATION_LTV) / borrowAmountInr;
  
  // Calculate liquidation price
  const liquidationPriceXlm = (borrowAmountInr / requiredXlm) / LIQUIDATION_LTV;
  
  // ... create loan record
});
```

---

## ⚠️ 2. Liquidation System

### How It Works

```
User deposits ₹1,000 XLM → Borrows ₹750 PAS (75% LTV)
                    ↓
           XLM price drops 20%
                    ↓
        Collateral now worth ₹800
        LTV now = 750/800 = 93.75%
                    ↓
        LIQUIDATION TRIGGERED (>85% LTV)
                    ↓
        • Collateral sold to repay debt
        • 10% penalty applied
        • User loses collateral
```

### Liquidation Thresholds

| Health Factor | Status | Color | Action |
|---------------|--------|-------|--------|
| > 1.5 | Safe | 🟢 Green | None |
| 1.2 - 1.5 | Moderate | 🟡 Yellow | Warning shown |
| 1.0 - 1.2 | At Risk | 🟠 Orange | Urgent warning |
| < 1.0 | Liquidatable | 🔴 Red | Auto-liquidation |

### Liquidation Process

```javascript
// relayer/src/liquidation-bot.js
async function checkAndLiquidate() {
  // Run every 5 minutes
  const atRiskLoans = await supabase
    .from('crypto_purchases')
    .select('*')
    .eq('status', 'active')
    .lt('health_factor', 1.0);
  
  for (const loan of atRiskLoans) {
    await liquidateLoan(loan);
  }
}

async function liquidateLoan(loan) {
  // 1. Calculate amounts
  const debtPas = loan.borrowed_pas;
  const collateralXlm = loan.collateral_xlm;
  const penalty = loan.borrowed_value_inr * LIQUIDATION_PENALTY; // 10%
  
  // 2. Unlock collateral from Stellar vault
  await unlockCollateral(loan.stellar_tx_hash, collateralXlm);
  
  // 3. Sell collateral to cover debt + penalty
  const xlmToSell = (loan.borrowed_value_inr + penalty) / xlmPrice;
  
  // 4. Return remaining collateral to user (if any)
  const remainingXlm = collateralXlm - xlmToSell;
  if (remainingXlm > 0) {
    await returnCollateral(loan.user_id, remainingXlm);
  }
  
  // 5. Update loan status
  await supabase
    .from('crypto_purchases')
    .update({
      status: 'liquidated',
      is_liquidated: true,
      liquidated_at: new Date().toISOString()
    })
    .eq('id', loan.id);
  
  // 6. Notify user
  await notifyUser(loan.user_id, 'Your loan has been liquidated');
}
```

### User Notification Flow

```
Day 0: Loan created
  └── Health Factor: 1.70 ✅

Day 5: XLM drops 10%
  └── Health Factor: 1.35 🟡
  └── Email: "Your loan health is declining"

Day 8: XLM drops another 10%  
  └── Health Factor: 1.08 🟠
  └── Email: "URGENT: Add collateral or repay to avoid liquidation"
  └── Push notification
  └── SMS (if enabled)

Day 9: XLM drops 5% more
  └── Health Factor: 0.95 🔴
  └── AUTO-LIQUIDATION TRIGGERED
  └── Email: "Your loan has been liquidated. 10% penalty applied."
```

---

## 📈 3. Interest Rates

### Configuration

```javascript
const INTEREST_CONFIG = {
  BORROW_APY: 0.08,           // 8% annual interest on borrowed amount
  COMPOUND_FREQUENCY: 'daily', // Interest compounds daily
  MIN_INTEREST_INR: 0.01,     // Minimum interest charge
};
```

### Interest Calculation

```javascript
// Calculate daily compound interest
function calculateAccruedInterest(loan) {
  const principal = loan.borrowed_value_inr;
  const annualRate = INTEREST_CONFIG.BORROW_APY;
  const daysSinceLoan = daysBetween(loan.loan_start_date, new Date());
  
  // Compound interest formula: A = P(1 + r/n)^(nt)
  // Where n = 365 (daily compounding)
  const compoundedAmount = principal * Math.pow(1 + annualRate/365, daysSinceLoan);
  const interestAccrued = compoundedAmount - principal;
  
  return {
    principal,
    interestAccrued,
    totalOwed: compoundedAmount,
    dailyInterest: principal * (annualRate / 365)
  };
}
```

### User Experience

```
┌─────────────────────────────────────────────────────────┐
│  📋 Your Active Loan                                    │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Borrowed: 3.98 PAS (₹750.00)                          │
│  Collateral: 52.86 XLM (₹1,000.00)                     │
│                                                         │
│  ┌───────────────────────────────────────────┐         │
│  │ 💰 Amount Owed                             │         │
│  │                                            │         │
│  │ Principal:        ₹750.00                  │         │
│  │ Interest (15d):   ₹2.47    (8% APY)       │         │
│  │ ─────────────────────────                  │         │
│  │ Total Due:        ₹752.47                  │         │
│  │                                            │         │
│  │ Daily Interest:   ₹0.16                    │         │
│  └───────────────────────────────────────────┘         │
│                                                         │
│  ⏰ Repayment Deadline: Dec 21, 2025 (15 days left)    │
│                                                         │
│  [  Repay ₹752.47  ]    [  Add Collateral  ]           │
└─────────────────────────────────────────────────────────┘
```

### Interest Accrual Job

```javascript
// Run daily via cron job
async function accrueInterestDaily() {
  const activeLoans = await supabase
    .from('crypto_purchases')
    .select('*')
    .eq('status', 'active');
  
  for (const loan of activeLoans) {
    const interest = calculateAccruedInterest(loan);
    
    await supabase
      .from('crypto_purchases')
      .update({
        interest_accrued: interest.interestAccrued,
        last_interest_update: new Date().toISOString()
      })
      .eq('id', loan.id);
    
    // Log interest history
    await supabase
      .from('interest_history')
      .insert({
        loan_id: loan.id,
        interest_amount: interest.dailyInterest
      });
  }
}
```

---

## 💚 4. Health Factor

### Formula

```
Health Factor = (Collateral Value × Liquidation Threshold) / Total Debt

Where:
- Collateral Value = XLM amount × current XLM price
- Liquidation Threshold = 0.85 (85%)
- Total Debt = Borrowed amount + Accrued interest
```

### Example

```
Collateral: 52.86 XLM × ₹18.92 = ₹1,000
Debt: ₹750 + ₹2.47 interest = ₹752.47
Liquidation Threshold: 0.85

Health Factor = (₹1,000 × 0.85) / ₹752.47 = 1.13

Status: 🟠 At Risk (add collateral recommended)
```

### Real-time Updates

```javascript
// Frontend hook for real-time health factor
function useLoanHealth(loanId) {
  const [health, setHealth] = useState(null);
  
  useEffect(() => {
    const interval = setInterval(async () => {
      const xlmPrice = await fetchXlmPrice();
      const loan = await fetchLoan(loanId);
      
      const collateralValue = loan.collateral_xlm * xlmPrice;
      const totalDebt = loan.borrowed_value_inr + loan.interest_accrued;
      const healthFactor = (collateralValue * LIQUIDATION_THRESHOLD) / totalDebt;
      
      setHealth({
        factor: healthFactor,
        status: getHealthStatus(healthFactor),
        liquidationPrice: calculateLiquidationPrice(loan, totalDebt)
      });
    }, 30000); // Update every 30 seconds
    
    return () => clearInterval(interval);
  }, [loanId]);
  
  return health;
}
```

### UI Component

```jsx
// HealthFactorBadge.jsx
const HealthFactorBadge = ({ healthFactor }) => {
  const getColor = () => {
    if (healthFactor > 1.5) return 'bg-green-500';
    if (healthFactor > 1.2) return 'bg-yellow-500';
    if (healthFactor > 1.0) return 'bg-orange-500';
    return 'bg-red-500';
  };
  
  const getMessage = () => {
    if (healthFactor > 1.5) return 'Safe';
    if (healthFactor > 1.2) return 'Moderate Risk';
    if (healthFactor > 1.0) return 'High Risk - Add Collateral';
    return 'LIQUIDATION IMMINENT';
  };
  
  return (
    <div className={`${getColor()} px-3 py-1 rounded-full`}>
      <span className="font-bold">{healthFactor.toFixed(2)}</span>
      <span className="text-sm ml-2">{getMessage()}</span>
    </div>
  );
};
```

---

## 🛡️ 5. Over-collateralization

### Rules

```javascript
const COLLATERAL_CONFIG = {
  MIN_COLLATERAL_RATIO: 1.33,  // 133% - Must deposit 33% more than borrowing
  RECOMMENDED_RATIO: 1.50,     // 150% - Recommended for safety
  MAX_BORROW_RATIO: 0.75,      // 75% - Maximum LTV
};
```

### User Flow

```
User wants to borrow ₹750 worth of PAS

Required collateral (133%): ₹750 × 1.33 = ₹997.50
Recommended collateral (150%): ₹750 × 1.50 = ₹1,125

UI shows:
┌─────────────────────────────────────────────────────────┐
│  Borrow ₹750 worth of PAS                               │
│                                                         │
│  Minimum Collateral Required:    ₹997.50 (52.7 XLM)    │
│  Recommended Collateral:         ₹1,125.00 (59.5 XLM)  │
│                                                         │
│  Your Collateral: [₹1,000    ] (52.9 XLM)              │
│                                                         │
│  ✅ Meets minimum requirement                           │
│  ⚠️ Below recommended - higher liquidation risk         │
│                                                         │
│  Resulting Health Factor: 1.13                          │
│  Liquidation if XLM drops: 18%                          │
└─────────────────────────────────────────────────────────┘
```

---

## 🔨 6. Liquidation Penalty

### Configuration

```javascript
const LIQUIDATION_PENALTY = 0.10; // 10% penalty on debt
```

### How It Works

```
User's Loan:
- Borrowed: ₹750
- Interest: ₹10
- Total Debt: ₹760

Liquidation Happens:
- Debt to repay: ₹760
- Penalty (10%): ₹76
- Total taken from collateral: ₹836

User's Collateral: ₹1,000 (52.86 XLM)
- Used for debt + penalty: ₹836 (44.2 XLM)
- Returned to user: ₹164 (8.66 XLM)

Net Loss to User: ₹76 (the penalty)
```

### Penalty Distribution

```javascript
// Where does the penalty go?
const PENALTY_DISTRIBUTION = {
  PROTOCOL_TREASURY: 0.70,  // 70% to protocol (revenue)
  LIQUIDATOR_REWARD: 0.30,  // 30% to liquidator (incentive)
};
```

---

## ⏰ 7. Repayment Deadlines

### Configuration

```javascript
const DEADLINE_CONFIG = {
  LOAN_DURATION_DAYS: 30,      // 30-day loan term
  GRACE_PERIOD_DAYS: 3,        // 3-day grace period after deadline
  LATE_FEE_PERCENT: 0.02,      // 2% late fee per day after deadline
  MAX_LATE_DAYS: 7,            // Force liquidation after 7 days late
};
```

### Timeline

```
Day 0:  Loan Created
        └── Deadline set: Day 30
        
Day 25: Warning Email
        └── "5 days until repayment deadline"
        
Day 28: Urgent Warning
        └── "2 days left - repay to avoid late fees"
        
Day 30: DEADLINE
        └── Grace period begins
        └── Late fee starts accruing (2%/day)
        
Day 33: Grace Period Ends
        └── Late fee: 6% (3 days × 2%)
        └── Final warning: "Repay within 4 days or face liquidation"
        
Day 37: MAX LATE DAYS
        └── Force liquidation regardless of health factor
        └── Penalty + late fees applied
```

### User Experience

```
┌─────────────────────────────────────────────────────────┐
│  ⏰ Loan #12345                                         │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Status: 🟠 OVERDUE (2 days late)                      │
│                                                         │
│  Original Due: Dec 6, 2025                              │
│  Grace Period Ends: Dec 9, 2025 (1 day left)           │
│                                                         │
│  ┌───────────────────────────────────────────┐         │
│  │ Amount Breakdown                           │         │
│  │                                            │         │
│  │ Principal:        ₹750.00                  │         │
│  │ Interest:         ₹4.93                    │         │
│  │ Late Fee (2d):    ₹15.10   ⚠️              │         │
│  │ ─────────────────────────                  │         │
│  │ Total Due:        ₹770.03                  │         │
│  └───────────────────────────────────────────┘         │
│                                                         │
│  ⚠️ Late fee increases ₹15.10/day                      │
│  ⚠️ Auto-liquidation in 5 days if unpaid               │
│                                                         │
│  [     Repay Now ₹770.03     ]                         │
└─────────────────────────────────────────────────────────┘
```

---

## 🎨 8. Loan Creation UI & Type Selection

### Loan Types

Users can choose from different loan presets, or customize their own:

```javascript
const LOAN_TYPES = {
  SHORT_TERM: {
    id: 'short',
    name: 'Short Term',
    icon: '⚡',
    duration: 7,           // 7 days
    interestRate: 0.12,    // 12% APY (higher for short term)
    maxLtv: 0.70,          // 70% max LTV
    description: 'Quick loan for immediate needs',
    recommended: false
  },
  STANDARD: {
    id: 'standard', 
    name: 'Standard',
    icon: '📊',
    duration: 30,          // 30 days
    interestRate: 0.08,    // 8% APY
    maxLtv: 0.75,          // 75% max LTV
    description: 'Balanced terms for most borrowers',
    recommended: true
  },
  LONG_TERM: {
    id: 'long',
    name: 'Long Term',
    icon: '🏦',
    duration: 90,          // 90 days
    interestRate: 0.06,    // 6% APY (lower for long term)
    maxLtv: 0.65,          // 65% max LTV (stricter)
    description: 'Extended loan with lower rates',
    recommended: false
  },
  CUSTOM: {
    id: 'custom',
    name: 'Custom',
    icon: '⚙️',
    duration: null,        // User selects
    interestRate: null,    // Calculated based on duration
    maxLtv: null,          // User selects
    description: 'Customize your own terms',
    recommended: false
  }
};
```

### Loan Creation Wizard UI

```
┌─────────────────────────────────────────────────────────────────────┐
│  🏦 Create New Loan                                    Step 1 of 3  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Select Loan Type                                                   │
│                                                                     │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐  │
│  │   ⚡ SHORT TERM   │  │ 📊 STANDARD ✨    │  │   🏦 LONG TERM   │  │
│  │                  │  │   RECOMMENDED    │  │                  │  │
│  │  7 days          │  │  30 days         │  │  90 days         │  │
│  │  12% APY         │  │  8% APY          │  │  6% APY          │  │
│  │  70% max LTV     │  │  75% max LTV     │  │  65% max LTV     │  │
│  │                  │  │                  │  │                  │  │
│  │  Quick loan for  │  │  Balanced terms  │  │  Extended loan   │  │
│  │  immediate needs │  │  for most users  │  │  with lower rate │  │
│  │                  │  │                  │  │                  │  │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘  │
│                                                                     │
│  ┌──────────────────┐                                               │
│  │   ⚙️ CUSTOM       │                                               │
│  │                  │                                               │
│  │  Set your own    │                                               │
│  │  duration & LTV  │                                               │
│  └──────────────────┘                                               │
│                                                                     │
│                                          [  Next: Set Amount →  ]   │
└─────────────────────────────────────────────────────────────────────┘
```

### Step 2: Amount & Collateral

```
┌─────────────────────────────────────────────────────────────────────┐
│  🏦 Create New Loan                                    Step 2 of 3  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Loan Type: 📊 Standard (30 days, 8% APY)                          │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────┐     │
│  │  How much do you want to borrow?                          │     │
│  │                                                           │     │
│  │  ₹ [________500________]                                  │     │
│  │                                                           │     │
│  │  Min: ₹100          │          Max: ₹10,000              │     │
│  │  ├──────────────●───────────────────────────┤            │     │
│  └───────────────────────────────────────────────────────────┘     │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────┐     │
│  │  LTV Ratio (Loan-to-Value)                                │     │
│  │                                                           │     │
│  │  50% ─────●───────────────────── 75%                     │     │
│  │      SAFER              RISKIER                          │     │
│  │                                                           │     │
│  │  Current: 60%                                             │     │
│  │  Lower LTV = More collateral needed, but safer           │     │
│  └───────────────────────────────────────────────────────────┘     │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────┐     │
│  │  📊 Calculated Values                                     │     │
│  │                                                           │     │
│  │  You borrow:         ₹500 worth of PAS (2.65 PAS)        │     │
│  │  Collateral needed:  ₹833 worth of XLM (44.0 XLM)        │     │
│  │  Health Factor:      1.42 🟢 Safe                        │     │
│  │  Liquidation if:     XLM drops 29% (to ₹13.40)           │     │
│  │                                                           │     │
│  │  ⏰ Repayment Due:   Jan 5, 2026 (30 days)               │     │
│  │  💰 Est. Interest:   ₹3.29 (for 30 days at 8% APY)       │     │
│  │  📋 Total to Repay:  ~₹503.29                            │     │
│  └───────────────────────────────────────────────────────────┘     │
│                                                                     │
│  [← Back]                              [  Next: Review →  ]         │
└─────────────────────────────────────────────────────────────────────┘
```

### Step 3: Review & Confirm

```
┌─────────────────────────────────────────────────────────────────────┐
│  🏦 Create New Loan                                    Step 3 of 3  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  📋 Loan Summary                                                    │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────┐     │
│  │  LOAN DETAILS                                             │     │
│  │  ─────────────────────────────────────────────────────    │     │
│  │  Type:               📊 Standard                          │     │
│  │  Duration:           30 days                              │     │
│  │  Interest Rate:      8% APY                               │     │
│  │  LTV:                60%                                  │     │
│  └───────────────────────────────────────────────────────────┘     │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────┐     │
│  │  YOU PROVIDE                      │  YOU RECEIVE          │     │
│  │  ─────────────────────────────────│──────────────────     │     │
│  │  💎 44.0 XLM                      │  🟣 2.65 PAS          │     │
│  │  (₹833 collateral)                │  (₹500 value)         │     │
│  │                                   │                       │     │
│  │  Locked until loan repaid         │  Sent to your         │     │
│  │  or liquidated                    │  Paseo wallet         │     │
│  └───────────────────────────────────────────────────────────┘     │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────┐     │
│  │  ⚠️ IMPORTANT TERMS                                       │     │
│  │                                                           │     │
│  │  • Repayment deadline: Jan 5, 2026                       │     │
│  │  • Late fee after deadline: 2% per day                   │     │
│  │  • Force liquidation: 7 days after deadline              │     │
│  │  • Liquidation penalty: 10% of debt                      │     │
│  │  • Liquidation threshold: 85% LTV                        │     │
│  │                                                           │     │
│  │  □ I understand and accept these terms                   │     │
│  └───────────────────────────────────────────────────────────┘     │
│                                                                     │
│  [← Back]                        [  🔒 Lock XLM & Borrow PAS  ]     │
└─────────────────────────────────────────────────────────────────────┘
```

### Custom Loan Configuration (if Custom type selected)

```
┌─────────────────────────────────────────────────────────────────────┐
│  ⚙️ Custom Loan Configuration                                       │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌───────────────────────────────────────────────────────────┐     │
│  │  DURATION                                                 │     │
│  │                                                           │     │
│  │  [  7  ] [  14  ] [  30  ] [  60  ] [  90  ] days        │     │
│  │           ↑ selected                                      │     │
│  │                                                           │     │
│  │  Or enter custom: [ 21 ] days                            │     │
│  │  Min: 7 days   Max: 180 days                             │     │
│  └───────────────────────────────────────────────────────────┘     │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────┐     │
│  │  INTEREST RATE (calculated based on duration)             │     │
│  │                                                           │     │
│  │  Duration    │  APY      │  30-day interest on ₹1000     │     │
│  │  ────────────┼───────────┼────────────────────────        │     │
│  │  7 days      │  12%      │  ₹9.86                        │     │
│  │  14 days     │  10%      │  ₹8.22                        │     │
│  │  30 days     │  8%       │  ₹6.58 ← YOUR RATE            │     │
│  │  60 days     │  7%       │  ₹5.75                        │     │
│  │  90 days     │  6%       │  ₹4.93                        │     │
│  └───────────────────────────────────────────────────────────┘     │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────┐     │
│  │  MAX LTV (adjusts collateral requirement)                 │     │
│  │                                                           │     │
│  │  50%   55%   60%   65%   70%   75%                       │     │
│  │                     ↑                                     │     │
│  │              selected: 65%                                │     │
│  │                                                           │     │
│  │  Higher LTV = Less collateral needed, higher risk        │     │
│  │  Lower LTV = More collateral needed, safer               │     │
│  └───────────────────────────────────────────────────────────┘     │
│                                                                     │
│  Your custom loan: 14 days, 10% APY, 65% max LTV                   │
│                                                                     │
│                                          [  Apply Settings  ]       │
└─────────────────────────────────────────────────────────────────────┘
```

### React Component Implementation

```jsx
// LoanCreationWizard.jsx
import { useState } from 'react';

const LOAN_TYPES = [
  { id: 'short', name: 'Short Term', icon: '⚡', duration: 7, rate: 12, maxLtv: 70 },
  { id: 'standard', name: 'Standard', icon: '📊', duration: 30, rate: 8, maxLtv: 75, recommended: true },
  { id: 'long', name: 'Long Term', icon: '🏦', duration: 90, rate: 6, maxLtv: 65 },
  { id: 'custom', name: 'Custom', icon: '⚙️', duration: null, rate: null, maxLtv: null },
];

const LoanCreationWizard = ({ onComplete }) => {
  const [step, setStep] = useState(1);
  const [loanType, setLoanType] = useState(null);
  const [borrowAmount, setBorrowAmount] = useState(500);
  const [ltvRatio, setLtvRatio] = useState(60);
  const [customDuration, setCustomDuration] = useState(30);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  
  const selectedType = LOAN_TYPES.find(t => t.id === loanType);
  
  const calculateLoanDetails = () => {
    const duration = selectedType?.duration || customDuration;
    const rate = selectedType?.rate || calculateRateForDuration(customDuration);
    const collateralNeeded = borrowAmount / (ltvRatio / 100);
    const healthFactor = (collateralNeeded * 0.85) / borrowAmount;
    const interestEstimate = borrowAmount * (rate / 100) * (duration / 365);
    
    return { duration, rate, collateralNeeded, healthFactor, interestEstimate };
  };
  
  return (
    <div className="bg-black/40 backdrop-blur-xl rounded-3xl p-8 border border-white/10">
      {/* Progress Steps */}
      <div className="flex justify-center mb-8">
        {[1, 2, 3].map(s => (
          <div key={s} className="flex items-center">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center 
              ${step >= s ? 'bg-purple-500' : 'bg-white/10'}`}>
              {s}
            </div>
            {s < 3 && <div className={`w-20 h-1 ${step > s ? 'bg-purple-500' : 'bg-white/10'}`} />}
          </div>
        ))}
      </div>
      
      {/* Step 1: Select Type */}
      {step === 1 && (
        <div>
          <h2 className="text-2xl font-bold mb-6 text-center">Select Loan Type</h2>
          <div className="grid grid-cols-2 gap-4">
            {LOAN_TYPES.map(type => (
              <button
                key={type.id}
                onClick={() => setLoanType(type.id)}
                className={`p-6 rounded-2xl border-2 text-left transition-all
                  ${loanType === type.id 
                    ? 'border-purple-500 bg-purple-500/20' 
                    : 'border-white/10 hover:border-white/30'}`}
              >
                <div className="text-3xl mb-2">{type.icon}</div>
                <div className="font-bold text-lg">{type.name}</div>
                {type.recommended && (
                  <span className="text-xs bg-purple-500 px-2 py-1 rounded">RECOMMENDED</span>
                )}
                {type.duration && (
                  <div className="text-sm text-gray-400 mt-2">
                    {type.duration} days • {type.rate}% APY • {type.maxLtv}% LTV
                  </div>
                )}
              </button>
            ))}
          </div>
          
          <button
            onClick={() => setStep(2)}
            disabled={!loanType}
            className="w-full mt-6 py-4 bg-purple-500 rounded-xl font-bold disabled:opacity-50"
          >
            Next: Set Amount →
          </button>
        </div>
      )}
      
      {/* Step 2: Amount & LTV */}
      {step === 2 && (
        <div>
          <h2 className="text-2xl font-bold mb-6 text-center">Set Loan Amount</h2>
          
          {/* Amount Slider */}
          <div className="mb-8">
            <label className="block text-gray-400 mb-2">Borrow Amount (₹)</label>
            <input
              type="range"
              min="100"
              max="10000"
              step="100"
              value={borrowAmount}
              onChange={(e) => setBorrowAmount(Number(e.target.value))}
              className="w-full"
            />
            <div className="text-3xl font-bold text-center mt-2">₹{borrowAmount}</div>
          </div>
          
          {/* LTV Slider */}
          <div className="mb-8">
            <label className="block text-gray-400 mb-2">LTV Ratio (Loan-to-Value)</label>
            <input
              type="range"
              min="50"
              max={selectedType?.maxLtv || 75}
              step="5"
              value={ltvRatio}
              onChange={(e) => setLtvRatio(Number(e.target.value))}
              className="w-full"
            />
            <div className="flex justify-between text-sm text-gray-400">
              <span>50% (Safer)</span>
              <span className="font-bold text-white">{ltvRatio}%</span>
              <span>{selectedType?.maxLtv || 75}% (Riskier)</span>
            </div>
          </div>
          
          {/* Calculated Values */}
          <div className="bg-white/5 rounded-xl p-4 mb-6">
            {(() => {
              const details = calculateLoanDetails();
              return (
                <>
                  <div className="flex justify-between mb-2">
                    <span className="text-gray-400">Collateral needed</span>
                    <span>₹{details.collateralNeeded.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between mb-2">
                    <span className="text-gray-400">Health Factor</span>
                    <span className={details.healthFactor > 1.5 ? 'text-green-400' : 'text-yellow-400'}>
                      {details.healthFactor.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Est. Interest ({details.duration}d)</span>
                    <span>₹{details.interestEstimate.toFixed(2)}</span>
                  </div>
                </>
              );
            })()}
          </div>
          
          <div className="flex gap-4">
            <button onClick={() => setStep(1)} className="flex-1 py-4 bg-white/10 rounded-xl">
              ← Back
            </button>
            <button onClick={() => setStep(3)} className="flex-1 py-4 bg-purple-500 rounded-xl font-bold">
              Next: Review →
            </button>
          </div>
        </div>
      )}
      
      {/* Step 3: Review */}
      {step === 3 && (
        <div>
          <h2 className="text-2xl font-bold mb-6 text-center">Review & Confirm</h2>
          
          {/* Summary */}
          <div className="bg-white/5 rounded-xl p-6 mb-6">
            {(() => {
              const details = calculateLoanDetails();
              return (
                <>
                  <h3 className="font-bold mb-4">Loan Summary</h3>
                  <div className="grid grid-cols-2 gap-4 mb-4">
                    <div>
                      <div className="text-gray-400 text-sm">You Provide</div>
                      <div className="text-xl font-bold">
                        {(details.collateralNeeded / 18.92).toFixed(2)} XLM
                      </div>
                      <div className="text-sm text-gray-400">₹{details.collateralNeeded.toFixed(0)}</div>
                    </div>
                    <div>
                      <div className="text-gray-400 text-sm">You Receive</div>
                      <div className="text-xl font-bold">
                        {(borrowAmount / 188.5).toFixed(2)} PAS
                      </div>
                      <div className="text-sm text-gray-400">₹{borrowAmount}</div>
                    </div>
                  </div>
                  <div className="border-t border-white/10 pt-4">
                    <div className="flex justify-between mb-2">
                      <span>Duration</span>
                      <span>{details.duration} days</span>
                    </div>
                    <div className="flex justify-between mb-2">
                      <span>Interest Rate</span>
                      <span>{details.rate}% APY</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Total to Repay</span>
                      <span className="font-bold">₹{(borrowAmount + details.interestEstimate).toFixed(2)}</span>
                    </div>
                  </div>
                </>
              );
            })()}
          </div>
          
          {/* Terms */}
          <label className="flex items-start gap-3 mb-6 cursor-pointer">
            <input
              type="checkbox"
              checked={acceptedTerms}
              onChange={(e) => setAcceptedTerms(e.target.checked)}
              className="mt-1"
            />
            <span className="text-sm text-gray-400">
              I understand that my collateral may be liquidated if the health factor drops below 1.0 
              or if I fail to repay within 7 days after the deadline. A 10% liquidation penalty 
              and 2%/day late fees may apply.
            </span>
          </label>
          
          <div className="flex gap-4">
            <button onClick={() => setStep(2)} className="flex-1 py-4 bg-white/10 rounded-xl">
              ← Back
            </button>
            <button 
              onClick={() => onComplete(calculateLoanDetails())}
              disabled={!acceptedTerms}
              className="flex-1 py-4 bg-gradient-to-r from-purple-500 to-pink-500 rounded-xl font-bold disabled:opacity-50"
            >
              🔒 Lock XLM & Borrow PAS
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default LoanCreationWizard;
```

### Interest Rate Calculation Based on Duration

```javascript
// utils/loanCalculations.js
function calculateRateForDuration(days) {
  // Longer duration = lower rate (reward for longer commitment)
  // Shorter duration = higher rate (premium for quick liquidity)
  
  const rateMap = [
    { maxDays: 7, rate: 12 },
    { maxDays: 14, rate: 10 },
    { maxDays: 30, rate: 8 },
    { maxDays: 60, rate: 7 },
    { maxDays: 90, rate: 6 },
    { maxDays: 180, rate: 5.5 },
  ];
  
  for (const tier of rateMap) {
    if (days <= tier.maxDays) {
      return tier.rate;
    }
  }
  
  return 5; // Default for very long loans
}
```

---

## 📱 Updated Dashboard UI

### Loan Card Component

```jsx
// LoanCard.jsx
const LoanCard = ({ loan }) => {
  const health = useLoanHealth(loan.id);
  const deadline = useDeadline(loan.repayment_deadline);
  
  return (
    <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
      {/* Header */}
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-bold">Loan #{loan.id.slice(0, 8)}</h3>
        <HealthFactorBadge healthFactor={health.factor} />
      </div>
      
      {/* Collateral & Debt */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div className="bg-blue-500/10 rounded-xl p-4">
          <p className="text-gray-400 text-sm">Collateral</p>
          <p className="text-xl font-bold">{loan.collateral_xlm} XLM</p>
          <p className="text-sm text-gray-400">≈ ₹{loan.collateral_value_inr}</p>
        </div>
        <div className="bg-purple-500/10 rounded-xl p-4">
          <p className="text-gray-400 text-sm">Borrowed</p>
          <p className="text-xl font-bold">{loan.borrowed_pas} PAS</p>
          <p className="text-sm text-gray-400">≈ ₹{loan.borrowed_value_inr}</p>
        </div>
      </div>
      
      {/* Interest & Total */}
      <div className="bg-black/30 rounded-xl p-4 mb-4">
        <div className="flex justify-between mb-2">
          <span className="text-gray-400">Principal</span>
          <span>₹{loan.borrowed_value_inr}</span>
        </div>
        <div className="flex justify-between mb-2">
          <span className="text-gray-400">Interest ({BORROW_APY * 100}% APY)</span>
          <span className="text-yellow-400">₹{loan.interest_accrued}</span>
        </div>
        {loan.late_fee > 0 && (
          <div className="flex justify-between mb-2">
            <span className="text-red-400">Late Fee</span>
            <span className="text-red-400">₹{loan.late_fee}</span>
          </div>
        )}
        <div className="border-t border-white/10 pt-2 flex justify-between font-bold">
          <span>Total Due</span>
          <span>₹{loan.total_due}</span>
        </div>
      </div>
      
      {/* Deadline */}
      <DeadlineIndicator 
        deadline={loan.repayment_deadline}
        isOverdue={deadline.isOverdue}
        daysLeft={deadline.daysLeft}
      />
      
      {/* Liquidation Warning */}
      {health.factor < 1.2 && (
        <div className="bg-red-500/20 border border-red-500/50 rounded-xl p-4 mb-4">
          <p className="text-red-400 font-bold">⚠️ Liquidation Risk</p>
          <p className="text-sm text-gray-300">
            If XLM drops to ₹{health.liquidationPrice}, your collateral will be liquidated.
          </p>
        </div>
      )}
      
      {/* Actions */}
      <div className="flex gap-3">
        <button className="flex-1 py-3 bg-green-500 text-black font-bold rounded-xl">
          Repay ₹{loan.total_due}
        </button>
        <button className="flex-1 py-3 bg-blue-500 text-white font-bold rounded-xl">
          Add Collateral
        </button>
      </div>
    </div>
  );
};
```

---

## 🔄 Implementation Phases

### Phase 1: Database & Core Logic (2-3 days)
- [ ] Update database schema
- [ ] Implement LTV calculation
- [ ] Implement health factor calculation
- [ ] Update borrow endpoint with collateral requirements

### Phase 2: Interest System (1-2 days)
- [ ] Implement interest calculation
- [ ] Create daily interest accrual job
- [ ] Add interest to repayment flow

### Phase 3: Liquidation System (2-3 days)
- [ ] Create liquidation bot
- [ ] Implement liquidation logic
- [ ] Add liquidation penalty distribution
- [ ] Create liquidation events table

### Phase 4: Deadlines & Late Fees (1-2 days)
- [ ] Add deadline to loans
- [ ] Implement late fee calculation
- [ ] Add force-liquidation after max late days

### Phase 5: Frontend Updates (2-3 days)
- [ ] Update Dashboard with new loan cards
- [ ] Add health factor badge
- [ ] Add deadline indicators
- [ ] Add collateral management UI
- [ ] Add repayment with interest UI

### Phase 6: Notifications (1 day)
- [ ] Email notifications for health warnings
- [ ] Deadline reminders
- [ ] Liquidation notifications

---

## 🧪 Testing Scenarios

### Test 1: Normal Loan Flow
```
1. User deposits ₹1,000 XLM collateral
2. User borrows ₹750 PAS (75% LTV)
3. 15 days pass, interest = ₹2.47
4. User repays ₹752.47
5. Collateral returned ✅
```

### Test 2: Liquidation via Price Drop
```
1. User deposits ₹1,000 XLM collateral
2. User borrows ₹750 PAS
3. XLM price drops 25%
4. Health factor drops to 0.92
5. Auto-liquidation triggers
6. User receives remaining collateral after penalty
```

### Test 3: Deadline Liquidation
```
1. User deposits ₹1,000 XLM collateral
2. User borrows ₹750 PAS
3. 30 days pass (deadline)
4. 7 more days (max late)
5. Force liquidation regardless of health
6. Late fees + penalty applied
```

---

## 📊 Revenue Model

| Source | Rate | Example |
|--------|------|---------|
| Borrow Interest | 8% APY | ₹750 loan × 8% × 30 days = ₹4.93 |
| Liquidation Penalty | 10% | ₹760 debt × 10% = ₹76 (protocol gets 70% = ₹53) |
| Late Fees | 2%/day | ₹770 × 2% × 5 days = ₹77 |

---

## 🚀 Future Enhancements

1. **Variable Interest Rates** - Based on utilization
2. **Flash Loans** - Uncollateralized instant loans
3. **Governance Token** - For protocol decisions
4. **Insurance Fund** - To cover bad debt
5. **Multi-collateral** - Support more assets
6. **Yield Farming** - Rewards for liquidity providers
