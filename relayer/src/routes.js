require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const StellarSdk = require('@stellar/stellar-sdk');
const { ethers } = require('ethers');
const Razorpay = require('razorpay');

// Import lending configuration
const {
    LENDING_CONFIG,
    calculateRequiredCollateral,
    calculateHealthFactor,
    calculateLiquidationPrice,
    calculateAccruedInterest,
    calculateLateFee,
    getInterestRateForDuration,
    calculateLiquidationAmounts,
    daysBetween,
} = require('./lending-config');

const app = express();
app.use(cors());
app.use(express.json());

// ============================================
// CONFIGURATION
// ============================================
const CONFIG = {
    PORT: process.env.PORT || 3000,
    
    // Supabase
    VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL,
    VITE_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY,
    
    // Stellar (Owner's account - locks XLM on behalf of users)
    STELLAR_RPC_URL: process.env.STELLAR_RPC_URL || 'https://soroban-testnet.stellar.org',
    STELLAR_HORIZON_URL: 'https://horizon-testnet.stellar.org',
    VAULT_CONTRACT_ID: process.env.VAULT_CONTRACT_ID || 'CDI75PQ4EA2VBTT7W6EZN2RGJIS4CFDMGT7WJ4L42T4ZSTNEKY42NY2B',
    STELLAR_OWNER_SECRET: process.env.STELLAR_RELAYER_SECRET, // Owner's secret key
    XLM_SAC_ADDRESS: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
    
    // Price feed
    COINGECKO_API: 'https://api.coingecko.com/api/v3',
    
    // Paseo Asset Hub EVM Configuration
    PASEO_RPC_URL: process.env.PASEO_RPC_URL || 'https://testnet-passet-hub-eth-rpc.polkadot.io',
    EVM_POOL_ADDRESS: process.env.EVM_POOL_ADDRESS || '0x49e12e876588052A977dB816107B1772B4103E3e',
    EVM_RELAYER_PRIVATE_KEY: process.env.EVM_RELAYER_PRIVATE_KEY || '',
    
    // Payback / Buyback fees (percentage, e.g., 0.01 = 1%)
    PAYBACK_FEE_PERCENT: parseFloat(process.env.PAYBACK_FEE_PERCENT || '0'),
    
    // Razorpay Configuration
    RAZORPAY_KEY_ID: process.env.RAZORPAY_KEY_ID,
    RAZORPAY_KEY_SECRET: process.env.RAZORPAY_KEY_SECRET,
};

// EVM Pool Contract ABI
const EVM_POOL_ABI = [
    "function releaseLiquidity(address payable to, uint256 amount) external",
    "function getBalance() external view returns (uint256)",
];

// Initialize Razorpay
const razorpay = new Razorpay({
    key_id: CONFIG.RAZORPAY_KEY_ID,
    key_secret: CONFIG.RAZORPAY_KEY_SECRET,
});

// Initialize Supabase
const supabase = createClient(CONFIG.VITE_SUPABASE_URL, CONFIG.VITE_SUPABASE_ANON_KEY);

// Initialize Stellar
const { rpc, Keypair, TransactionBuilder, Networks, Contract, nativeToScVal, Address } = StellarSdk;
const stellarServer = new rpc.Server(CONFIG.STELLAR_RPC_URL);
const ownerKeypair = Keypair.fromSecret(CONFIG.STELLAR_OWNER_SECRET);

// Initialize Paseo Asset Hub EVM provider
const paseoProvider = new ethers.JsonRpcProvider(CONFIG.PASEO_RPC_URL);

// Initialize EVM relayer wallet and pool contract (for sending PAS)
let evmRelayerWallet = null;
let evmPoolContract = null;

if (CONFIG.EVM_RELAYER_PRIVATE_KEY) {
    evmRelayerWallet = new ethers.Wallet(CONFIG.EVM_RELAYER_PRIVATE_KEY, paseoProvider);
    evmPoolContract = new ethers.Contract(CONFIG.EVM_POOL_ADDRESS, EVM_POOL_ABI, evmRelayerWallet);
    console.log(`🔑 EVM Relayer Address: ${evmRelayerWallet.address}`);
} else {
    console.log('⚠️  EVM_RELAYER_PRIVATE_KEY not set - PAS release from pool disabled');
}

console.log(`🔑 Owner Stellar Address: ${ownerKeypair.publicKey()}`);
console.log(`🔗 Paseo RPC: ${CONFIG.PASEO_RPC_URL}`);

// ============================================
// EVM WALLET BALANCE (PAS)
// ============================================

/**
 * Get real PAS balance from a wallet on Paseo Asset Hub
 * @param {string} evmAddress - User's EVM wallet address
 * @returns {Promise<{success: boolean, balance: string, balanceWei: string}>}
 */
async function getPasBalance(evmAddress) {
    console.log('\n📡 ═══════════════════════════════════════════════════════════════');
    console.log('   💰 WEB3 CALL: Get PAS Balance from Paseo Asset Hub');
    console.log('═══════════════════════════════════════════════════════════════════');
    console.log(`   📋 Address: ${evmAddress}`);
    console.log(`   📋 Network: Paseo Asset Hub (Chain ID: 420420422)`);
    console.log(`   📋 RPC: ${CONFIG.PASEO_RPC_URL}`);
    
    try {
        if (!ethers.isAddress(evmAddress)) {
            console.error('   ❌ Invalid EVM address format');
            throw new Error('Invalid EVM address');
        }
        
        console.log('\n   🔍 Querying blockchain for balance...');
        const balanceWei = await paseoProvider.getBalance(evmAddress);
        const balancePas = ethers.formatEther(balanceWei);
        
        console.log('\n   ═══════════════════════════════════════════════════════════');
        console.log('   ✅ BALANCE RETRIEVED');
        console.log('   ═══════════════════════════════════════════════════════════');
        console.log(`   💰 Balance: ${balancePas} PAS`);
        console.log(`   💰 Balance (Wei): ${balanceWei.toString()}`);
        console.log('═══════════════════════════════════════════════════════════════════\n');
        
        return {
            success: true,
            balance: balancePas,
            balanceWei: balanceWei.toString(),
            formatted: `${parseFloat(balancePas).toFixed(4)} PAS`
        };
    } catch (error) {
        console.error('\n   ═══════════════════════════════════════════════════════════');
        console.error('   ❌ BALANCE QUERY FAILED');
        console.error('   ═══════════════════════════════════════════════════════════');
        console.error(`   Error: ${error.message}`);
        console.error('═══════════════════════════════════════════════════════════════════\n');
        return {
            success: false,
            balance: '0',
            balanceWei: '0',
            error: error.message
        };
    }
}

// ============================================
// SEND PAS FROM POOL
// ============================================

/**
 * Send PAS tokens from the pool to a user
 * @param {string} evmAddress - Recipient EVM address
 * @param {number} pasAmount - Amount of PAS to send
 * @returns {Promise<{success: boolean, txHash?: string, error?: string}>}
 */
async function sendPasFromPool(evmAddress, pasAmount) {
    console.log('\n📡 ═══════════════════════════════════════════════════════════════');
    console.log('   💸 WEB3 CONTRACT CALL: Release PAS from Pool');
    console.log('═══════════════════════════════════════════════════════════════════');
    console.log(`   📋 Contract: ${CONFIG.EVM_POOL_ADDRESS}`);
    console.log(`   📋 Method: releaseLiquidity()`);
    console.log(`   📋 Recipient: ${evmAddress}`);
    console.log(`   📋 Amount: ${pasAmount} PAS`);
    
    if (!evmPoolContract || !evmRelayerWallet) {
        console.error('   ❌ EVM relayer not configured. Set EVM_RELAYER_PRIVATE_KEY in .env');
        return { success: false, error: 'EVM relayer not configured' };
    }
    
    try {
        const amountWei = ethers.parseEther(pasAmount.toString());
        console.log(`   📋 Amount (Wei): ${amountWei.toString()}`);
        
        // Check pool balance first
        console.log('\n   🔍 Step 1: Checking pool balance...');
        const poolBalance = await evmPoolContract.getBalance();
        console.log(`   📊 Pool Balance: ${ethers.formatEther(poolBalance)} PAS`);
        console.log(`   📊 Required: ${pasAmount} PAS`);
        
        if (poolBalance < amountWei) {
            console.error('   ❌ Insufficient pool balance!');
            return { success: false, error: 'Insufficient pool balance' };
        }
        console.log('   ✅ Sufficient balance available');
        
        // Send transaction
        console.log('\n   📤 Step 2: Sending transaction...');
        const tx = await evmPoolContract.releaseLiquidity(evmAddress, amountWei);
        
        console.log(`   🔗 TX Hash: ${tx.hash}`);
        console.log('   ⏳ Waiting for confirmation...');
        
        const receipt = await tx.wait();
        
        console.log('\n   ═══════════════════════════════════════════════════════════');
        console.log('   ✅ PAS SENT SUCCESSFULLY!');
        console.log('   ═══════════════════════════════════════════════════════════');
        console.log(`   🔗 TX Hash: ${tx.hash}`);
        console.log(`   📦 Block: ${receipt.blockNumber}`);
        console.log(`   ⛽ Gas Used: ${receipt.gasUsed?.toString()}`);
        console.log('═══════════════════════════════════════════════════════════════════\n');
        
        return { success: true, txHash: tx.hash };
        
    } catch (error) {
        console.error('\n   ═══════════════════════════════════════════════════════════');
        console.error('   ❌ FAILED TO SEND PAS');
        console.error('   ═══════════════════════════════════════════════════════════');
        console.error(`   Error: ${error.message}`);
        console.error('═══════════════════════════════════════════════════════════════════\n');
        return { success: false, error: error.message };
    }
}

// ============================================
// PRICE FETCHING
// ============================================

