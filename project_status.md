# 🌉 Polar Bridge - Project Status & Documentation

## 📋 Project Overview

**Polar Bridge** is a custodial crypto exchange enabling Indian users to:
1. Deposit INR via Razorpay → Buy PAS tokens on Paseo Asset Hub
2. View real-time PAS balance from blockchain
3. Track purchases and wallet balance via Supabase

---

## 📊 Overall Progress: ~85% Complete

| Category | Progress | Status |
|----------|----------|--------|
| Smart Contracts | 100% | ✅ Complete |
| Backend/API | 95% | ✅ Complete |
| Frontend | 85% | ✅ Mostly Complete |
| Database | 100% | ✅ Complete |
| Bridge Logic | 70% | ⚠️ Needs E2E Testing |

---

## ✅ Completed Components

### Smart Contracts

| Component | Network | Address/ID | Status |
|-----------|---------|------------|--------|
| **Soroban Vault V2** | Stellar Testnet | `CDI75PQ4EA2VBTT7W6EZN2RGJIS4CFDMGT7WJ4L42T4ZSTNEKY42NY2B` | ✅ Deployed & Initialized |
| **EVM Pool** | Paseo Asset Hub (420420422) | `0x49e12e876588052A977dB816107B1772B4103E3e` | ✅ Deployed |
| **ink! Pool** | Substrate | Compiled, not deployed | ⚠️ Optional |

### Contract Features Implemented

| Feature | Stellar Vault V2 | EVM Pool | ink! Pool |
|---------|------------------|----------|-----------|
| Lock Collateral | ✅ `lock(from, amount, evm_address)` | ✅ `fund()` | ✅ `fund()` |
| Release Liquidity | ✅ `release(to, amount)` | ✅ `releaseLiquidity()` | ✅ `release_liquidity()` |
| Unlock Collateral | ✅ `unlock(to, amount)` | - | - |
| Admin Control | ✅ | ✅ | ✅ |
| Event Emission | ✅ `lock` event with EVM address | ✅ `FundsReceived` | ✅ `FundsReceived` |
| Balance Query | ✅ `get_locked_balance()`, `get_total_locked()` | ✅ `getBalance()` | ✅ `get_balance()` |

### Pool Balances (Funded)

| Pool | Balance | Status |
|------|---------|--------|
| Stellar Vault | 200 XLM | ✅ Funded |
| EVM Pool | 1.0 PAS | ✅ Funded |

### Admin Wallets

| Network | Admin Address |
|---------|--------------|
| Stellar | `GBXLFRL35YDKSDMJJ2TT7VW25I7C7B76RKFYCB6FMIXWEAMAX3GESCN3` |
| Paseo Asset Hub | `0xe8cb3F3BA7C674B6fb3C5B3cBe572964a5569D53` |
| Polkadot | `5HQk4ZLKzZykLNV4YkoMEzVUG1Hu6QEtaQFvnnfFprUuYtSK` |

### Relayer

| Feature | Status |
|---------|--------|
| Express API Server | ✅ Running on port 3000 |
| Razorpay Integration | ✅ Create order + Verify payment |
| Supabase Integration | ✅ User wallets, stakes, purchases |
| Real PAS Balance (ethers.js) | ✅ From Paseo Asset Hub |
| Exchange Rates (CoinGecko) | ✅ DOT→INR (shown as PAS) |
| Stellar Event Listener | ✅ Implemented |
| EVM Event Listener (Polling) | ✅ Implemented |
| Buy PAS Flow | ✅ INR → Lock XLM → Release PAS |
| Bidirectional Bridge | ✅ Implemented |

### Frontend (React + Vite)

| Feature | Status |
|---------|--------|
| Landing Page | ✅ Complete |
| Dashboard Page | ✅ Complete |
| MetaMask Wallet Connection | ✅ Complete |
| Real PAS Balance Display | ✅ From blockchain |
| INR Wallet Balance | ✅ From Supabase |
| Razorpay Payment | ✅ Add funds flow |
| Buy PAS UI | ✅ Complete |
| Exchange Rate Display | ✅ Real-time DOT/INR |
| Loading Shimmer States | ✅ Complete |
| Stakes History Table | ✅ Complete |
| Notification Modal | ✅ Complete |

### Database (Supabase)

| Table | Status |
|-------|--------|
| wallets | ✅ wallet_address, balance_inr |
| stakes | ✅ amount_inr, amount_pas, status |
| crypto_purchases | ✅ Full purchase tracking |

---

## ❌ Remaining Work

### High Priority

