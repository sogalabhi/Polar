# 🌉 Polar Bridge - Cross-Chain DeFi Lending Protocol

A cross-chain collateralized lending protocol enabling users to borrow PAS tokens (Paseo Asset Hub) by locking XLM as collateral.

## 🎯 Overview

Polar Bridge allows users to:
1. **Add INR funds** via Razorpay (UPI, Card, NetBanking)
2. **Create collateralized loans** - Lock INR indirectly to borrow PAS tokens
3. **Manage loans** - Monitor health factor, repay, add collateral
4. **Auto-liquidation** - Positions are liquidated if health factor drops below 1.0

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

## 🛠️ Tech Stack

- **Frontend**: React + Vite + TailwindCSS + Framer Motion
- **Backend**: Node.js + Express
- **Database**: Supabase (PostgreSQL)
- **Blockchains**: 
  - Stellar (Soroban) - XLM collateral vault
  - Paseo Asset Hub (EVM) - PAS token pool
- **Payments**: Razorpay

## 📁 Project Structure

```
polar/
├── frontend/           # React frontend application
│   ├── src/
│   │   ├── components/ # UI components
│   │   ├── pages/      # Dashboard, Landing
│   │   ├── hooks/      # useWallet hook
│   │   └── lib/        # Supabase client
│   └── package.json
│
├── relayer/            # Backend server & bot
│   ├── src/
│   │   ├── routes.js   # API endpoints
│   │   ├── index.js    # Event listener/relayer
│   │   ├── lending-config.js
│   │   └── liquidation-bot.js
│   ├── migrations/     # SQL schema
│   └── package.json
│
└── contracts/          # Smart contracts
    ├── soroban-vault/  # Stellar Soroban vault (Rust)
    ├── evm-pool/       # Paseo EVM pool (Solidity)
    └── ink-pool/       # ink! pool (Rust)
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

## 🔄 User Flows

### Creating a Loan
```
1. User connects MetaMask
2. Selects loan type (Short/Standard/Long)
3. Enters borrow amount in INR
4. Adjusts LTV ratio (50-75%)
5. Reviews terms & accepts
6. Collateral (INR) deducted from wallet
7. XLM locked on Stellar vault
8. PAS sent to user's EVM wallet
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


## 📈 Revenue Model

| Source | Rate |
|--------|------|
| Borrow Interest | 6-12% APY |
| Liquidation Penalty | 10% (70% to protocol) |
| Late Fees | 2% per day |

## 📄 License

MIT License

## 🤝 Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing`)
5. Open a Pull Request

---

Built for the Polkadot ecosystem 🟣