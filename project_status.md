# 🌉 Polar Bridge - Project Status & Documentation

## 📋 Project Overview

**Polar Bridge** is a cross-chain liquidity bridge enabling users to:
1. Deposit INR via Razorpay → Receive crypto on Stellar/EVM
2. Lock collateral on Stellar → Get liquidity on Moonbase (EVM)
3. Lock collateral on Moonbase → Get liquidity on Stellar

---

## ✅ Completed Components

### Smart Contracts

| Component | Network | Address/ID | Status |
|-----------|---------|------------|--------|
| **Soroban Vault V2** | Stellar Testnet | `CDI75PQ4EA2VBTT7W6EZN2RGJIS4CFDMGT7WJ4L42T4ZSTNEKY42NY2B` | ✅ Deployed & Initialized |
| **EVM Pool** | Moonbase Alpha (1287) | `0x1Df2Cc6129568a62379f232087F20f5Bc4E37cE6` | ✅ Deployed & Verified |
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
| EVM Pool | 1.0 DEV | ✅ Funded |

### Admin Wallets

| Network | Admin Address |
|---------|---------------|
| Stellar | `GBXLFRL35YDKSDMJJ2TT7VW25I7C7B76RKFYCB6FMIXWEAMAX3GESCN3` |
| Moonbase EVM | `0xe8cb3F3BA7C674B6fb3C5B3cBe572964a5569D53` |
| Polkadot | `5HQk4ZLKzZykLNV4YkoMEzVUG1Hu6QEtaQFvnnfFprUuYtSK` |

### Relayer

| Feature | Status |
|---------|--------|
| Stellar Event Listener | ✅ Implemented |
| EVM Event Listener (Polling) | ✅ Implemented |
| Event Parsing | ✅ Implemented |
| Processed Events Tracking | ✅ Implemented |
| EVM Release (Stellar → EVM) | ✅ Implemented |
| Stellar Release (EVM → Stellar) | ✅ Implemented |
| Bidirectional Bridge | ✅ Implemented |
| **Razorpay Webhook** | ❌ Not Implemented |

---

## ❌ Remaining Work

### High Priority

| Task | Description | Estimated Effort |
|------|-------------|------------------|
| 1. ~~Update Relayer for EVM~~ | ~~Add Moonbase Alpha support~~ | ✅ Done |
| 2. ~~Fund Both Pools~~ | ~~Deposit liquidity~~ | ✅ Done |
| 3. ~~Create .env files~~ | ~~Add all secret keys~~ | ✅ Done |
| 4. **Test End-to-End Bridge** | Lock XLM → Get DEV | 30 min |
| 5. Razorpay Integration | Webhook handler, INR → Crypto | 2-3 hours |

### Medium Priority

| Task | Description | Estimated Effort |
|------|-------------|------------------|
| 6. Frontend Dashboard | React UI for deposits/withdrawals | 4-6 hours |
| 7. Error Handling | Retry logic, crash recovery | 2 hours |
| 8. Nonce/Replay Protection | Prevent double-spending | 1-2 hours |

### Low Priority (Optional)

| Task | Description |
|------|-------------|
| Deploy ink! Pool | Deploy to Substrate chain |
| Price Oracle | Live XLM/DEV price feed |
| Multi-token Support | Support multiple tokens |
| Production Deployment | Mainnet contracts |

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

### Flow 2: Lock XLM on Stellar → Get DEV on Moonbase

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    STELLAR → MOONBASE BRIDGE FLOW                           │
└─────────────────────────────────────────────────────────────────────────────┘

┌──────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────────────────┐
│   USER   │    │   STELLAR    │    │   RELAYER    │    │   MOONBASE EVM   │
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
     │                 │                   │                     │ 7. Transfer DEV
     │                 │                   │                     │    to user
     │                 │                   │                     │
     │  8. DEV received in MetaMask!       │                     │
     │<───────────────────────────────────────────────────────────
     │                 │                   │                     │
     ▼                 ▼                   ▼                     ▼
```

### Flow 3: Lock DEV on Moonbase → Get XLM on Stellar

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    MOONBASE → STELLAR BRIDGE FLOW                           │
└─────────────────────────────────────────────────────────────────────────────┘

┌──────────┐    ┌──────────────────┐    ┌──────────────┐    ┌──────────────┐
│   USER   │    │   MOONBASE EVM   │    │   RELAYER    │    │   STELLAR    │
│          │    │      POOL        │    │  (Node.js)   │    │    VAULT     │
└────┬─────┘    └────────┬─────────┘    └──────┬───────┘    └──────┬───────┘
     │                   │                     │                   │
     │  1. fund() with   │                     │                   │
     │     Stellar addr  │                     │                   │
     │     in tx data    │                     │                   │
     │──────────────────>│                     │                   │
     │                   │                     │                   │
     │                   │  2. Lock DEV        │                   │
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
│  STELLAR        │◄─────────►│    RELAYER      │◄─────────►│  MOONBASE       │
│  TESTNET        │  Events   │   (Node.js)     │  Events   │  ALPHA          │
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
│   │   └── contract_id.txt      # ✅ Deployed addresses
│   │
│   ├── evm-pool/                # ✅ Moonbase EVM Pool
│   │   └── PolkaBridgePool.sol  # ✅ Deployed & Verified
│   │
│   ├── ink-pool/                # ⚠️ Optional Substrate Pool
│   │   ├── lib.rs               # ✅ Compiled
│   │   └── Cargo.toml           # ✅ 
│   │
│   └── .env.example             # ⚠️ Move to relayer/
│
├── relayer/
│   ├── src/
│   │   ├── index.js             # ⚠️ Needs EVM support
│   │   └── check-balance.js     # ✅ Utility
│   ├── package.json             # ✅ Dependencies
│   ├── .env                     # ❌ MISSING - Create this!
│   └── .env.example             # ❌ MISSING - Create this!
│
├── frontend/                    # ❌ NOT CREATED
│   └── (React + Vite app)
│
└── PROJECT_STATUS.md            # 📄 This file
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

# Moonbase Alpha EVM Configuration
MOONBASE_RPC_URL=https://rpc.api.moonbase.moonbeam.network
EVM_POOL_ADDRESS=0x1Df2Cc6129568a62379f232087F20f5Bc4E37cE6
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

## 🚀 Next Steps (In Order)

1. **Export Stellar Secret Key** from Freighter wallet
2. **Export EVM Private Key** from MetaMask  
3. **Create `/relayer/.env`** with real keys
4. **Fund the pools** with test tokens
5. **Update relayer** to support EVM ↔ Stellar
6. **Test the bridge** end-to-end
7. **Build frontend** (optional for demo)

---

## 📞 Quick Commands

```bash
# Fund EVM Pool (send DEV via Remix or MetaMask)
# Go to: https://remix.ethereum.org
# Load PolkaBridgePool at 0x1Df2Cc6129568a62379f232087F20f5Bc4E37cE6
# Call fund() with value

# Check EVM Pool Balance
cast call 0x1Df2Cc6129568a62379f232087F20f5Bc4E37cE6 "getBalance()" --rpc-url https://rpc.api.moonbase.moonbeam.network

# Run Relayer
cd relayer && npm start
```
