#!/bin/bash
set -e

echo "🔧 Soroban Vault Deployment Script"
echo "=================================="
echo ""

# Configuration
NETWORK="testnet"
WASM_PATH="target/wasm32v1-none/release/soroban_vault.wasm"
KEY_NAME="deployer2"
CONTRACT_ALIAS="soroban_vault"

# Network configuration for testnet
RPC_URL="https://soroban-testnet.stellar.org"
NETWORK_PASSPHRASE="Test SDF Network ; September 2015"

# Check if stellar CLI is installed
if ! command -v stellar &> /dev/null; then
    echo "❌ stellar CLI not found. Install it with:"
    echo "   cargo install --locked stellar-cli --features opt"
    exit 1
fi

echo "✅ stellar CLI found: $(stellar --version)"
echo ""

# Step 1: Generate or use existing key
echo "📝 Step 1: Setting up deployer key..."
if stellar keys address "$KEY_NAME" &> /dev/null; then
    echo "   Key '$KEY_NAME' already exists"
else
    echo "   Generating new key '$KEY_NAME' and funding via Friendbot..."
    stellar keys generate "$KEY_NAME" --network "$NETWORK" --fund
fi

DEPLOYER_ADDRESS=$(stellar keys address "$KEY_NAME")
echo "   Deployer address: $DEPLOYER_ADDRESS"
echo ""

# Step 2: Build the contract
echo "📦 Step 2: Building contract..."
stellar contract build

if [ ! -f "$WASM_PATH" ]; then
    echo "❌ Build failed: WASM file not found at $WASM_PATH"
    exit 1
fi

echo "✅ Build complete: $WASM_PATH"
echo ""

# Step 3: Deploy to Testnet
echo "🚀 Step 3: Deploying contract to Stellar $NETWORK..."
CONTRACT_ID=$(stellar contract deploy \
    --wasm "$WASM_PATH" \
    --source-account "$KEY_NAME" \
    --rpc-url "$RPC_URL" \
    --network-passphrase "$NETWORK_PASSPHRASE" \
    --alias "$CONTRACT_ALIAS")

echo "✅ Contract deployed!"
echo "   Contract ID: $CONTRACT_ID"
echo "   Alias: $CONTRACT_ALIAS"
echo ""

# Step 4: Initialize contract
echo "📝 Step 4: Initializing contract..."

# Load USDC token contract from .env if available
if [ -f .env ]; then
    export $(cat .env | grep -v '#' | xargs)
fi

# Prompt for USDC token contract address if not set
if [ -z "$USDC_TOKEN_CONTRACT" ]; then
    echo ""
    echo "⚠️  You need to provide the USDC token contract address."
    echo "   For testing, you can deploy a test token or use an existing one."
    echo ""
    read -p "Enter USDC Token Contract Address (or press Enter to skip init): " USDC_TOKEN_CONTRACT
fi

if [ -n "$USDC_TOKEN_CONTRACT" ]; then
    echo "   Admin: $DEPLOYER_ADDRESS"
    echo "   Token: $USDC_TOKEN_CONTRACT"
    
    stellar contract invoke \
        --id "$CONTRACT_ID" \
        --source-account "$KEY_NAME" \
        --rpc-url "$RPC_URL" \
        --network-passphrase "$NETWORK_PASSPHRASE" \
        -- \
        init \
        --admin "$DEPLOYER_ADDRESS" \
        --token_address "$USDC_TOKEN_CONTRACT"
    
    echo "✅ Contract initialized!"
    echo ""

    # Step 5: Verify initialization
    echo "🔍 Step 5: Verifying storage..."
    
    ADMIN=$(stellar contract invoke \
        --id "$CONTRACT_ID" \
        --rpc-url "$RPC_URL" \
        --network-passphrase "$NETWORK_PASSPHRASE" \
        -- \
        get_admin)
    
    TOKEN=$(stellar contract invoke \
        --id "$CONTRACT_ID" \
        --rpc-url "$RPC_URL" \
        --network-passphrase "$NETWORK_PASSPHRASE" \
        -- \
        get_token)
    
    echo "   Admin:  $ADMIN"
    echo "   Token:  $TOKEN"
    echo ""
else
    echo "⏭️  Skipping initialization. Run init manually later with:"
    echo "   stellar contract invoke --id $CONTRACT_ID --source-account $KEY_NAME --rpc-url $RPC_URL --network-passphrase \"$NETWORK_PASSPHRASE\" -- init --admin <ADMIN_ADDRESS> --token_address <TOKEN_ADDRESS>"
    echo ""
fi

# Step 6: Save deployment info
echo "💾 Step 6: Saving deployment info..."
mkdir -p ./deployments
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
DEPLOY_FILE="./deployments/soroban_vault_${NETWORK}_${TIMESTAMP}.json"

cat > "$DEPLOY_FILE" <<EOF
{
  "network": "$NETWORK",
  "contract_id": "$CONTRACT_ID",
  "contract_alias": "$CONTRACT_ALIAS",
  "deployer": "$DEPLOYER_ADDRESS",
  "deployer_key_name": "$KEY_NAME",
  "usdc_token": "$USDC_TOKEN_CONTRACT",
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF

echo "✅ Deployment info saved: $DEPLOY_FILE"
echo ""

# Final summary
echo "🎉 Deployment Complete!"
echo "=================================="
echo "Contract ID:    $CONTRACT_ID"
echo "Contract Alias: $CONTRACT_ALIAS"
echo "Network:        $NETWORK"
echo "Deployer:       $DEPLOYER_ADDRESS"
echo "Key Name:       $KEY_NAME"
echo ""
echo "Useful commands:"
echo "  # Check locked balance for a user"
echo "  stellar contract invoke --id $CONTRACT_ID --rpc-url $RPC_URL --network-passphrase \"$NETWORK_PASSPHRASE\" -- get_locked_balance --user <ADDRESS>"
echo ""
echo "  # Get admin"
echo "  stellar contract invoke --id $CONTRACT_ID --rpc-url $RPC_URL --network-passphrase \"$NETWORK_PASSPHRASE\" -- get_admin"
echo ""
echo "  # Watch events"
echo "  stellar contract events --id $CONTRACT_ID --rpc-url $RPC_URL"
echo ""

# Export for relayer use
echo "export SOROBAN_VAULT_CONTRACT_ID=\"$CONTRACT_ID\"" > contract_id.env
echo "Contract ID also saved to contract_id.env"
