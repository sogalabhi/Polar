<!-- 314c3a7a-cdd8-40ff-9aba-3b9b757a8dcf 8058fc92-e92d-4065-83d1-5dea463aba66 -->
# PolkaBridge Web Platform - Implementation Plan

## Project Structure

Monorepo organization:

- `frontend/` - React + Vite + Tailwind CSS application
- `relayer/` - Node.js script handling cross-chain events and Razorpay webhooks
- `contracts/` - Smart contracts (Soroban for Stellar, Ink! for Polkadot)
- `shared/` - Shared types and utilities

## Phase 1: Foundation & Project Setup

### Web Dev Tasks

- Initialize React + Vite project in `frontend/` with TypeScript
- Setup Tailwind CSS configuration
- Create basic folder structure: `components/`, `pages/`, `hooks/`, `utils/`, `types/`
- Setup routing (React Router)
- Install core dependencies: `@stellar/freighter-api`, `@polkadot/extension-dapp`, `@polkadot/api`, `framer-motion`, `react-razorpay`
- Create environment configuration for testnet endpoints

### Web3 Dev Tasks

- Initialize Rust workspace in `contracts/` with separate folders for Soroban and Ink!
- Setup Soroban contract structure (Stellar Vault)
- Setup Ink! contract structure (Polkadot Pool)
- Create `relayer/` directory with Node.js setup
- Install relayer dependencies: `stellar-sdk`, `@polkadot/api`, `dotenv`, `express` (for webhooks)
- Create `.env.example` files for both frontend and relayer
- Setup TypeScript for relayer

## Phase 2: Smart Contracts Development

### Web3 Dev Tasks

**Stellar Soroban Vault Contract** (`contracts/soroban-vault/`):

- Implement `deposit(from: Address, amount: i128)` function
- Transfer USDC from user to contract
- Emit event with topic `["lock", polkadot_address]` and amount data
- Store locked amount in contract storage
- Implement `unlock(to: Address, amount: i128)` function
- Admin-only access (relayer key)
- Transfer USDC from contract back to user
- Emit unlock event
- Add storage for tracking locked amounts per user
- Deploy to Stellar Testnet and save Contract ID

**Polkadot Ink! Contract** (`contracts/ink-pool/`):

- Implement `release_liquidity(to: AccountId, amount: Balance)` function
- Admin-only access (relayer key)
- Transfer DOT from contract to user address
- Emit liquidity_released event
- Add contract storage for admin address
- Deploy to Paseo Testnet and save Contract Address
- Fund contract with test DOT for lending

## Phase 3: Frontend Core UI & Wallet Integration

### Web Dev Tasks

**Landing Page** (`frontend/src/pages/Landing.tsx`):

- Hero section with dark theme
- "Liquidity Without Borders" headline
- CSS gradient bridge animation (or Spline integration)
- "Launch App" button triggering wallet connection modal

**Wallet Connection Modal** (`frontend/src/components/WalletModal.tsx`):

- Dual wallet connection flow:

1. Connect Freighter (Stellar) using `@stellar/freighter-api`
2. Connect Talisman (Polkadot) using `@polkadot/extension-dapp`

- Show connection status with checkmarks
- Store wallet addresses in React context/state

**Dashboard Page** (`frontend/src/pages/Dashboard.tsx`):

- Two-card layout:
- **Left Card**: Stellar Assets
- Display USDC balance (live query from Freighter)
- "Add Funds" button (triggers Razorpay)
- Input field for "Amount to Lock"
- **Right Card**: Polkadot Liquidity
- Display DOT balance (live query from Talisman)
- Display "Available Credit Line" (calculated from locked USDC)
- **Center**: Bridge Controls
- LTV Slider (0% - 75%) with animated arrows
- "Bridge Liquidity" button

**Transaction Tunnel Overlay** (`frontend/src/components/TransactionTunnel.tsx`):

- Step-by-step progress indicator:

1. "Securing Collateral..." (Stellar icon pulsing)
2. "Crossing the Bridge..." (animated light beam)
3. "Minting Credit..." (Polkadot icon glowing)
4. "Success!" (confetti animation using framer-motion)

- Dim background overlay
- Real-time status updates from transaction confirmations

### Web3 Dev Tasks

- Create wallet connection utilities (`frontend/src/utils/wallets.js`):
- `connectFreighter()` - Stellar wallet connection
- `connectPolkadot()` - Polkadot wallet connection
- `getStellarBalance()` - Query USDC balance
- `getPolkadotBalance()` - Query DOT balance
- Create contract interaction hooks (`frontend/src/hooks/useContracts.js`):
- `useStellarContract()` - Soroban contract instance
- `usePolkadotContract()` - Ink! contract instance
- Transaction signing helpers