| Task | Description | Status |
|------|-------------|--------|
| 1. Update Relayer for EVM | Add Paseo Asset Hub support | ✅ Done |
| 2. Fund Both Pools | Deposit liquidity | ✅ Done |
| 3. Create .env files | Add all secret keys | ✅ Done |
| 4. Razorpay Integration | Payment flow | ✅ Done |
| 5. Frontend Dashboard | React UI | ✅ Done |
| 6. Real PAS Balance | From blockchain | ✅ Done |
| 7. Exchange Rates | CoinGecko API | ✅ Done |
| 8. **Test End-to-End Bridge** | Lock XLM → Get PAS | ⚠️ Pending |

### Medium Priority

| Task | Description | Status |
|------|-------------|--------|
| Error Handling | Retry logic, crash recovery | ⚠️ Basic |
| Nonce/Replay Protection | Prevent double-spending | ⚠️ Partial |
| Production Deployment | Mainnet contracts | ❌ Not Started |

### Low Priority (Optional)

| Task | Description | Status |
|------|-------------|--------|
| Deploy ink! Pool | Deploy to Substrate chain | ❌ Optional |
| Multi-token Support | Support multiple tokens | ❌ Future |
| Freighter Wallet | Stellar wallet integration | ❌ Future |

---

## 🔄 System Architecture Flowcharts

### Flow 1: INR Deposit via Razorpay → Crypto on Stellar

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     RAZORPAY INR → STELLAR XLM FLOW                         │
└─────────────────────────────────────────────────────────────────────────────┘

┌──────────┐      ┌──────────────┐      ┌─────────────┐      ┌──────────────┐
│   USER   │      │   FRONTEND   │      │  RAZORPAY   │      │   RELAYER    │
│          │      │   (React)    │      │   SERVER    │      │  (Node.js)   │
└────┬─────┘      └──────┬───────┘      └──────┬──────┘      └──────┬───────┘
     │                   │                     │                    │
     │  1. Click "Add    │                     │                    │
     │     Funds"        │                     │                    │
     │──────────────────>│                     │                    │
     │                   │                     │                    │
     │                   │  2. Open Razorpay   │                    │
     │                   │     Checkout        │                    │
     │                   │────────────────────>│                    │
     │                   │                     │                    │
     │  3. Enter Card    │                     │                    │
     │     Details       │                     │                    │
     │─────────────────────────────────────────>                    │
     │                   │                     │                    │
     │                   │     4. Payment      │                    │
     │                   │        Success      │                    │
     │                   │<────────────────────│                    │
     │                   │                     │                    │
     │                   │                     │  5. Webhook POST   │
     │                   │                     │     /razorpay      │
     │                   │                     │────────────────────>
     │                   │                     │                    │
     │                   │                     │     ┌──────────────┴──────────────┐
     │                   │                     │     │  6. Verify Webhook Sig      │
     │                   │                     │     │  7. Calculate XLM Amount    │
     │                   │                     │     │     (INR / Exchange Rate)   │
     │                   │                     │     │  8. Load Stellar Admin Key  │
     │                   │                     │     └──────────────┬──────────────┘
     │                   │                     │                    │
     │                   │                     │                    │
     │                   │                     │      ┌─────────────▼─────────────┐
     │                   │                     │      │      STELLAR NETWORK      │
     │                   │                     │      │  9. Send XLM to User's    │
     │                   │                     │      │     Freighter Address     │
     │                   │                     │      └─────────────┬─────────────┘
     │                   │                     │                    │
     │  10. Balance      │                     │                    │
     │      Updated!     │                     │                    │
     │<──────────────────────────────────────────────────────────────
     │                   │                     │                    │
     ▼                   ▼                     ▼                    ▼
```

### Flow 2: Lock XLM on Stellar → Get PAS on Paseo Asset Hub

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    STELLAR → PASEO ASSET HUB BRIDGE FLOW                    │
└─────────────────────────────────────────────────────────────────────────────┘

┌──────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────────────────┐
│   USER   │    │   STELLAR    │    │   RELAYER    │    │ PASEO ASSET HUB  │
│          │    │    VAULT     │    │  (Node.js)   │    │      POOL        │
└────┬─────┘    └──────┬───────┘    └──────┬───────┘    └────────┬─────────┘
     │                 │                   │                     │
     │  1. deposit()   │                   │                     │
     │     with        │                   │                     │
     │     EVM addr    │                   │                     │
     │────────────────>│                   │                     │
     │                 │                   │                     │
     │                 │  2. Lock XLM      │                     │
     │                 │     in contract   │                     │
     │                 │                   │                     │
     │                 │  3. Emit "lock"   │                     │
     │                 │     event with    │                     │
     │                 │     EVM address   │                     │
     │                 │──────────────────>│                     │
     │                 │                   │                     │
     │                 │                   │  4. Parse event     │
     │                 │                   │     - EVM address   │
     │                 │                   │     - Amount        │
     │                 │                   │                     │
     │                 │                   │  5. Calculate       │
     │                 │                   │     loan amount     │
     │                 │                   │     (75% LTV)       │
     │                 │                   │                     │
     │                 │                   │  6. releaseLiquidity│
     │                 │                   │     (to, amount)    │
     │                 │                   │────────────────────>│
     │                 │                   │                     │
     │                 │                   │                     │ 7. Transfer PAS
     │                 │                   │                     │    to user
     │                 │                   │                     │
     │  8. PAS received in MetaMask!       │                     │
     │<───────────────────────────────────────────────────────────
     │                 │                   │                     │
     ▼                 ▼                   ▼                     ▼
```

