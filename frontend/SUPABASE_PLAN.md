# Supabase Integration Plan - Frontend

## Overview
Integrate Supabase for user wallet management, INR balance tracking, and staking records.

---

## Database Schema

### Table 1: `wallets`
| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key (auto-generated) |
| `wallet_address` | TEXT | User's EVM wallet address (unique) |
| `balance_inr` | DECIMAL(15,2) | INR balance (default: 0) |
| `created_at` | TIMESTAMP | When user onboarded |
| `updated_at` | TIMESTAMP | Last balance update |

### Table 2: `stakes`
| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key (auto-generated) |
| `wallet_address` | TEXT | User's wallet (foreign key) |
| `amount_inr` | DECIMAL(15,2) | Amount staked in INR |
| `amount_pas` | DECIMAL(18,8) | PAS tokens to receive |
| `exchange_rate` | DECIMAL(15,6) | Rate at time of stake |
| `status` | TEXT | `pending`, `completed`, `paid_back` |
| `stellar_tx_hash` | TEXT | Lock TX on Stellar |
| `evm_tx_hash` | TEXT | Release TX on Paseo |
| `created_at` | TIMESTAMP | When stake was created |
| `paid_back_at` | TIMESTAMP | When stake was returned |

---

## Implementation Phases

### Phase 1: Setup & User Onboarding ✅
- [x] Create Supabase project
- [x] Run SQL to create tables (`supabase-schema.sql`)
- [x] Install `@supabase/supabase-js` in frontend
- [x] Create `supabase.js` config file
- [x] Create `checkOrCreateUser(walletAddress)` function
- [x] Call on wallet connect (in `useWallet.js` hook)

### Phase 2: Add Funds (Razorpay) ✅ (Function Ready)
- [x] Create `addFunds(walletAddress, amount)` function
- [x] Increment `balance_inr` in `wallets` table
- [ ] **TODO: Wire up Razorpay UI component**

### Phase 3: Staking (Buy PAS) ✅ (Function Ready)
- [x] Create `createStake(walletAddress, amountInr, amountPas, rate)` function
- [x] Deduct from `wallets.balance_inr`
- [x] Insert row in `stakes` table with status `pending`
- [x] `updateStakeStatus()` function for completion
- [ ] **TODO: Wire up to stake UI**

### Phase 4: Pay Back (Return Stake) ✅ (Function Ready)
- [x] Create `payBackStake(stakeId, walletAddress)` function
- [x] Add amount back to `wallets.balance_inr`
- [x] Update `stakes.status` to `paid_back`
- [x] Set `stakes.paid_back_at` timestamp
- [ ] **TODO: Wire up to UI**

### Phase 5: Dashboard Queries ✅
- [x] `getWalletBalance(walletAddress)` - Get INR balance
- [x] `getStakeHistory(walletAddress)` - Get all stakes
- [x] `getActiveStakes(walletAddress)` - Get pending/completed stakes
- [x] `getTotalStaked(walletAddress)` - Sum of active stakes
- [x] `getDashboardData(walletAddress)` - All-in-one query
- [ ] **TODO: Build Dashboard UI**

---

## File Structure

```
frontend/
├── src/
│   ├── lib/
│   │   └── supabase.js          # Supabase client & functions
│   ├── hooks/
│   │   └── useWallet.js         # Custom hook for wallet data
│   └── pages/
│       └── Dashboard.jsx        # Uses the queries
```

---

## Current Phase: Phase 1 - Setup & User Onboarding

### Next Steps:
1. Create Supabase project at https://supabase.com
2. Get project URL and anon key
3. Add to frontend `.env`
4. Run the SQL schema
5. Implement the functions

Ready to start? Let me know when you have the Supabase project created!