## Phase 4: Relayer & Backend Integration

### Web3 Dev Tasks

**Relayer Core** (`relayer/src/index.js`):

- Setup Stellar SDK connection to Testnet Horizon
- Setup Polkadot API connection to Paseo Testnet
- Event listener loop (setInterval every 3 seconds):
- Query Stellar contract events with topic `["lock"]`
- Decode XDR event data to extract:
- Polkadot address (string)
- Locked amount (number)
- Transaction ID (for deduplication)
- Processed events tracking (local JSON file or simple DB)
- Cross-chain logic:
- Calculate loan amount: `collateral * price * LTV`
- Construct Polkadot extrinsic to call Ink! contract
- Sign with relayer private key
- Submit transaction and wait for finality
- Mark event as processed

**Razorpay Integration** (`relayer/src/razorpay.js`):

- Express.js webhook endpoint: `POST /api/razorpay-webhook`
- Verify Razorpay webhook signature
- On successful payment:
- Calculate USDC amount (INR / exchange rate)
- Load distributor secret key from env
- Build Stellar payment transaction
- Send USDC to user's Freighter address
- Return success response

**Environment Setup**:

- Create `.env` with:
- Stellar distributor secret key
- Polkadot relayer private key
- Contract addresses (Soroban + Ink!)
- Razorpay webhook secret
- RPC endpoints

### Web Dev Tasks

**Razorpay Frontend Integration** (`frontend/src/components/RazorpayButton.tsx`):

- Integrate `react-razorpay` or direct Razorpay script
- On "Add Funds" click:
- Open Razorpay checkout modal
- Handle success callback
- Show loading state while backend mints USDC
- Refresh Stellar balance after success

**Transaction Flow** (`frontend/src/hooks/useBridge.js`):

- `bridgeLiquidity()` function:

1. Calculate lock amount from LTV slider
2. Sign Stellar transaction (deposit to Soroban contract)
3. Show Transaction Tunnel overlay
4. Poll for Stellar transaction confirmation
5. Wait for relayer to process (poll Polkadot balance)
6. Show success state

## Phase 5: Polish, Testing & Demo Prep

### Web Dev Tasks

- Refine animations and micro-interactions
- Add error handling and user feedback:
- Transaction failure messages
- Network error handling
- Wallet disconnection handling
- Responsive design testing
- Loading states for all async operations
- Create demo script/walkthrough

### Web3 Dev Tasks

- Error handling in relayer:
- Retry logic for failed Polkadot transactions
- Event replay on relayer restart
- Gas estimation and adjustment
- Add logging for debugging
- Test edge cases:
- Multiple simultaneous locks
- Relayer crash recovery
- Contract admin key rotation
- Create deployment scripts for contracts
- Document contract addresses and ABIs

### Both Devs

- End-to-end testing of full flow:

1. Connect wallets
2. Add funds via Razorpay
3. Lock USDC and get DOT loan
4. Verify balances update correctly

- Record demo video showing complete user journey
- Prepare presentation explaining event-driven architecture

## Key Files to Create

**Frontend:**

- `frontend/src/App.tsx` - Main app component
- `frontend/src/pages/Landing.tsx` - Landing page
- `frontend/src/pages/Dashboard.tsx` - Main dashboard
- `frontend/src/components/WalletModal.tsx` - Wallet connection
- `frontend/src/components/TransactionTunnel.tsx` - Transaction progress
- `frontend/src/hooks/useBridge.js` - Bridge transaction logic
- `frontend/src/utils/wallets.js` - Wallet utilities
- `frontend/tailwind.config.js` - Tailwind configuration

**Relayer:**

- `relayer/src/index.js` - Main relayer loop
- `relayer/src/razorpay.js` - Razorpay webhook handler
- `relayer/src/stellar.js` - Stellar event listener
- `relayer/src/polkadot.js` - Polkadot transaction sender
- `relayer/src/db.js` - Processed events storage

**Contracts:**

- `contracts/soroban-vault/src/lib.rs` - Stellar vault contract
- `contracts/ink-pool/lib.rs` - Polkadot pool contract
- `contracts/deploy.sh` - Deployment scripts

## Technical Notes

- Use Stellar Testnet and Paseo Testnet for all deployments
- Relayer runs continuously, listening for Stellar events
- All cross-chain operations are event-driven (no polling from frontend)
- Frontend polls wallet balances for UI updates
- Admin keys stored securely in environment variables (never commit)
- Event deduplication prevents double-spending