### Flow 3: Lock PAS on Paseo Asset Hub → Get XLM on Stellar

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    PASEO ASSET HUB → STELLAR BRIDGE FLOW                    │
└─────────────────────────────────────────────────────────────────────────────┘

┌──────────┐    ┌──────────────────┐    ┌──────────────┐    ┌──────────────┐
│   USER   │    │ PASEO ASSET HUB  │    │   RELAYER    │    │   STELLAR    │
│          │    │      POOL        │    │  (Node.js)   │    │    VAULT     │
└────┬─────┘    └────────┬─────────┘    └──────┬───────┘    └──────┬───────┘
     │                   │                     │                   │
     │  1. fund() with   │                     │                   │
     │     Stellar addr  │                     │                   │
     │     in tx data    │                     │                   │
     │──────────────────>│                     │                   │
     │                   │                     │                   │
     │                   │  2. Lock PAS        │                   │
     │                   │     in contract     │                   │
     │                   │                     │                   │
     │                   │  3. Emit            │                   │
     │                   │   "FundsReceived"   │                   │
     │                   │     event           │                   │
     │                   │────────────────────>│                   │
     │                   │                     │                   │
     │                   │                     │  4. Parse event   │
     │                   │                     │  - Stellar addr   │
     │                   │                     │  - Amount         │
     │                   │                     │                   │
     │                   │                     │  5. Calculate     │
     │                   │                     │     XLM amount    │
     │                   │                     │     (75% LTV)     │
     │                   │                     │                   │
     │                   │                     │  6. Transfer XLM  │
     │                   │                     │     to user       │
     │                   │                     │─────────────────> │
     │                   │                     │                   │
     │  7. XLM received in Freighter!          │                   │
     │<─────────────────────────────────────────────────────────────
     │                   │                     │                   │
     ▼                   ▼                     ▼                   ▼
```

### Complete System Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           POLAR BRIDGE ARCHITECTURE                              │
└─────────────────────────────────────────────────────────────────────────────────┘

                              ┌─────────────────┐
                              │    RAZORPAY     │
                              │   (INR Fiat)    │
                              └────────┬────────┘
                                       │ Webhook
                                       ▼
┌─────────────────┐           ┌─────────────────┐           ┌─────────────────┐
│                 │           │                 │           │                 │
│  STELLAR        │◄─────────►│    RELAYER      │◄─────────►│  PASEO         │
│  TESTNET        │  Events   │   (Node.js)     │  Events   │  ASSET HUB     │
│                 │           │                 │           │  (EVM)          │
│ ┌─────────────┐ │           │  • Event Loop   │           │ ┌─────────────┐ │
│ │ Soroban     │ │           │  • TX Signing   │           │ │ PolkaBridge │ │
│ │ Vault       │ │           │  • LTV Calc     │           │ │ Pool        │ │
│ │             │ │           │  • Deduplication│           │ │             │ │
│ │ - deposit() │ │           │                 │           │ │ - fund()    │ │
│ │ - unlock()  │ │           └─────────────────┘           │ │ - release() │ │
│ └─────────────┘ │                    ▲                    │ └─────────────┘ │
│                 │                    │                    │                 │
└────────┬────────┘                    │                    └────────┬────────┘
         │                             │                             │
         │         ┌───────────────────┴───────────────────┐         │
         │         │            FRONTEND (React)           │         │
         │         │                                       │         │
         └────────►│  • Freighter Wallet (Stellar)         │◄────────┘
                   │  • MetaMask Wallet (EVM)              │
                   │  • Razorpay Checkout                  │
                   │  • Dashboard UI                       │
                   └───────────────────────────────────────┘
                                       ▲
                                       │
                                  ┌────┴────┐
                                  │  USER   │
                                  └─────────┘
```

---

## 📁 Project File Structure

