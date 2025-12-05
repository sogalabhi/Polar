require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const StellarSdk = require('@stellar/stellar-sdk');
const { ethers } = require('ethers');
const Razorpay = require('razorpay');

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
    
    // Razorpay Configuration
    RAZORPAY_KEY_ID: process.env.RAZORPAY_KEY_ID,
    RAZORPAY_KEY_SECRET: process.env.RAZORPAY_KEY_SECRET,
};

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
    
    if (!evmTxHash) {
        return res.status(400).json({
            success: false,
            error: 'Missing evmTxHash'
        });
    }
    
    try {
        let query = supabase.from('crypto_purchases');
        
        // Find the purchase - by ID or by EVM address (most recent locked one)
        if (purchaseId) {
            query = query.update({
                evm_tx_hash: evmTxHash,
                status: 'completed',
                completed_at: new Date().toISOString()
            }).eq('id', purchaseId);
        } else if (evmAddress) {
            // Find the most recent locked purchase for this EVM address
            const { data: purchase } = await supabase
                .from('crypto_purchases')
                .select('id')
                .eq('destination_address', evmAddress)
                .eq('status', 'locked')
                .order('created_at', { ascending: false })
                .limit(1)
                .single();
            
            if (purchase) {
                query = query.update({
                    evm_tx_hash: evmTxHash,
                    status: 'completed',
                    completed_at: new Date().toISOString()
                }).eq('id', purchase.id);
                
                console.log(`✅ Purchase ${purchase.id} completed for ${evmAddress}. EVM TX: ${evmTxHash}`);
            } else {
                console.log(`⚠️  No locked purchase found for EVM address: ${evmAddress}`);
                return res.json({ success: true, message: 'No matching purchase found' });
            }
        } else {
            return res.status(400).json({
                success: false,
                error: 'Missing purchaseId or evmAddress'
            });
        }
        
        const { error } = await query;
        if (error) throw error;
        
        res.json({ success: true });
        
    } catch (error) {
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
    console.log(`   POST /api/test/add-balance      - [TEST] Add INR to wallet`);
    console.log(`\n💡 Example requests:`);
    console.log(`   # Get PAS balance`);
    console.log(`   curl http://localhost:${CONFIG.PORT}/api/pas-balance/0xYourAddress`);
    console.log(`\n   # Buy PAS`);
    console.log(`   curl -X POST http://localhost:${CONFIG.PORT}/api/buy-pas \\`);
    console.log(`     -H "Content-Type: application/json" \\`);
    console.log(`     -d '{"userId":"test-user-1","pasAmount":0.1,"evmAddress":"0x...","slippageTolerance":1}'`);
});

module.exports = app;
