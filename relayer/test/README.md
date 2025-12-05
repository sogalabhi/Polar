# Test Scripts for Polar Bridge

Test scripts to verify each component works independently.

## Prerequisites

Make sure your `.env` file is configured with:
- `STELLAR_RELAYER_SECRET` - Your Stellar secret key
- `EVM_RELAYER_PRIVATE_KEY` - Your EVM private key
- `VAULT_CONTRACT_ID` - Stellar vault contract address
- `EVM_POOL_ADDRESS` - EVM pool contract address

## Test Scripts

### 1. Check Balances

```bash
# Check Stellar vault balance
node test/test-check-balance.js

# Check EVM pool balance
node test/test-check-evm-pool.js
```

### 2. Watch for Events (Terminal 1)

Start the event watcher first to see when lock events occur:

```bash
node test/test-watch-events.js
```

### 3. Lock XLM on Stellar (Terminal 2)

Lock XLM and the watcher should detect it:

```bash
# Lock 0.1 XLM and specify your MetaMask address
node test/test-lock-xlm.js 0.1 0xYourMetaMaskAddress
```

### 4. Unlock XLM from Stellar

Get your XLM back from the vault:

```bash
# Unlock 0.1 XLM back to your account
node test/test-unlock-xlm.js 0.1
```

### 5. Release PAS on EVM (Manual)

Manually release PAS to an address:

```bash
# Release 0.1 PAS to an address
node test/test-release-dev.js 0.1 0xRecipientAddress
```

## Full E2E Test

1. **Terminal 1**: Start the event watcher
   ```bash
   node test/test-watch-events.js
   ```

2. **Terminal 2**: Lock XLM
   ```bash
   node test/test-lock-xlm.js 0.1 0xYourMetaMaskAddress
   ```

3. **Verify**: The watcher should show the lock event with your EVM address

4. **Terminal 2**: Start the real relayer to auto-release PAS
   ```bash
   npm start
   ```

5. **Terminal 3**: Lock XLM again
   ```bash
   node test/test-lock-xlm.js 0.1 0xYourMetaMaskAddress
   ```

6. **Verify**: Relayer should detect and release PAS to your MetaMask