```
polar/
├── contracts/
│   ├── soroban-vault/           # ✅ Stellar Vault Contract
│   │   ├── src/lib.rs           # ✅ Contract implementation
│   │   ├── Cargo.toml           # ✅ Dependencies
│   │   ├── contract_id.txt      # ✅ Deployed addresses
│   │   └── .env.example         # ✅ 
│   │
│   ├── evm-pool/                # ✅ Paseo Asset Hub EVM Pool
│   │   └── PolkaBridgePool.sol  # ✅ Deployed
│   │
│   ├── ink-pool/                # ⚠️ Optional Substrate Pool
│   │   ├── lib.rs               # ✅ Compiled
│   │   └── Cargo.toml           # ✅ 
│   │
│   └── .env.example             # ✅
│
├── relayer/
│   ├── src/
│   │   ├── routes.js            # ✅ Main API server (port 3000)
│   │   ├── index.js             # ✅ Event listeners
│   │   └── check-balance.js     # ✅ Utility
│   ├── test/                    # ✅ Test scripts
│   ├── package.json             # ✅ Dependencies
│   └── .env.example             # ✅
│
├── frontend/
│   ├── src/
│   │   ├── pages/
│   │   │   ├── Landing.jsx      # ✅ Landing page
│   │   │   └── Dashboard.jsx    # ✅ Main dashboard
│   │   ├── components/
│   │   │   ├── StatCard.jsx     # ✅ With loading shimmer
│   │   │   ├── NotificationModal.jsx # ✅
│   │   │   ├── InteractiveBackground.jsx # ✅
│   │   │   └── BridgeAnimation.jsx # ✅
│   │   ├── hooks/
│   │   │   └── useWallet.js     # ✅ MetaMask + Supabase + API
│   │   └── lib/
│   │       └── supabase.js      # ✅ All Supabase functions
│   ├── supabase-schema.sql      # ✅ Database schema
│   ├── package.json             # ✅
│   └── .env.example             # ✅
│
└── project_status.md            # 📄 This file
```

---

## 🔧 Environment Configuration

Create `/relayer/.env`:

```bash
# Stellar Configuration
STELLAR_RPC_URL=https://soroban-testnet.stellar.org
VAULT_CONTRACT_ID=CC6EIPVGWIIRI73VCJ3VJYLKMQGK7VBKAML5W5GVGZMFLATRYZICJ26A
STELLAR_ADMIN=GBXLFRL35YDKSDMJJ2TT7VW25I7C7B76RKFYCB6FMIXWEAMAX3GESCN3
STELLAR_RELAYER_SECRET=S...  # Get from Freighter

# Paseo Asset Hub EVM Configuration
PASEO_RPC_URL=https://testnet-passet-hub-eth-rpc.polkadot.io
EVM_POOL_ADDRESS=0x49e12e876588052A977dB816107B1772B4103E3e
EVM_ADMIN=0xe8cb3F3BA7C674B6fb3C5B3cBe572964a5569D53
EVM_RELAYER_PRIVATE_KEY=0x...  # Get from MetaMask

# Razorpay (for INR deposits)
RAZORPAY_KEY_ID=rzp_test_...
RAZORPAY_KEY_SECRET=...
RAZORPAY_WEBHOOK_SECRET=...

# Token
STELLAR_TOKEN=CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC
```

---

## 🚀 API Endpoints (port 3000)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/create-order` | POST | Create Razorpay order |
| `/verify-payment` | POST | Verify Razorpay payment |
| `/api/rates` | GET | Get PAS/INR exchange rate (from DOT) |
| `/api/wallet/:userId` | GET | Get user's INR balance |
| `/api/purchases/:userId` | GET | Get purchase history |
| `/api/pas-balance/:address` | GET | Get real PAS balance from Paseo |
| `/api/buy-pas` | POST | Buy PAS tokens with INR |
| `/api/purchase-completed` | POST | Webhook for relayer |
| `/api/test/add-balance` | POST | [TEST] Add INR to wallet |

---

## 🚀 Quick Start

```bash
# Start Backend
cd relayer && npm start

# Start Frontend (separate terminal)
cd frontend && npm run dev
```

---

## 🚀 Next Steps (In Order)

1. **Test Full Buy PAS Flow** - Add INR → Buy PAS → Check balance
2. **Test Bridge** - Lock XLM on Stellar → Get PAS on Paseo
3. **Add Error Handling** - Better error messages in UI
4. **Production Deploy** - Deploy to mainnet (optional)

---

## 📞 Quick Commands

```bash
# Fund EVM Pool (send PAS via Remix or MetaMask)
# Go to: https://remix.ethereum.org
# Load PolkaBridgePool at 0x49e12e876588052A977dB816107B1772B4103E3e
# Call fund() with value

# Check EVM Pool Balance
cast call 0x49e12e876588052A977dB816107B1772B4103E3e "getBalance()" --rpc-url https://testnet-passet-hub-eth-rpc.polkadot.io

# Run Relayer
cd relayer && npm start
```
