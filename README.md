# 🌉 Polar Bridge - Cross-Chain DeFi Lending Protocol

## 🎯 Overview

**Project Name:** Polar Bridge

**Tagline:** A cross-chain collateralized lending protocol enabling users to borrow PAS tokens (Paseo Asset Hub) by locking Fiat Currency (INR) as collateral.

**Description:**

Polar Bridge allows users to:
1. **Add INR funds** via Razorpay (UPI, Card, NetBanking)
2. **Create collateralized loans** - Lock INR indirectly to borrow PAS tokens
3. **Manage loans** - Monitor health factor, repay, add collateral
4. **Auto-liquidation** - Positions are liquidated if health factor drops below 1.0

# 👥 Team Information

**Team Name:** Polar

**Team Members:**
- [Abhijith Sogal](https://github.com/sogalabhi) - [Web 3 Developer]
- [Ammar Mufeez](https://github.com/ammar41104) - [Web 2 Developer]

## 🛠️ Technologies Used

- **Frontend**: React + Vite + TailwindCSS + Framer Motion
- **Backend**: Node.js + Express
- **Database**: Supabase (PostgreSQL)
- **Blockchains**: 
  - Stellar (Soroban) - XLM collateral vault
  - Paseo Asset Hub (EVM) - PAS token pool
- **Other tools**: Razorpay, COINGECKO_API

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                    POLAR BRIDGE ARCHITECTURE                         │
└─────────────────────────────────────────────────────────────────────┘

┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Frontend   │────▶│   Relayer    │────▶│  Blockchain  │
│   (React)    │     │  (Express)   │     │   Stellar    │
└──────────────┘     └──────────────┘     │   Paseo EVM  │
       │                    │             └──────────────┘
       │                    │
       ▼                    ▼
┌──────────────┐     ┌──────────────┐
│   Supabase   │     │  Liquidation │
│  (Database)  │     │     Bot      │
└──────────────┘     └──────────────┘
```

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- MetaMask wallet
- Supabase account

### 1. Clone & Install

```bash
git clone https://github.com/sogalabhi/polar.git
cd polar

# Install frontend
cd frontend && npm install

# Install relayer
cd ../relayer && npm install
```

### 2. Environment Setup

**Frontend** (`frontend/.env`):
```env
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_key
```

**Relayer** (`relayer/.env`):
```env
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_key
STELLAR_RPC_URL=https://soroban-testnet.stellar.org
STELLAR_RELAYER_SECRET=your_stellar_secret
VAULT_CONTRACT_ID=your_vault_contract_id
EVM_RELAYER_PRIVATE_KEY=your_evm_private_key
EVM_POOL_ADDRESS=your_pool_address
RAZORPAY_KEY_ID=your_razorpay_key
RAZORPAY_KEY_SECRET=your_razorpay_secret
```

### 3. Database Setup

Run migrations in Supabase SQL Editor:
```bash
# In order:
relayer/migrations/001_lending_schema.sql
relayer/migrations/002_lending_loans_table.sql
```

### 4. Start Development

```bash
# Terminal 1: Frontend
cd frontend && npm run dev

# Terminal 2: Relayer API
cd relayer && npm start

# Terminal 3: Event Listener (optional)
cd relayer && node src/index.js
```

## 📊 Lending Protocol Features

| Feature | Value |
|---------|-------|
| Max LTV | 75% |
| Liquidation Threshold | 85% |
| Interest Rates | 6-12% APY (duration-based) |
| Loan Durations | 7, 30, 90 days |
| Liquidation Penalty | 10% |
| Late Fee | 2% per day |
| Grace Period | 3 days |

### Loan Types
- **Short Term** (7 days): 12% APY, 70% max LTV
- **Standard** (30 days): 8% APY, 75% max LTV  
- **Long Term** (90 days): 6% APY, 65% max LTV

### Health Factor
```
Health Factor = (Collateral Value × 0.85) / Total Debt

> 1.5  → 🟢 Safe
1.2-1.5 → 🟡 Moderate
1.0-1.2 → 🟠 At Risk
< 1.0  → 🔴 Liquidation
```

## User Flows

### Creating a Loan
```
1. User connects MetaMask
2. Adds INR funds using rarorpay
3. Selects loan type (Short/Standard/Long)
4. Enters borrow amount in INR
5. Adjusts LTV ratio (50-75%)
6. Reviews terms & accepts
7. Collateral (INR) deducted from wallet
8. XLM locked on Stellar vault
9. PAS sent to user's EVM wallet
```

### Repaying a Loan
```
1. User views active loan
2. Clicks "Repay"
3. Confirms total due (Principal + Interest + Late fees)
4. Sends PAS to pool contract
5. Loan marked as repaid
6. Collateral value credited back to INR wallet
```

### Liquidation (Automatic)
```
1. Liquidation bot monitors health factors
2. If health factor < 1.0 OR deadline + 7 days exceeded
3. Collateral unlocked from Stellar vault
4. 10% penalty applied
5. Remaining collateral returned to user
6. Loan marked as liquidated
```

## 🔐 Smart Contracts

### Stellar Soroban Vault
- Locks XLM as collateral
- Only owner (relayer) can unlock
- Emits lock/unlock events

### Paseo EVM Pool
- Holds PAS liquidity
- `releaseLiquidity(to, amount)` - Send PAS to borrowers
- Only admin can release funds



## 🎯 Use Cases

### 🌟 **Primary USP: INR → PAS in One Click**
**The easiest way for Indian users to access Polkadot ecosystem tokens.** No crypto knowledge needed - just pay with UPI/Card via Razorpay and receive PAS tokens directly in your MetaMask wallet. This is the first fiat-to-Polkadot on-ramp with collateralized lending.

### 1. **Fiat On-Ramp to DeFi**
Indian users can convert INR → XLM collateral → PAS tokens in one seamless flow using Razorpay integration. No need to navigate complex exchanges or bridges.

### 2. **Crypto-Backed Loans Without Selling**
Users who hold INR balance but need liquidity can borrow against their holdings without selling. Lock INR as collateral, receive PAS tokens, and reclaim collateral after repayment.

### 3. **Cross-Chain Liquidity Access**
Bridge value between Stellar and Polkadot ecosystems. Users can access Polkadot-based assets (PAS) without complex bridge operations.

### 4. **Emergency Liquidity**
Quick access to funds without liquidating long-term crypto holdings. Short-term loans (7 days) available for urgent needs.

## 📈 Revenue Model

| Source | Rate |
|--------|------|
| Borrow Interest | 6-12% APY |
| Liquidation Penalty | 10% (70% to protocol) |
| Late Fees | 2% per day |

## 🧪 Testing

```bash
cd relayer/test

# Check wallet balances
node test-check-balance.js

# Test XLM locking on Stellar vault
node test-lock-xlm.js

# Test XLM unlocking from vault
node test-unlock-xlm.js

# Test PAS release from EVM pool
node test-release-pas.js

# Check EVM pool status
node test-check-evm-pool.js

# Watch Stellar events
node test-watch-events.js

# Debug event processing
node test-debug-events.js
```

## 🚧 Challenges & Solutions

### 1. **Cross-Chain Event Synchronization**
**Challenge:** Needed to ensure Stellar vault lock events trigger the passet hub contract to send pas tokens.
**Solution:** Built a relayer service that polls Stellar events and maintains a `processed_events.json` ledger to prevent duplicate processing.

### 2. **Health Factor Calculation with Volatile Prices**
**Challenge:** XLM price fluctuations could cause sudden liquidations.
**Solution:** Implemented real-time price feeds and a grace period system (3 days) before liquidation, giving users time to add collateral.

### 3. **Fiat-to-Crypto Bridge Complexity**
**Challenge:** Converting INR payments to on-chain collateral seamlessly.
**Solution:** Integrated Razorpay webhooks that auto-credit user wallets, then convert to XLM collateral at current market rates during loan creation.

### 4. **Database Consistency**
**Challenge:** Supabase used to call the update/create even if the transaction failed
**Solution:** Handled the errors and not call supabase functions. 

## 🔮 Future Improvements

- [ ] **Email/SMS/Discord Notifications** - Alert users when health factor drops below 1.2
- [ ] **Variable Interest Rates** - Dynamic APY based on pool utilization
- [ ] **Governance Token** - Launch POLAR token for protocol governance and fee sharing
- [ ] **Mobile App** - Native iOS/Android app for easier loan management
- [ ] **Partial Repayments** - Allow users to repay loans in installments
- [ ] **Collateral Top-up** - Add more collateral to existing loans to improve health factor
- [ ] **Oracle to get live feeds** - Get the conversion rates from decentralised way and not in this way

## 📄 License

[Specify your license, e.g., MIT, Apache 2.0, etc.]

## 🙏 Acknowledgments

Thanks for all the mentors who helped in the event and the opputunity to build this project.

---

Built for the Polkadot ecosystem 🟣