// Cache for prices (refresh every 60 seconds)
let priceCache = {
    pasToInr: 0, // Will be fetched from DOT price
    dotToInr: 0,
    dotToUsd: 0,
    lastUpdated: 0
};

async function fetchPrices() {
    const now = Date.now();
    
    // Return cached if less than 60 seconds old
    if (now - priceCache.lastUpdated < 60000 && priceCache.dotToInr > 0) {
        return priceCache;
    }
    
    try {
        // Fetch DOT/INR rate directly from CoinGecko
        // We show DOT price as PAS price (since PAS is Paseo testnet token)
        const response = await fetch(
            `${CONFIG.COINGECKO_API}/simple/price?ids=polkadot&vs_currencies=inr,usd`
        );
        const data = await response.json();
        
        if (data['polkadot']) {
            priceCache.dotToInr = data['polkadot'].inr || 0;
            priceCache.pasToInr = priceCache.dotToInr; // PAS = DOT price
            priceCache.dotToUsd = data['polkadot'].usd || 0;
        }
        
        priceCache.lastUpdated = now;
        console.log(`💰 Prices updated: 1 PAS (DOT) = ₹${priceCache.pasToInr.toFixed(2)} ($${priceCache.dotToUsd?.toFixed(2)})`);
        
    } catch (error) {
        console.error('Error fetching prices:', error.message);
        // Keep old cached values on error
    }
    
    return priceCache;
}

// Calculate PAS to INR rate (using DOT price)
async function getPasToInrRate() {
    const prices = await fetchPrices();
    return {
        pasToInr: prices.pasToInr,
        dotToInr: prices.dotToInr,
        dotToUsd: prices.dotToUsd || 0,
    };
}

// ============================================
// STELLAR CONTRACT INTERACTION
// ============================================

async function lockXlmOnStellar(amountXlm, userEvmAddress) {
    console.log('\n📡 ═══════════════════════════════════════════════════════════════');
    console.log('   🔐 WEB3 CONTRACT CALL: Lock XLM on Stellar Vault');
    console.log('═══════════════════════════════════════════════════════════════════');
    console.log(`   📋 Contract: ${CONFIG.VAULT_CONTRACT_ID}`);
    console.log(`   📋 Method: lock()`);
    console.log(`   📋 Network: Stellar Testnet`);
    console.log(`   📋 Amount: ${amountXlm} XLM`);
    console.log(`   📋 EVM Destination: ${userEvmAddress}`);
    console.log(`   📋 Owner/Caller: ${ownerKeypair.publicKey()}`);
    
    try {
        console.log('\n   🔍 Step 1: Loading owner account...');
        const ownerAccount = await stellarServer.getAccount(ownerKeypair.publicKey());
        console.log(`   ✅ Account loaded. Sequence: ${ownerAccount.sequenceNumber()}`);
        
        // Convert XLM to stroops (1 XLM = 10^7 stroops)
        const amountStroops = Math.floor(amountXlm * 10000000);
        console.log(`\n   💱 Step 2: Converting amount...`);
        console.log(`   📊 ${amountXlm} XLM = ${amountStroops} stroops`);
        
        // Build the contract call
        console.log('\n   🔨 Step 3: Building contract call...');
        const contract = new Contract(CONFIG.VAULT_CONTRACT_ID);
        
        // Create the lock operation
        const lockOp = contract.call(
            "lock",
            nativeToScVal(Address.fromString(ownerKeypair.publicKey()), { type: "address" }),
            nativeToScVal(amountStroops, { type: "i128" }),
            nativeToScVal(userEvmAddress, { type: "string" })
        );
        console.log('   ✅ Lock operation created');
        
        // Build transaction
        console.log('\n   📝 Step 4: Building transaction...');
        const transaction = new TransactionBuilder(ownerAccount, {
            fee: '100000', // 0.01 XLM
            networkPassphrase: Networks.TESTNET
        })
            .addOperation(lockOp)
            .setTimeout(30)
            .build();
        console.log('   ✅ Transaction built');
        
        // Simulate first
        console.log('\n   🧪 Step 5: Simulating transaction...');
        const simResponse = await stellarServer.simulateTransaction(transaction);
        
        if (StellarSdk.rpc.Api.isSimulationError(simResponse)) {
            console.error('   ❌ Simulation FAILED:', simResponse.error);
            throw new Error(`Simulation failed: ${simResponse.error}`);
        }
        console.log('   ✅ Simulation successful');
        
        // Prepare and sign
        console.log('\n   ✍️  Step 6: Signing transaction...');
        const preparedTx = StellarSdk.rpc.assembleTransaction(transaction, simResponse).build();
        preparedTx.sign(ownerKeypair);
        console.log('   ✅ Transaction signed');
        
        // Submit
        console.log('\n   📤 Step 7: Submitting to Stellar network...');
        const sendResponse = await stellarServer.sendTransaction(preparedTx);
        
        console.log('\n   ═══════════════════════════════════════════════════════════');
        console.log('   ✅ TRANSACTION SUBMITTED TO STELLAR');
        console.log('   ═══════════════════════════════════════════════════════════');
        console.log(`   🔗 TX HASH: ${sendResponse.hash}`);
        console.log(`   🔗 Explorer: https://stellar.expert/explorer/testnet/tx/${sendResponse.hash}`);
        console.log(`   📊 Status: ${sendResponse.status}`);
        
        // Wait for confirmation
        console.log('\n   ⏳ Step 8: Waiting for confirmation...');
        let getResponse = await stellarServer.getTransaction(sendResponse.hash);
        let attempts = 0;
        while (getResponse.status === 'NOT_FOUND' && attempts < 30) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            getResponse = await stellarServer.getTransaction(sendResponse.hash);
            attempts++;
            if (attempts % 5 === 0) console.log(`   ⏳ Still waiting... (${attempts}s)`);
        }
        
        if (getResponse.status === 'SUCCESS') {
            console.log('\n   ═══════════════════════════════════════════════════════════');
            console.log('   ✅ STELLAR TRANSACTION CONFIRMED!');
            console.log('   ═══════════════════════════════════════════════════════════');
            console.log(`   🔗 TX HASH: ${sendResponse.hash}`);
            console.log(`   📊 Status: SUCCESS`);
            console.log(`   📦 Ledger: ${getResponse.ledger}`);
            console.log('═══════════════════════════════════════════════════════════════════\n');
            return {
                success: true,
                txHash: sendResponse.hash,
                amountStroops
            };
        } else {
            console.error(`   ❌ Transaction failed with status: ${getResponse.status}`);
            throw new Error(`Transaction failed: ${getResponse.status}`);
        }
        
    } catch (error) {
        console.error('\n   ═══════════════════════════════════════════════════════════');
        console.error('   ❌ STELLAR TRANSACTION FAILED');
        console.error('   ═══════════════════════════════════════════════════════════');
        console.error(`   Error: ${error.message}`);
        console.error('═══════════════════════════════════════════════════════════════════\n');
        return {
            success: false,
            error: error.message
        };
    }
}

// ============================================
// API ROUTES
// ============================================

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ============================================
// RAZORPAY ENDPOINTS
// ============================================

// Create Razorpay order
app.post('/create-order', async (req, res) => {
    try {
        const { amount, currency = 'INR' } = req.body;

        if (!amount || amount <= 0) {
            return res.status(400).json({
                success: false,
                error: 'Invalid amount'
            });
        }

        const options = {
            amount: amount * 100, // amount in smallest currency unit (paise)
            currency: currency,
            receipt: `receipt_${Date.now()}`,
        };

        const order = await razorpay.orders.create(options);
        console.log(`💳 Razorpay order created: ${order.id} for ₹${amount}`);
        res.json(order);
    } catch (error) {
        console.error('Error creating Razorpay order:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Verify Razorpay payment signature
app.post('/verify-payment', (req, res) => {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
        return res.status(400).json({
            success: false,
            error: 'Missing required fields'
        });
    }

    const hmac = crypto.createHmac('sha256', CONFIG.RAZORPAY_KEY_SECRET);
    hmac.update(razorpay_order_id + "|" + razorpay_payment_id);
    const generated_signature = hmac.digest('hex');

    if (generated_signature === razorpay_signature) {
        console.log(`✅ Payment verified: ${razorpay_payment_id}`);
        res.json({ success: true, message: "Payment verified successfully" });
    } else {
        console.log(`❌ Invalid payment signature for: ${razorpay_payment_id}`);
        res.status(400).json({ success: false, message: "Invalid signature" });
    }
});

// ============================================
// EXCHANGE RATES
// ============================================
app.get('/api/rates', async (req, res) => {
    try {
        const rates = await getPasToInrRate();
        res.json({
            success: true,
            rates: {
                pasToInr: rates.pasToInr,
                dotToInr: rates.dotToInr,
                dotToUsd: rates.dotToUsd
            },
            note: 'PAS rate is based on DOT real-time price',
            example: {
                '10 PAS': `₹${(10 * rates.pasToInr).toFixed(2)}`,
                '₹500': `${(500 / rates.pasToInr).toFixed(4)} PAS`
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get user's wallet balance
app.get('/api/wallet/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const normalizedAddress = userId.toLowerCase();
        
        const { data: wallet, error } = await supabase
            .from('wallets')
            .select('balance_inr')
            .eq('wallet_address', normalizedAddress)
            .single();
        
        if (error) throw error;
        
        res.json({
            success: true,
            balance_inr: wallet?.balance_inr || 0
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get user's frozen/pending purchases
app.get('/api/purchases/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const normalizedAddress = userId.toLowerCase();
        
        const { data: purchases, error } = await supabase
            .from('crypto_purchases')
            .select('*')
            .eq('user_id', normalizedAddress)
            .order('created_at', { ascending: false });
        
        if (error) throw error;
        
        res.json({
            success: true,
            purchases: purchases || []
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get real PAS balance from EVM wallet on Paseo Asset Hub
app.get('/api/pas-balance/:evmAddress', async (req, res) => {
    try {
        const { evmAddress } = req.params;
        
        if (!ethers.isAddress(evmAddress)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid EVM address'
            });
        }
        
        const result = await getPasBalance(evmAddress);
        
        if (!result.success) {
            throw new Error(result.error);
        }
        
        // Also get exchange rate for INR value
        const rates = await getPasToInrRate();
        const balancePas = parseFloat(result.balance);
        const valueInr = balancePas * rates.pasToInr;
        
        res.json({
            success: true,
            address: evmAddress,
            balance: result.balance,
            balanceWei: result.balanceWei,
            formatted: result.formatted,
            valueInr: valueInr.toFixed(2),
            valueInrFormatted: `₹${valueInr.toFixed(2)}`,
            network: 'Paseo Asset Hub',
            chainId: 420420422
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================
// MAIN: BUY PAS TOKENS
// ============================================
app.post('/api/buy-pas', async (req, res) => {
    const { userId, pasAmount, evmAddress, slippageTolerance = 1 } = req.body;
    
    // Validate inputs
    if (!userId || !pasAmount || !evmAddress) {
        return res.status(400).json({
            success: false,
            error: 'Missing required fields: userId, pasAmount, evmAddress'
        });
    }
    
    if (pasAmount <= 0) {
        return res.status(400).json({
            success: false,
            error: 'pasAmount must be positive'
        });
    }
    
    if (slippageTolerance < 0 || slippageTolerance > 100) {
        return res.status(400).json({
            success: false,
            error: 'slippageTolerance must be between 0 and 100'
        });
    }
    
    // Validate EVM address
    if (!ethers.isAddress(evmAddress)) {
        return res.status(400).json({
            success: false,
            error: 'Invalid EVM address'
        });
    }
    
    try {
        console.log(`\n📥 Buy PAS request:`);
        console.log(`   User: ${userId}`);
        console.log(`   PAS Amount: ${pasAmount}`);
        console.log(`   EVM Address: ${evmAddress}`);
        console.log(`   Slippage: ${slippageTolerance}%`);
        
        // 1. Get current rate
        const rates = await getPasToInrRate();
        const baseInrCost = pasAmount * rates.pasToInr;
        const maxInrCost = baseInrCost * (1 + slippageTolerance / 100);
        
        console.log(`   Rate: 1 PAS = ₹${rates.pasToInr.toFixed(2)}`);
        console.log(`   Base Cost: ₹${baseInrCost.toFixed(2)}`);
        console.log(`   Max Cost (with slippage): ₹${maxInrCost.toFixed(2)}`);
        
        // 2. Check user's wallet balance (userId is the wallet address)
        const normalizedAddress = userId.toLowerCase();
        const { data: wallet, error: walletError } = await supabase
            .from('wallets')
            .select('balance_inr')
            .eq('wallet_address', normalizedAddress)
            .single();

        if (walletError) {
            throw new Error(`Wallet not found: ${walletError.message}`);
        }
        
        const currentBalance = parseFloat(wallet.balance_inr) || 0;
        console.log(`   User Balance: ₹${currentBalance.toFixed(2)}`);
        
        if (currentBalance < baseInrCost) {
            return res.status(400).json({
                success: false,
                error: `Insufficient balance. Need ₹${baseInrCost.toFixed(2)}, have ₹${currentBalance.toFixed(2)}`
            });
        }
        
        // 3. Calculate XLM to lock (1:1 with PAS for simplicity)
        const xlmToLock = pasAmount;
        const actualInrCost = baseInrCost;
        const newBalance = currentBalance - actualInrCost;
        
        // 4. FIRST: Execute blockchain transaction (Lock XLM on Stellar)
        console.log(`\n   🔗 Step 1: Executing blockchain transaction...`);
        console.log(`   Locking ${xlmToLock} XLM on Stellar for EVM address: ${evmAddress}`);
        
        const lockResult = await lockXlmOnStellar(xlmToLock, evmAddress);
        
        if (!lockResult.success) {
            // Blockchain transaction failed - return error immediately
            // NO Supabase changes made yet
            console.error(`\n   ❌ BLOCKCHAIN TRANSACTION FAILED`);
            console.error(`   Error: ${lockResult.error}`);
            return res.status(500).json({
                success: false,
                error: `Blockchain transaction failed: ${lockResult.error}`,
                details: {
                    stage: 'stellar_lock',
                    message: lockResult.error
                }
            });
        }
        
        console.log(`\n   ✅ BLOCKCHAIN TRANSACTION SUCCESSFUL!`);
        console.log(`   🔗 Stellar TX Hash: ${lockResult.txHash}`);
        console.log(`   🔗 Explorer: https://stellar.expert/explorer/testnet/tx/${lockResult.txHash}`);
        
        // 5. ONLY NOW: Update Supabase (after blockchain success)
        console.log(`\n   📝 Step 2: Recording transaction in database...`);
        
        // 5a. Create purchase record with confirmed blockchain TX
        const { data: purchase, error: insertError } = await supabase
            .from('crypto_purchases')
            .insert({
                user_id: normalizedAddress,
                from_amount: actualInrCost,
                to_token: 'PAS',
                to_amount: pasAmount,
                exchange_rate: rates.pasToInr,
                destination_address: evmAddress,
                xlm_locked: xlmToLock,
                slippage_tolerance: slippageTolerance,
                status: 'locked', // Already locked on blockchain
                stellar_tx_hash: lockResult.txHash,
                evm_tx_hash: null
            })
            .select()
            .single();
        
        if (insertError) {
            // Blockchain succeeded but DB failed - log this critical error
            console.error(`\n   ⚠️  CRITICAL: Blockchain TX succeeded but DB insert failed!`);
            console.error(`   Stellar TX: ${lockResult.txHash}`);
            console.error(`   DB Error: ${insertError.message}`);
            // Still return success since blockchain worked
            return res.json({
                success: true,
                warning: 'Transaction completed but database record failed',
                data: {
                    pasAmount,
                    inrSpent: actualInrCost,
                    evmAddress,
                    stellarTxHash: lockResult.txHash,
                    status: 'locked',
                    dbError: insertError.message
                }
            });
        }
        
        console.log(`   ✅ Purchase record created: ${purchase.id}`);
        
        // 5b. Deduct INR from wallet
        const { error: updateError } = await supabase
            .from('wallets')
            .update({ 
                balance_inr: newBalance,
                updated_at: new Date().toISOString()
            })
            .eq('wallet_address', normalizedAddress);
        
        if (updateError) {
            console.error(`\n   ⚠️  WARNING: Wallet balance update failed!`);
            console.error(`   Error: ${updateError.message}`);
            // Don't fail the request - blockchain TX succeeded
        } else {
            console.log(`   ✅ Wallet updated: ₹${currentBalance.toFixed(2)} → ₹${newBalance.toFixed(2)}`);
        }
        
        console.log(`\n   🎉 Purchase complete! Waiting for relayer to send PAS...`);
        
        // 6. Return success
        res.json({
            success: true,
            message: 'Purchase successful! PAS tokens will be sent to your wallet shortly.',
            data: {
                purchaseId: purchase.id,
                pasAmount,
                inrSpent: actualInrCost,
                evmAddress,
                stellarTxHash: lockResult.txHash,
                stellarExplorer: `https://stellar.expert/explorer/testnet/tx/${lockResult.txHash}`,
                status: 'locked',
                newWalletBalance: newBalance
            }
        });
        
    } catch (error) {
        console.error(`\n   ❌ Error:`, error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// WEBHOOK: Called by relayer when PAS is sent
// ============================================
app.post('/api/purchase-completed', async (req, res) => {
    const { purchaseId, evmTxHash, evmAddress, stellarEventId, amount } = req.body;
    
    console.log('\n📡 ═══════════════════════════════════════════════════════════════');
    console.log('   💰 WEBHOOK: Purchase Completed (PAS Sent)');
    console.log('═══════════════════════════════════════════════════════════════════');
    console.log(`   📋 EVM TX Hash: ${evmTxHash}`);
    console.log(`   📋 EVM Address: ${evmAddress}`);
    console.log(`   📋 Purchase ID: ${purchaseId || 'N/A'}`);
    console.log(`   📋 Stellar Event ID: ${stellarEventId || 'N/A'}`);
    console.log(`   📋 Amount: ${amount || 'N/A'}`);
    
    if (!evmTxHash) {
        console.log('   ❌ Missing evmTxHash');
        return res.status(400).json({
            success: false,
            error: 'Missing evmTxHash'
        });
    }
    
    try {
        // Find the purchase - try multiple methods
        let purchase = null;
        
        // Method 1: By purchase ID
        if (purchaseId) {
            const { data } = await supabase
                .from('crypto_purchases')
                .select('id, status')
                .eq('id', purchaseId)
                .single();
            purchase = data;
            console.log(`   🔍 Found by purchaseId: ${purchase ? 'YES' : 'NO'}`);
        }
        
        // Method 2: By EVM address (most recent locked/pending one)
        if (!purchase && evmAddress) {
            const normalizedAddress = evmAddress.toLowerCase();
            console.log(`   🔍 Searching by EVM address: ${normalizedAddress}`);
            
            const { data } = await supabase
                .from('crypto_purchases')
                .select('id, status, destination_address')
                .or(`destination_address.eq.${normalizedAddress},destination_address.eq.${evmAddress}`)
                .in('status', ['locked', 'pending'])
                .order('created_at', { ascending: false })
                .limit(1)
                .single();
            purchase = data;
            console.log(`   🔍 Found by evmAddress: ${purchase ? 'YES' : 'NO'}`);
            if (purchase) {
                console.log(`   📋 Matched purchase ID: ${purchase.id}, status: ${purchase.status}`);
            }
        }
        
        if (!purchase) {
            console.log(`   ⚠️  No matching purchase found`);
            
            // List recent purchases for debugging
            const { data: recentPurchases } = await supabase
                .from('crypto_purchases')
                .select('id, destination_address, status, created_at')
                .order('created_at', { ascending: false })
                .limit(5);
            console.log('   📋 Recent purchases:', recentPurchases);
            
            return res.json({ success: true, message: 'No matching purchase found' });
        }
        
        // Update the purchase to completed
        const { error } = await supabase
            .from('crypto_purchases')
            .update({
                evm_tx_hash: evmTxHash,
                status: 'completed',
                completed_at: new Date().toISOString()
            })
            .eq('id', purchase.id);
        
        if (error) throw error;
        
        console.log('   ═══════════════════════════════════════════════════════════');
        console.log(`   ✅ Purchase ${purchase.id} marked as COMPLETED`);
        console.log(`   🔗 EVM TX: ${evmTxHash}`);
        console.log('═══════════════════════════════════════════════════════════════════\n');
        
        res.json({ success: true, purchaseId: purchase.id });
        
    } catch (error) {
        console.error(`   ❌ Error: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================
// PAYBACK: User sends PAS to get INR back
// Flow: User sends PAS to pool → Relayer detects → INR credited to wallet
// ============================================
app.post('/api/payback-pas', async (req, res) => {
    const { userId, pasAmount, evmAddress, stakeId } = req.body;
    
    // Validate inputs
    if (!userId || !pasAmount || !evmAddress) {
        return res.status(400).json({
            success: false,
            error: 'Missing required fields: userId, pasAmount, evmAddress'
        });
    }
    
    if (pasAmount <= 0) {
        return res.status(400).json({
            success: false,
            error: 'pasAmount must be positive'
        });
    }
    
    // Validate EVM address
    if (!ethers.isAddress(evmAddress)) {
        return res.status(400).json({
            success: false,
            error: 'Invalid EVM address'
        });
    }
    
    const normalizedAddress = userId.toLowerCase();
    
    try {
        console.log('\n📤 ═══════════════════════════════════════════════════════════════');
        console.log('   💸 PAYBACK PAS REQUEST');
        console.log('═══════════════════════════════════════════════════════════════════');
        console.log(`   📋 User: ${userId}`);
        console.log(`   📋 PAS Amount: ${pasAmount}`);
        console.log(`   📋 EVM Address: ${evmAddress}`);
        console.log(`   📋 Stake ID: ${stakeId || 'N/A'}`);
        
        // 1. Get current rate
        const rates = await getPasToInrRate();
        // Default: market rate conversion
        let inrToReceive = pasAmount * rates.pasToInr;
        let useStakePrincipal = false;
        let paybackFeePercent = (CONFIG.PAYBACK_FEE_PERCENT || 0);

        // If stakeId provided, fetch the stake / purchase to return original INR (minus fee)
        let paybackRecord = null;
        if (stakeId) {
            const { data: stake } = await supabase
                .from('crypto_purchases')
                .select('id, from_amount, to_amount, status')
                .eq('id', stakeId)
                .eq('user_id', normalizedAddress)
                .single();
            if (stake) {
                paybackRecord = stake;
                useStakePrincipal = true;
                const principalInr = parseFloat(stake.from_amount || 0);
                inrToReceive = principalInr * (1 - paybackFeePercent);
                console.log(`   📋 Using stake principal: ₹${principalInr} → after fee: ₹${inrToReceive.toFixed(2)}`);
            } else {
                console.warn('   ⚠️  Stake ID provided but not found, falling back to market rate');
            }
        }
        
        console.log(`   📈 Rate: 1 PAS = ₹${rates.pasToInr.toFixed(2)}`);
        console.log(`   💰 INR to receive: ₹${inrToReceive.toFixed(2)}`);
        
        // 2. Check user's PAS balance on blockchain
        console.log('\n   🔍 Step 1: Checking PAS balance on blockchain...');
        const balanceResult = await getPasBalance(evmAddress);
        
        if (!balanceResult.success) {
            throw new Error(`Failed to check PAS balance: ${balanceResult.error}`);
        }
        
        const currentPasBalance = parseFloat(balanceResult.balance);
        console.log(`   📊 Current PAS Balance: ${currentPasBalance} PAS`);
        
        if (currentPasBalance < pasAmount) {
            return res.status(400).json({
                success: false,
                error: `Insufficient PAS balance. Have ${currentPasBalance.toFixed(4)} PAS, need ${pasAmount} PAS`
            });
        }
        console.log('   ✅ Sufficient PAS balance');
        
        // 3. Return instructions for the user to send PAS to pool
        // The actual transfer will happen on the frontend via MetaMask
        const poolAddress = CONFIG.EVM_POOL_ADDRESS;
        const amountWei = ethers.parseEther(pasAmount.toString()).toString();
        
        console.log('\n   📝 Step 2: Generating transaction details...');
        console.log(`   📋 Pool Address: ${poolAddress}`);
        console.log(`   📋 Amount (Wei): ${amountWei}`);
        
        // 4. If stakeId provided, update the existing stake to pending_payback status
        // Otherwise just return the transaction details (no new record needed)
        let paybackId = stakeId;
        
        if (stakeId) {
            const { error: updateError } = await supabase
                .from('crypto_purchases')
                .update({
                    status: 'pending_payback'
                })
                .eq('id', stakeId)
                .eq('user_id', normalizedAddress);
            
            if (updateError) {
                console.error('   ⚠️  Failed to update stake status:', updateError.message);
            } else {
                console.log(`   ✅ Stake ${stakeId} marked as pending_payback`);
            }
        }
        
        console.log('\n   ✅ Ready for user to send PAS to pool');
        console.log('═══════════════════════════════════════════════════════════════════\n');
        
        res.json({
            success: true,
            message: 'Please send PAS to the pool address using MetaMask',
            data: {
                paybackId,
                poolAddress,
                amountPas: pasAmount,
                amountWei,
            inrToReceive: inrToReceive.toFixed(2),
                exchangeRate: rates.pasToInr,
                instructions: [
                    '1. Click "Confirm Payback" to open MetaMask',
                    '2. Send the specified PAS amount to the pool',
                    '3. Once confirmed, your INR will be credited automatically'
                ]
            }
        });
        
    } catch (error) {
        console.error(`\n   ❌ Error:`, error.message);
        console.error('═══════════════════════════════════════════════════════════════════\n');
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// WEBHOOK: Called by relayer when PAS payback is detected
// Credits INR to user's wallet
// ============================================
app.post('/api/payback-completed', async (req, res) => {
    const { evmTxHash, evmAddress, pasAmount } = req.body;
    
    if (!evmTxHash || !evmAddress || !pasAmount) {
        return res.status(400).json({
            success: false,
            error: 'Missing required fields: evmTxHash, evmAddress, pasAmount'
        });
    }
    
    const normalizedAddress = evmAddress.toLowerCase();
    
    try {
        console.log('\n📥 ═══════════════════════════════════════════════════════════════');
        console.log('   💰 PAYBACK COMPLETED - Crediting INR');
        console.log('═══════════════════════════════════════════════════════════════════');
        console.log(`   📋 EVM TX: ${evmTxHash}`);
        console.log(`   📋 User: ${evmAddress}`);
        console.log(`   📋 PAS Amount: ${pasAmount}`);
        
        // 1. Get current rate and calculate INR
        const rates = await getPasToInrRate();
        let inrToCredit = parseFloat(pasAmount) * rates.pasToInr;
        // 1b. If there is an associated payback record (stake), prefer original INR provided in record
        const { data: payback } = await supabase
            .from('crypto_purchases')
            .select('id, from_amount')
            .eq('destination_address', normalizedAddress)
            .eq('status', 'pending_payback')
            .order('created_at', { ascending: false })
            .limit(1)
            .single();
        if (payback && payback.from_amount) {
            // If a payback record exists, verify the PAS amount matches
            const expectedPas = parseFloat(payback.to_amount || 0);
            const sentPas = parseFloat(pasAmount);
            const tolerance = 0.000001;
            if (Math.abs(expectedPas - sentPas) > tolerance) {
                console.warn(`   ⚠️ PAS amount mismatch: expected ${expectedPas}, received ${sentPas}. Proceeding to credit based on principal.`);
            }
            const principalInr = parseFloat(payback.from_amount || 0);
            const paybackFeePercent = (CONFIG.PAYBACK_FEE_PERCENT || 0);
            const inrFromPrincipal = principalInr * (1 - paybackFeePercent);
            console.log(`   📋 Using principal-based INR: ₹${principalInr} → after fee: ₹${inrFromPrincipal.toFixed(2)}`);
            inrToCredit = inrFromPrincipal;
        }
        
        console.log(`   📈 Rate: 1 PAS = ₹${rates.pasToInr.toFixed(2)}`);
        console.log(`   💰 INR to credit: ₹${inrToCredit.toFixed(2)}`);
        
        // 2. Get current wallet balance
        const { data: wallet, error: walletError } = await supabase
            .from('wallets')
            .select('balance_inr')
            .eq('wallet_address', normalizedAddress)
            .single();
        
        if (walletError) {
            console.error('   ❌ Wallet not found:', walletError.message);
            throw new Error(`Wallet not found: ${walletError.message}`);
        }
        
        const currentBalance = parseFloat(wallet.balance_inr) || 0;
        const newBalance = currentBalance + inrToCredit;
        
        console.log(`   📊 Current Balance: ₹${currentBalance.toFixed(2)}`);
        console.log(`   📊 New Balance: ₹${newBalance.toFixed(2)}`);
        
        // 3. Update wallet balance
        const { error: updateError } = await supabase
            .from('wallets')
            .update({ 
                balance_inr: newBalance,
                updated_at: new Date().toISOString()
            })
            .eq('wallet_address', normalizedAddress);
        
        if (updateError) {
            throw new Error(`Failed to update wallet: ${updateError.message}`);
        }
        
        console.log('   ✅ Wallet balance updated');
        
        // 4. Update payback record if exists
        if (payback) {
            await supabase
                .from('crypto_purchases')
                .update({
                    evm_tx_hash: evmTxHash,
                    status: 'paid_back',
                    completed_at: new Date().toISOString()
                })
                .eq('id', payback.id);
            
            console.log(`   ✅ Payback record ${payback.id} updated`);
        }
        
        console.log('\n   🎉 PAYBACK SUCCESSFUL!');
        console.log(`   💰 ₹${inrToCredit.toFixed(2)} credited to wallet`);
        console.log('═══════════════════════════════════════════════════════════════════\n');
        
        res.json({
            success: true,
            data: {
                inrCredited: inrToCredit,
                newBalance,
                evmTxHash
            }
        });
        
    } catch (error) {
        console.error(`   ❌ Error:`, error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================
// LENDING PROTOCOL: BORROW PAS WITH COLLATERAL
// ============================================

/**
 * Get XLM price in INR from CoinGecko
 */
async function getXlmPrice() {
    try {
        const response = await fetch(
            `${CONFIG.COINGECKO_API}/simple/price?ids=stellar&vs_currencies=inr`
        );
        const data = await response.json();
        return data['stellar']?.inr || 18.92; // Fallback price
    } catch (error) {
        console.error('Error fetching XLM price:', error.message);
        return 18.92; // Fallback
    }
}

/**
 * Create a new collateralized loan
 * User locks XLM as collateral and borrows PAS tokens
 */
app.post('/api/borrow-pas', async (req, res) => {
    const { 
        userId, 
        borrowAmountInr, 
        evmAddress, 
        loanType = 'standard',
        ltvRatio = 60,  // User's chosen LTV (50-75%)
        customDuration = null 
    } = req.body;
    
    // Validate inputs
    if (!userId || !borrowAmountInr || !evmAddress) {
        return res.status(400).json({
            success: false,
            error: 'Missing required fields: userId, borrowAmountInr, evmAddress'
        });
    }
    
    if (borrowAmountInr < LENDING_CONFIG.LTV.MIN_BORROW_INR) {
        return res.status(400).json({
            success: false,
            error: `Minimum borrow amount is ₹${LENDING_CONFIG.LTV.MIN_BORROW_INR}`
        });
    }
    
    // Validate EVM address
    if (!ethers.isAddress(evmAddress)) {
        return res.status(400).json({
            success: false,
            error: 'Invalid EVM address'
        });
    }
    
    // Get loan type configuration
    const loanTypeConfig = LENDING_CONFIG.LOAN_TYPES[loanType];
    if (!loanTypeConfig && loanType !== 'custom') {
        return res.status(400).json({
            success: false,
            error: 'Invalid loan type. Use: short, standard, long, or custom'
        });
    }
    
    // Validate LTV ratio
    const maxLtv = loanTypeConfig?.maxLtv || 0.75;
    const userLtv = ltvRatio / 100;
    if (userLtv < 0.5 || userLtv > maxLtv) {
        return res.status(400).json({
            success: false,
            error: `LTV must be between 50% and ${maxLtv * 100}% for ${loanType} loans`
        });
    }
    
    const normalizedAddress = userId.toLowerCase();
    
    try {
        console.log('\n📡 ═══════════════════════════════════════════════════════════════');
        console.log('   🏦 NEW COLLATERALIZED LOAN REQUEST');
        console.log('═══════════════════════════════════════════════════════════════════');
        console.log(`   📋 User: ${userId}`);
        console.log(`   📋 Borrow Amount: ₹${borrowAmountInr}`);
        console.log(`   📋 EVM Address: ${evmAddress}`);
        console.log(`   📋 Loan Type: ${loanType}`);
        console.log(`   📋 LTV Ratio: ${ltvRatio}%`);
        
        // 1. Get current prices
        const [xlmPrice, pasRates] = await Promise.all([
            getXlmPrice(),
            getPasToInrRate()
        ]);
        
        console.log(`\n   💰 Current Prices:`);
        console.log(`   📈 XLM: ₹${xlmPrice.toFixed(2)}`);
        console.log(`   📈 PAS: ₹${pasRates.pasToInr.toFixed(2)}`);
        
        // 2. Calculate loan parameters
        const duration = loanTypeConfig?.duration || customDuration || 30;
        const interestRate = loanTypeConfig?.interestRate || getInterestRateForDuration(duration);
        
        // Calculate required collateral based on user's chosen LTV
        const collateralInr = borrowAmountInr / userLtv;
        const collateralXlm = collateralInr / xlmPrice;
        
        // Calculate PAS to receive
        const pasAmount = borrowAmountInr / pasRates.pasToInr;
        
        // Calculate health factor
        const healthFactor = calculateHealthFactor(collateralInr, borrowAmountInr);
        
        // Calculate liquidation price
        const liquidationPrice = calculateLiquidationPrice(borrowAmountInr, collateralXlm);
        
        // Calculate estimated interest
        const interestEstimate = calculateAccruedInterest(borrowAmountInr, interestRate, duration);
        
        // Set deadlines
        const loanStartDate = new Date();
        const repaymentDeadline = new Date(loanStartDate.getTime() + duration * 24 * 60 * 60 * 1000);
        const gracePeriodEnds = new Date(repaymentDeadline.getTime() + LENDING_CONFIG.LIQUIDATION.GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000);
        
        console.log(`\n   📊 Loan Calculation:`);
        console.log(`   📋 Collateral Required: ₹${collateralInr.toFixed(2)} (${collateralXlm.toFixed(4)} XLM)`);
        console.log(`   📋 PAS to Receive: ${pasAmount.toFixed(4)} PAS`);
        console.log(`   📋 Health Factor: ${healthFactor.toFixed(2)}`);
        console.log(`   📋 Liquidation Price: ₹${liquidationPrice.toFixed(2)}/XLM`);
        console.log(`   📋 Duration: ${duration} days`);
        console.log(`   📋 Interest Rate: ${(interestRate * 100).toFixed(1)}% APY`);
        console.log(`   📋 Est. Interest: ₹${interestEstimate.interestAccrued.toFixed(2)}`);
        console.log(`   📋 Deadline: ${repaymentDeadline.toISOString()}`);
        
        // 3. Validate minimum collateral
        if (collateralInr < LENDING_CONFIG.LTV.MIN_COLLATERAL_INR) {
            return res.status(400).json({
                success: false,
                error: `Minimum collateral is ₹${LENDING_CONFIG.LTV.MIN_COLLATERAL_INR}`
            });
        }
        
        // 4. Check user's INR balance for collateral
        const { data: wallet, error: walletError } = await supabase
            .from('wallets')
            .select('balance_inr')
            .eq('wallet_address', normalizedAddress)
            .single();
        
        if (walletError) {
            throw new Error(`Wallet not found: ${walletError.message}`);
        }
        
        const currentBalance = parseFloat(wallet.balance_inr) || 0;
        console.log(`\n   💳 User Balance: ₹${currentBalance.toFixed(2)}`);
        
        if (currentBalance < collateralInr) {
            return res.status(400).json({
                success: false,
                error: `Insufficient balance for collateral. Need ₹${collateralInr.toFixed(2)}, have ₹${currentBalance.toFixed(2)}`
            });
        }
        
        // 5. Lock XLM on Stellar blockchain
        console.log(`\n   🔗 Step 1: Locking collateral on Stellar blockchain...`);
        const lockResult = await lockXlmOnStellar(collateralXlm, evmAddress);
        
        if (!lockResult.success) {
            console.error(`   ❌ Blockchain transaction failed: ${lockResult.error}`);
            return res.status(500).json({
                success: false,
                error: `Failed to lock collateral: ${lockResult.error}`
            });
        }
        
        console.log(`   ✅ XLM locked successfully!`);
        console.log(`   🔗 TX Hash: ${lockResult.txHash}`);
        
        // 6. Create loan record in database (using lending_loans table)
        console.log(`\n   📝 Step 2: Recording loan in database...`);
        
        const { data: loan, error: insertError } = await supabase
            .from('lending_loans')
            .insert({
                user_id: normalizedAddress,
                collateral_xlm: collateralXlm,
                collateral_value_inr: collateralInr,
                borrowed_pas: pasAmount,
                borrowed_value_inr: borrowAmountInr,
                ltv_ratio: userLtv,
                interest_rate_apy: interestRate,
                loan_type: loanType,
                loan_duration_days: duration,
                health_factor: healthFactor,
                liquidation_price: liquidationPrice,
                loan_start_date: loanStartDate.toISOString(),
                repayment_deadline: repaymentDeadline.toISOString(),
                stellar_lock_tx_hash: lockResult.txHash,
                status: 'active'
            })
            .select()
            .single();
        
        if (insertError) {
            console.error(`   ⚠️  Database insert failed: ${insertError.message}`);
            // Blockchain succeeded but DB failed - critical error
            return res.status(500).json({
                success: false,
                error: 'Loan recorded on blockchain but database save failed. Contact support.',
                stellarTxHash: lockResult.txHash
            });
        }
        
        console.log(`   ✅ Loan record created: ${loan.id}`);
        
        // 7. Deduct collateral value from wallet (as it's now locked)
        const newBalance = currentBalance - collateralInr;
        
        const { error: updateError } = await supabase
            .from('wallets')
            .update({ 
                balance_inr: newBalance,
                updated_at: new Date().toISOString()
            })
            .eq('wallet_address', normalizedAddress);
        
        if (updateError) {
            console.error(`   ⚠️  Wallet update failed: ${updateError.message}`);
        } else {
            console.log(`   ✅ Wallet updated: ₹${currentBalance.toFixed(2)} → ₹${newBalance.toFixed(2)}`);
        }
        
        // 8. SEND PAS TOKENS TO USER
        console.log(`\n   💸 Step 3: Sending ${pasAmount.toFixed(4)} PAS to ${evmAddress}...`);
        console.log(`   📋 EVM Pool Contract configured: ${evmPoolContract ? 'YES' : 'NO'}`);
        console.log(`   📋 EVM Relayer Wallet configured: ${evmRelayerWallet ? 'YES' : 'NO'}`);
        
        const pasResult = await sendPasFromPool(evmAddress, pasAmount);
        
        let evmTxHash = null;
        if (pasResult.success) {
            evmTxHash = pasResult.txHash;
            console.log(`   ✅ PAS sent! TX: ${evmTxHash}`);
            
            // Update loan record with EVM TX hash
            await supabase
                .from('crypto_purchases')
                .update({ evm_tx_hash: evmTxHash })
                .eq('id', loan.id);
        } else {
            console.error(`   ⚠️  Failed to send PAS: ${pasResult.error}`);
            console.error(`   ℹ️  Loan created but PAS not sent. User can retry or contact support.`);
        }
        
        console.log('\n   ═══════════════════════════════════════════════════════════');
        console.log('   🎉 LOAN CREATED SUCCESSFULLY!');
        console.log('   ═══════════════════════════════════════════════════════════');
        console.log(`   📋 Loan ID: ${loan.id}`);
        console.log(`   💎 Collateral: ${collateralXlm.toFixed(4)} XLM (₹${collateralInr.toFixed(2)})`);
        console.log(`   🟣 Borrowed: ${pasAmount.toFixed(4)} PAS (₹${borrowAmountInr.toFixed(2)})`);
        console.log(`   📈 Health Factor: ${healthFactor.toFixed(2)}`);
        console.log(`   ⏰ Deadline: ${repaymentDeadline.toLocaleDateString()}`);
        if (evmTxHash) {
            console.log(`   🔗 PAS TX: ${evmTxHash}`);
        }
        console.log('═══════════════════════════════════════════════════════════════════\n');
        
        // 9. Return loan details
        res.json({
            success: true,
            message: pasResult.success 
                ? 'Loan created successfully! PAS tokens have been sent to your wallet.'
                : 'Loan created but PAS transfer pending. Please check your wallet or contact support.',
            pasSent: pasResult.success,
            data: {
                loanId: loan.id,
                
                // Collateral info
                collateralXlm,
                collateralValueInr: collateralInr,
                
                // Loan info
                borrowedPas: pasAmount,
                borrowedValueInr: borrowAmountInr,
                
                // Terms
                loanType,
                duration,
                interestRate: interestRate * 100,
                ltvRatio: userLtv * 100,
                
                // Risk metrics
                healthFactor,
                liquidationPrice,
                liquidationThreshold: LENDING_CONFIG.LTV.LIQUIDATION_THRESHOLD * 100,
                
                // Deadlines
                loanStartDate: loanStartDate.toISOString(),
                repaymentDeadline: repaymentDeadline.toISOString(),
                gracePeriodEnds: gracePeriodEnds.toISOString(),
                
                // Estimated costs
                estimatedInterest: interestEstimate.interestAccrued,
                estimatedTotalRepay: borrowAmountInr + interestEstimate.interestAccrued,
                
                // Transaction
                stellarTxHash: lockResult.txHash,
                stellarExplorer: `https://stellar.expert/explorer/testnet/tx/${lockResult.txHash}`,
                evmTxHash: evmTxHash,
                evmExplorer: evmTxHash ? `https://blockscout-asset-hub-paseo.parity-chains-scoutplorer.io/tx/${evmTxHash}` : null,
                evmAddress,
                status: 'active',
                
                // Wallet
                newWalletBalance: newBalance
            }
        });
        
    } catch (error) {
        console.error(`\n   ❌ Error:`, error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Get loan details with current health factor
 */
app.get('/api/loan/:loanId', async (req, res) => {
    const { loanId } = req.params;
    
    try {
        // Fetch loan from lending_loans table\n        const { data: loan, error } = await supabase\n            .from('lending_loans')\n            .select('*')\n            .eq('id', loanId)\n            .single();
        
        if (error || !loan) {
            return res.status(404).json({
                success: false,
                error: 'Loan not found'
            });
        }
        
        // Get current prices
        const xlmPrice = await getXlmPrice();
        const pasRates = await getPasToInrRate();
        
        // Calculate current values
        const currentCollateralValue = loan.collateral_xlm * xlmPrice;
        const daysElapsed = daysBetween(loan.loan_start_date, new Date());
        const daysUntilDeadline = daysBetween(new Date(), loan.repayment_deadline);
        
        // Calculate accrued interest
        const interest = calculateAccruedInterest(
            loan.borrowed_value_inr,
            loan.interest_rate_apy,
            daysElapsed
        );
        
        // Calculate late fee if overdue
        const daysOverdue = Math.max(0, -daysUntilDeadline);
        const lateFee = calculateLateFee(
            loan.borrowed_value_inr + interest.interestAccrued,
            daysOverdue
        );
        
        // Total debt
        const totalDebt = loan.borrowed_value_inr + interest.interestAccrued + lateFee;
        
        // Current health factor
        const currentHealthFactor = calculateHealthFactor(currentCollateralValue, totalDebt);
        
        // Current liquidation price
        const currentLiquidationPrice = calculateLiquidationPrice(totalDebt, loan.collateral_xlm);
        
        // Health status
        const healthStatus = LENDING_CONFIG.HEALTH_FACTOR.getStatus(currentHealthFactor);
        
        res.json({
            success: true,
            loan: {
                id: loan.id,
                userId: loan.user_id,
                status: loan.status,
                
                // Collateral
                collateralXlm: loan.collateral_xlm,
                collateralValueAtCreation: loan.collateral_value_inr,
                currentCollateralValue,
                
                // Borrowed
                borrowedPas: loan.borrowed_pas,
                borrowedValueInr: loan.borrowed_value_inr,
                
                // Interest
                interestRateApy: loan.interest_rate_apy * 100,
                interestAccrued: interest.interestAccrued,
                dailyInterest: interest.dailyInterest,
                
                // Late fees
                daysOverdue,
                lateFee,
                
                // Total
                totalDebt,
                
                // Health
                healthFactor: currentHealthFactor,
                healthStatus: healthStatus.status,
                healthLabel: healthStatus.label,
                healthColor: healthStatus.color,
                
                // Liquidation
                liquidationPrice: currentLiquidationPrice,
                liquidationThreshold: loan.liquidation_threshold * 100,
                isLiquidatable: currentHealthFactor < 1.0,
                
                // Dates
                loanStartDate: loan.loan_start_date,
                repaymentDeadline: loan.repayment_deadline,
                gracePeriodEnds: loan.grace_period_ends,
                daysElapsed,
                daysUntilDeadline,
                isOverdue: daysUntilDeadline < 0,
                
                // Loan type
                loanType: loan.loan_type,
                durationDays: loan.loan_duration_days,
                
                // Transactions
                stellarTxHash: loan.stellar_tx_hash,
                evmTxHash: loan.evm_tx_hash,
                
                // Current prices
                currentXlmPrice: xlmPrice,
                currentPasPrice: pasRates.pasToInr
            }
        });
        
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * Get all active loans for a user
 */
app.get('/api/loans/:userId', async (req, res) => {
    const { userId } = req.params;
    const normalizedAddress = userId.toLowerCase();
    
    try {
        // Fetch all active loans for user from lending_loans table
        const { data: loans, error } = await supabase
            .from('lending_loans')
            .select('*')
            .eq('user_id', normalizedAddress)
            .eq('status', 'active')
            .order('created_at', { ascending: false });
        
        if (error) throw error;
        
        // Get current prices
        const xlmPrice = await getXlmPrice();
        const pasRates = await getPasToInrRate();
        
        // Enrich each loan with current calculations
        const enrichedLoans = loans.map(loan => {
            const currentCollateralValue = loan.collateral_xlm * xlmPrice;
            const daysElapsed = daysBetween(loan.loan_start_date || loan.created_at, new Date());
            const daysUntilDeadline = daysBetween(new Date(), loan.repayment_deadline || loan.created_at);
            
            const interest = calculateAccruedInterest(
                loan.borrowed_value_inr || loan.from_amount,
                loan.interest_rate_apy || 0.08,
                daysElapsed
            );
            
            const daysOverdue = Math.max(0, -daysUntilDeadline);
            const lateFee = calculateLateFee(
                (loan.borrowed_value_inr || loan.from_amount) + interest.interestAccrued,
                daysOverdue
            );
            
            const totalDebt = (loan.borrowed_value_inr || loan.from_amount) + interest.interestAccrued + lateFee;
            const currentHealthFactor = calculateHealthFactor(currentCollateralValue, totalDebt);
            const healthStatus = LENDING_CONFIG.HEALTH_FACTOR.getStatus(currentHealthFactor);
            
            return {
                ...loan,
                currentCollateralValue,
                interestAccrued: interest.interestAccrued,
                lateFee,
                totalDebt,
                healthFactor: currentHealthFactor,
                healthStatus: healthStatus.status,
                healthLabel: healthStatus.label,
                daysUntilDeadline,
                isOverdue: daysUntilDeadline < 0
            };
        });
        
        res.json({
            success: true,
            loans: enrichedLoans,
            count: enrichedLoans.length,
            prices: {
                xlm: xlmPrice,
                pas: pasRates.pasToInr
            }
        });
        
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * Get active loan summary (counts and total collateral/borrowed) from active_loans view
 */
app.get('/api/loans/:userId/summary', async (req, res) => {
    const { userId } = req.params;
    const normalizedAddress = userId.toLowerCase();
    try {
        const { data, error } = await supabase
            .from('active_loans')
            .select('*')
            .eq('user_id', normalizedAddress)
            .single();
        if (error) throw error;
        // If no active loans, return zeros
        if (!data) {
            return res.json({ success: true, summary: { loan_count: 0, total_collateral_xlm: 0, total_borrowed_pas: 0, total_borrowed_inr: 0 } });
        }
        res.json({ success: true, summary: data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * Get lending configuration (for frontend)
 */
app.get('/api/lending/config', async (req, res) => {
    try {
        const xlmPrice = await getXlmPrice();
        const pasRates = await getPasToInrRate();
        
        res.json({
            success: true,
            config: {
                ltv: {
                    maxLtv: LENDING_CONFIG.LTV.MAX_LTV * 100,
                    liquidationThreshold: LENDING_CONFIG.LTV.LIQUIDATION_THRESHOLD * 100,
                    minCollateral: LENDING_CONFIG.LTV.MIN_COLLATERAL_INR,
                    minBorrow: LENDING_CONFIG.LTV.MIN_BORROW_INR
                },
                loanTypes: LENDING_CONFIG.LOAN_TYPES,
                interest: {
                    baseApy: LENDING_CONFIG.INTEREST.BASE_APY * 100,
                    rateByDuration: Object.fromEntries(
                        Object.entries(LENDING_CONFIG.INTEREST.RATE_BY_DURATION)
                            .map(([k, v]) => [k, v * 100])
                    )
                },
                liquidation: {
                    penalty: LENDING_CONFIG.LIQUIDATION.PENALTY * 100,
                    gracePeriodDays: LENDING_CONFIG.LIQUIDATION.GRACE_PERIOD_DAYS
                },
                deadlines: {
                    lateFeePerDay: LENDING_CONFIG.DEADLINES.LATE_FEE_PERCENT_PER_DAY * 100,
                    maxLateDays: LENDING_CONFIG.DEADLINES.MAX_LATE_DAYS,
                    gracePeriodDays: LENDING_CONFIG.DEADLINES.GRACE_PERIOD_DAYS
                },
                healthFactor: {
                    safe: LENDING_CONFIG.HEALTH_FACTOR.SAFE_THRESHOLD,
                    warning: LENDING_CONFIG.HEALTH_FACTOR.WARNING_THRESHOLD,
                    danger: LENDING_CONFIG.HEALTH_FACTOR.DANGER_THRESHOLD
                }
            },
            prices: {
                xlm: xlmPrice,
                pas: pasRates.pasToInr
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * Calculate loan preview (without creating)
 */
app.post('/api/lending/preview', async (req, res) => {
    const { borrowAmountInr, ltvRatio = 60, loanType = 'standard', customDuration = null } = req.body;
    
    if (!borrowAmountInr || borrowAmountInr <= 0) {
        return res.status(400).json({
            success: false,
            error: 'borrowAmountInr is required'
        });
    }
    
    try {
        const xlmPrice = await getXlmPrice();
        const pasRates = await getPasToInrRate();
        
        const loanTypeConfig = LENDING_CONFIG.LOAN_TYPES[loanType];
        const duration = loanTypeConfig?.duration || customDuration || 30;
        const interestRate = loanTypeConfig?.interestRate || getInterestRateForDuration(duration);
        const maxLtv = loanTypeConfig?.maxLtv || 0.75;
        
        const userLtv = Math.min(ltvRatio / 100, maxLtv);
        const collateralInr = borrowAmountInr / userLtv;
        const collateralXlm = collateralInr / xlmPrice;
        const pasAmount = borrowAmountInr / pasRates.pasToInr;
        
        const healthFactor = calculateHealthFactor(collateralInr, borrowAmountInr);
        const liquidationPrice = calculateLiquidationPrice(borrowAmountInr, collateralXlm);
        const interest = calculateAccruedInterest(borrowAmountInr, interestRate, duration);
        
        const priceDropToLiquidation = ((xlmPrice - liquidationPrice) / xlmPrice * 100).toFixed(1);
        
        res.json({
            success: true,
            preview: {
                // What user provides
                collateralXlm,
                collateralValueInr: collateralInr,
                
                // What user receives
                borrowedPas: pasAmount,
                borrowedValueInr: borrowAmountInr,
                
                // Terms
                loanType,
                duration,
                interestRate: interestRate * 100,
                maxLtv: maxLtv * 100,
                actualLtv: userLtv * 100,
                
                // Risk
                healthFactor,
                liquidationPrice,
                priceDropToLiquidation,
                
                // Costs
                estimatedInterest: interest.interestAccrued,
                dailyInterest: interest.dailyInterest,
                totalToRepay: borrowAmountInr + interest.interestAccrued,
                
                // Deadlines
                deadline: new Date(Date.now() + duration * 24 * 60 * 60 * 1000).toISOString(),
                
                // Prices used
                xlmPrice,
                pasPrice: pasRates.pasToInr
            }
        });
        
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * Repay a loan
 * User sends PAS tokens back to repay loan, collateral XLM is released
 * Flow: User sends PAS to pool → Backend verifies → Loan marked repaid → Collateral released
 */
app.post('/api/lending/repay', async (req, res) => {
    const { userId, loanId, txHash } = req.body;
    
    if (!userId || !loanId) {
        return res.status(400).json({
            success: false,
            error: 'Missing required fields: userId, loanId'
        });
    }
    
    const normalizedAddress = userId.toLowerCase();
    
    try {
        console.log('\n💰 ═══════════════════════════════════════════════════════════════');
        console.log('   🏦 LOAN REPAYMENT REQUEST (PAS)');
        console.log('═══════════════════════════════════════════════════════════════════');
        console.log(`   📋 User: ${normalizedAddress}`);
        console.log(`   📋 Loan ID: ${loanId}`);
        if (txHash) console.log(`   📋 TX Hash: ${txHash}`);
        
        // 1. Fetch the loan from lending_loans table
        const { data: loan, error: loanError } = await supabase
            .from('lending_loans')
            .select('*')
            .eq('id', loanId)
            .eq('user_id', normalizedAddress)
            .single();
        
        if (loanError || !loan) {
            return res.status(404).json({
                success: false,
                error: 'Loan not found'
            });
        }
        
        if (loan.status === 'repaid' || loan.status === 'liquidated') {
            return res.status(400).json({
                success: false,
                error: `Loan already ${loan.status}`
            });
        }
        
        // 2. Calculate total debt in PAS
        const xlmPrice = await getXlmPrice();
        const pasRates = await getPasToInrRate();
        const daysElapsed = daysBetween(loan.loan_start_date || loan.created_at, new Date());
        const daysUntilDeadline = daysBetween(new Date(), loan.repayment_deadline || loan.created_at);
        
        // Calculate interest and fees in INR first
        const principalInr = loan.borrowed_value_inr || loan.from_amount;
        const interest = calculateAccruedInterest(
            principalInr,
            loan.interest_rate_apy || 0.08,
            daysElapsed
        );
        
        const daysOverdue = Math.max(0, -daysUntilDeadline);
        const lateFee = calculateLateFee(
            principalInr + interest.interestAccrued,
            daysOverdue
        );
        
        const totalDebtInr = principalInr + interest.interestAccrued + lateFee;
        
        // Convert to PAS
        const principalPas = loan.borrowed_pas || (principalInr / pasRates.pasToInr);
        const interestPas = interest.interestAccrued / pasRates.pasToInr;
        const lateFeePas = lateFee / pasRates.pasToInr;
        const totalDebtPas = totalDebtInr / pasRates.pasToInr;
        
        console.log(`   📊 Principal: ${principalPas.toFixed(4)} PAS (₹${principalInr.toFixed(2)})`);
        console.log(`   📊 Interest: ${interestPas.toFixed(4)} PAS (₹${interest.interestAccrued.toFixed(2)})`);
        console.log(`   📊 Late Fee: ${lateFeePas.toFixed(4)} PAS (₹${lateFee.toFixed(2)})`);
        console.log(`   📊 Total Due: ${totalDebtPas.toFixed(4)} PAS (₹${totalDebtInr.toFixed(2)})`);
        
        // 3. Return repayment info for frontend to execute transfer
        // The frontend will send PAS to the pool, then call back with txHash
        if (!txHash) {
            // First call - return amount needed
            return res.json({
                success: true,
                action: 'send_pas',
                repaymentDetails: {
                    poolAddress: CONFIG.EVM_POOL_ADDRESS,
                    principalPas,
                    interestPas,
                    lateFeePas,
                    totalPas: totalDebtPas,
                    totalInr: totalDebtInr,
                    pasPrice: pasRates.pasToInr
                },
                loan: {
                    id: loanId,
                    collateralXlm: loan.collateral_xlm,
                    collateralValueInr: loan.collateral_xlm * xlmPrice
                }
            });
        }
        
        // 4. Second call - verify transaction and mark loan as repaid
        console.log(`   🔍 Verifying PAS transfer...`);
        console.log(`   📋 TX Hash: ${txHash}`);
        
        // TODO: Verify the transaction on-chain (for now, trust the txHash)
        // In production, verify that:
        // - Transaction exists and is confirmed
        // - Amount sent >= totalDebtPas
        // - Recipient is the pool address
        
        // 5. Update loan status in lending_loans table
        const { error: updateError } = await supabase
            .from('lending_loans')
            .update({
                status: 'repaid',
                repaid_at: new Date().toISOString(),
                repaid_pas: totalDebtPas,
                repaid_value_inr: totalDebtInr,
                interest_paid: interest.interestAccrued,
                late_fee_paid: lateFee,
                repay_tx_hash: txHash
            })
            .eq('id', loanId);
        
        if (updateError) {
            console.error(`   ❌ Failed to update loan status:`, updateError);
            throw new Error('Failed to update loan status');
        }
        
        console.log(`   ✅ Loan marked as REPAID`);
        
        // 6. Get collateral info
        const collateralXlm = loan.collateral_xlm || 0;
        // Use original collateral value (what user put in), not current market value
        const collateralValueToReturn = loan.collateral_value_inr || (collateralXlm * xlmPrice);
        
        // 7. Credit collateral value back to user's wallet
        console.log(`   💰 Crediting collateral back to wallet...`);
        
        const { data: wallet, error: walletFetchError } = await supabase
            .from('wallets')
            .select('balance_inr')
            .eq('wallet_address', normalizedAddress)
            .single();
        
        if (walletFetchError) {
            console.error(`   ⚠️ Could not fetch wallet for collateral credit:`, walletFetchError.message);
        } else {
            const currentBalance = parseFloat(wallet.balance_inr) || 0;
            const newBalance = currentBalance + collateralValueToReturn;
            
            const { error: walletUpdateError } = await supabase
                .from('wallets')
                .update({
                    balance_inr: newBalance,
                    updated_at: new Date().toISOString()
                })
                .eq('wallet_address', normalizedAddress);
            
            if (walletUpdateError) {
                console.error(`   ⚠️ Failed to credit collateral to wallet:`, walletUpdateError.message);
            } else {
                console.log(`   ✅ Collateral credited: ₹${collateralValueToReturn.toFixed(2)} (${currentBalance.toFixed(2)} → ${newBalance.toFixed(2)})`);
            }
        }
        
        console.log('\n═══════════════════════════════════════════════════════════════════');
        console.log('   ✅ LOAN REPAID SUCCESSFULLY!');
        console.log('═══════════════════════════════════════════════════════════════════');
        console.log(`   🔓 Collateral Released: ${collateralXlm.toFixed(4)} XLM (₹${collateralValueToReturn.toFixed(2)})`);
        console.log(`   💰 Total Paid: ${totalDebtPas.toFixed(4)} PAS (₹${totalDebtInr.toFixed(2)})`);
        console.log('═══════════════════════════════════════════════════════════════════\n');
        
        res.json({
            success: true,
            message: 'Loan repaid successfully',
            repayment: {
                principalPas,
                interestPas,
                lateFeePas,
                totalPaidPas: totalDebtPas,
                totalPaidInr: totalDebtInr,
                txHash
            },
            collateral: {
                xlm: collateralXlm,
                valueInr: collateralValueToReturn,
                message: 'Your XLM collateral value has been credited back to your wallet.'
            }
        });
        
    } catch (error) {
        console.error('   ❌ Repayment error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * Add more collateral to an existing loan
 * Improves health factor and reduces liquidation risk
 */
app.post('/api/lending/add-collateral', async (req, res) => {
    const { userId, loanId, additionalXlm } = req.body;
    
    if (!userId || !loanId || !additionalXlm) {
        return res.status(400).json({
            success: false,
            error: 'Missing required fields: userId, loanId, additionalXlm'
        });
    }
    
    const normalizedAddress = userId.toLowerCase();
    
    try {
        console.log('\n📈 ═══════════════════════════════════════════════════════════════');
        console.log('   🏦 ADD COLLATERAL REQUEST');
        console.log('═══════════════════════════════════════════════════════════════════');
        console.log(`   📋 User: ${normalizedAddress}`);
        console.log(`   📋 Loan ID: ${loanId}`);
        console.log(`   📋 Additional XLM: ${additionalXlm}`);
        
        // 1. Fetch the loan from lending_loans table
        const { data: loan, error: loanError } = await supabase
            .from('lending_loans')
            .select('*')
            .eq('id', loanId)
            .eq('user_id', normalizedAddress)
            .single();
        
        if (loanError || !loan) {
            return res.status(404).json({
                success: false,
                error: 'Loan not found'
            });
        }
        
        if (loan.status === 'repaid' || loan.status === 'liquidated') {
            return res.status(400).json({
                success: false,
                error: `Cannot add collateral to ${loan.status} loan`
            });
        }
        
        // 2. Calculate new collateral and health factor
        const xlmPrice = await getXlmPrice();
        const currentCollateral = loan.collateral_xlm || 0;
        const newCollateral = currentCollateral + parseFloat(additionalXlm);
        const newCollateralValue = newCollateral * xlmPrice;
        
        const daysElapsed = daysBetween(loan.loan_start_date || loan.created_at, new Date());
        const interest = calculateAccruedInterest(
            loan.borrowed_value_inr || loan.from_amount,
            loan.interest_rate_apy || 0.08,
            daysElapsed
        );
        
        const totalDebt = (loan.borrowed_value_inr || loan.from_amount) + interest.interestAccrued;
        const oldHealthFactor = calculateHealthFactor(currentCollateral * xlmPrice, totalDebt);
        const newHealthFactor = calculateHealthFactor(newCollateralValue, totalDebt);
        const newLiquidationPrice = calculateLiquidationPrice(totalDebt, newCollateral);
        
        console.log(`   📊 Current Collateral: ${currentCollateral.toFixed(4)} XLM`);
        console.log(`   📊 New Collateral: ${newCollateral.toFixed(4)} XLM`);
        console.log(`   📊 Health Factor: ${oldHealthFactor.toFixed(2)} → ${newHealthFactor.toFixed(2)}`);
        console.log(`   📊 New Liquidation Price: ₹${newLiquidationPrice.toFixed(2)}`);
        
        // 3. Update loan with new collateral in lending_loans table
        const { error: updateError } = await supabase
            .from('lending_loans')
            .update({
                collateral_xlm: newCollateral,
                health_factor: newHealthFactor,
                liquidation_price: newLiquidationPrice
            })
            .eq('id', loanId);
        
        if (updateError) {
            console.error(`   ❌ Failed to update collateral:`, updateError);
            throw new Error('Failed to update collateral');
        }
        
        console.log('\n═══════════════════════════════════════════════════════════════════');
        console.log('   ✅ COLLATERAL ADDED SUCCESSFULLY!');
        console.log('═══════════════════════════════════════════════════════════════════\n');
        
        res.json({
            success: true,
            message: 'Collateral added successfully',
            loan: {
                id: loanId,
                collateral: {
                    previous: currentCollateral,
                    added: parseFloat(additionalXlm),
                    new: newCollateral,
                    valueInr: newCollateralValue
                },
                healthFactor: {
                    previous: oldHealthFactor,
                    new: newHealthFactor,
                    improvement: newHealthFactor - oldHealthFactor
                },
                liquidationPrice: newLiquidationPrice,
                xlmPrice
            }
        });
        
    } catch (error) {
        console.error('   ❌ Add collateral error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================
// TEST ENDPOINT: Add balance to user wallet
// ============================================
app.post('/api/test/add-balance', async (req, res) => {
    const { userId, amount } = req.body;
    
    if (!userId || !amount) {
        return res.status(400).json({
            success: false,
            error: 'Missing userId or amount'
        });
    }
    
    try {
        const normalizedAddress = userId.toLowerCase();
        
        // Check if wallet exists
        const { data: existing } = await supabase
            .from('wallets')
            .select('balance_inr')
            .eq('wallet_address', normalizedAddress)
            .single();
        
        if (existing) {
            // Update existing wallet
            const newBalance = parseFloat(existing.balance_inr) + amount;
            await supabase
                .from('wallets')
                .update({ balance_inr: newBalance })
                .eq('wallet_address', normalizedAddress);
            
            res.json({
                success: true,
                message: `Added ₹${amount} to wallet`,
                newBalance
            });
        } else {
            // Create new wallet
            await supabase
                .from('wallets')
                .insert({ wallet_address: normalizedAddress, balance_inr: amount });
            
            res.json({
                success: true,
                message: `Created wallet with ₹${amount}`,
                newBalance: amount
            });
        }
        
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================
// START SERVER
// ============================================
app.listen(CONFIG.PORT, () => {
    console.log(`\n🚀 Polar Bridge API Server running on port ${CONFIG.PORT}`);
    console.log(`\n📡 Endpoints:`);
    console.log(`   GET  /health                    - Health check`);
    console.log(`   POST /create-order              - Create Razorpay order`);
    console.log(`   POST /verify-payment            - Verify Razorpay payment`);
    console.log(`   GET  /api/rates                 - Get PAS/INR exchange rate`);
    console.log(`   GET  /api/wallet/:userId        - Get user's INR balance`);
    console.log(`   GET  /api/purchases/:userId     - Get user's purchase history`);
    console.log(`   GET  /api/pas-balance/:address  - Get real PAS balance from Paseo`);
    console.log(`   POST /api/buy-pas               - Buy PAS tokens with INR`);
    console.log(`   POST /api/purchase-completed    - Webhook for relayer`);
    console.log(`\n   🏦 LENDING PROTOCOL:`);
    console.log(`   POST /api/borrow-pas            - Create collateralized loan`);
    console.log(`   GET  /api/loan/:loanId          - Get loan details`);
    console.log(`   GET  /api/loans/:userId         - Get all user loans`);
    console.log(`   GET  /api/lending/config        - Get lending configuration`);
    console.log(`   POST /api/lending/preview       - Preview loan calculation`);
    console.log(`\n   🧪 TEST:`);
    console.log(`   POST /api/test/add-balance      - [TEST] Add INR to wallet`);
    console.log(`\n💡 Example: Create a loan`);
    console.log(`   curl -X POST http://localhost:${CONFIG.PORT}/api/borrow-pas \\`);
    console.log(`     -H "Content-Type: application/json" \\`);
    console.log(`     -d '{"userId":"0x...","borrowAmountInr":500,"evmAddress":"0x...","loanType":"standard","ltvRatio":60}'`);
});

module.exports = app;
