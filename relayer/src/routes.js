require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const StellarSdk = require('@stellar/stellar-sdk');
const { ethers } = require('ethers');

const app = express();
app.use(cors());
app.use(express.json());

// ============================================
// CONFIGURATION
// ============================================
const CONFIG = {
    PORT: process.env.PORT || 3001,
    
    // Supabase
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
    
    // Stellar (Owner's account - locks XLM on behalf of users)
    STELLAR_RPC_URL: process.env.STELLAR_RPC_URL || 'https://soroban-testnet.stellar.org',
    STELLAR_HORIZON_URL: 'https://horizon-testnet.stellar.org',
    VAULT_CONTRACT_ID: process.env.VAULT_CONTRACT_ID || 'CDI75PQ4EA2VBTT7W6EZN2RGJIS4CFDMGT7WJ4L42T4ZSTNEKY42NY2B',
    STELLAR_OWNER_SECRET: process.env.STELLAR_RELAYER_SECRET, // Owner's secret key
    XLM_SAC_ADDRESS: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
    
    // Price feed (you can change this to a real API)
    COINGECKO_API: 'https://api.coingecko.com/api/v3',
    
    // Default exchange rates (fallback)
    DEFAULT_PAS_TO_USDC: 3, // 1 PAS = 3 USDC
    DEFAULT_USDC_TO_INR: 83.5, // 1 USDC = 83.5 INR
};

// Initialize Supabase
const supabase = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);

// Initialize Stellar
const { rpc, Keypair, TransactionBuilder, Networks, Contract, nativeToScVal, Address } = StellarSdk;
const stellarServer = new rpc.Server(CONFIG.STELLAR_RPC_URL);
const ownerKeypair = Keypair.fromSecret(CONFIG.STELLAR_OWNER_SECRET);

console.log(`🔑 Owner Stellar Address: ${ownerKeypair.publicKey()}`);

// ============================================
// PRICE FETCHING
// ============================================

// Cache for prices (refresh every 60 seconds)
let priceCache = {
    pasToUsdc: CONFIG.DEFAULT_PAS_TO_USDC,
    usdcToInr: CONFIG.DEFAULT_USDC_TO_INR,
    lastUpdated: 0
};

async function fetchPrices() {
    const now = Date.now();
    
    // Return cached if less than 60 seconds old
    if (now - priceCache.lastUpdated < 60000) {
        return priceCache;
    }
    
    try {
        // Fetch USDC/INR rate
        // Using CoinGecko - you might want to use a different API for INR rates
        const response = await fetch(
            `${CONFIG.COINGECKO_API}/simple/price?ids=usd-coin,polkadot&vs_currencies=inr,usd`
        );
        const data = await response.json();
        
        if (data['usd-coin'] && data['usd-coin'].inr) {
            priceCache.usdcToInr = data['usd-coin'].inr;
        }
        
        // PAS token doesn't have a direct price on mainnet, use Polkadot as reference
        // For testnet (Paseo Asset Hub), use a fixed rate or adjust based on DOT
        // priceCache.pasToUsdc = data['polkadot']?.usd || CONFIG.DEFAULT_PAS_TO_USDC;
        
        priceCache.lastUpdated = now;
        console.log(`💰 Prices updated: 1 USDC = ₹${priceCache.usdcToInr}, 1 PAS = $${priceCache.pasToUsdc}`);
        
    } catch (error) {
        console.error('Error fetching prices:', error.message);
        // Use defaults on error
    }
    
    return priceCache;
}

// Calculate PAS to INR rate
async function getPasToInrRate() {
    const prices = await fetchPrices();
    // PAS → USDC → INR
    const pasToInr = prices.pasToUsdc * prices.usdcToInr;
    return {
        pasToUsdc: prices.pasToUsdc,
        usdcToInr: prices.usdcToInr,
        pasToInr: pasToInr,
        // Also calculate XLM rate (for internal use)
        xlmToInr: pasToInr // 1:1 ratio for PAS:XLM in our system
    };
}

// ============================================
// STELLAR CONTRACT INTERACTION
// ============================================

async function lockXlmOnStellar(amountXlm, userEvmAddress) {
    console.log(`\n🔐 Locking ${amountXlm} XLM for EVM address: ${userEvmAddress}`);
    
    try {
        const ownerAccount = await stellarServer.getAccount(ownerKeypair.publicKey());
        
        // Convert XLM to stroops (1 XLM = 10^7 stroops)
        const amountStroops = Math.floor(amountXlm * 10000000);
        
        // Build the contract call
        const contract = new Contract(CONFIG.VAULT_CONTRACT_ID);
        
        // Create the lock operation
        const lockOp = contract.call(
            "lock",
            nativeToScVal(Address.fromString(ownerKeypair.publicKey()), { type: "address" }),
            nativeToScVal(amountStroops, { type: "i128" }),
            nativeToScVal(userEvmAddress, { type: "string" })
        );
        
        // Build transaction
        const transaction = new TransactionBuilder(ownerAccount, {
            fee: '100000', // 0.01 XLM
            networkPassphrase: Networks.TESTNET
        })
            .addOperation(lockOp)
            .setTimeout(30)
            .build();
        
        // Simulate first
        const simResponse = await stellarServer.simulateTransaction(transaction);
        
        if (StellarSdk.rpc.Api.isSimulationError(simResponse)) {
            throw new Error(`Simulation failed: ${simResponse.error}`);
        }
        
        // Prepare and sign
        const preparedTx = StellarSdk.rpc.assembleTransaction(transaction, simResponse).build();
        preparedTx.sign(ownerKeypair);
        
        // Submit
        const sendResponse = await stellarServer.sendTransaction(preparedTx);
        console.log(`   TX submitted: ${sendResponse.hash}`);
        
        // Wait for confirmation
        let getResponse = await stellarServer.getTransaction(sendResponse.hash);
        while (getResponse.status === 'NOT_FOUND') {
            await new Promise(resolve => setTimeout(resolve, 1000));
            getResponse = await stellarServer.getTransaction(sendResponse.hash);
        }
        
        if (getResponse.status === 'SUCCESS') {
            console.log(`   ✅ Lock successful!`);
            return {
                success: true,
                txHash: sendResponse.hash,
                amountStroops
            };
        } else {
            throw new Error(`Transaction failed: ${getResponse.status}`);
        }
        
    } catch (error) {
        console.error(`   ❌ Lock failed:`, error.message);
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

// Get current exchange rates
app.get('/api/rates', async (req, res) => {
    try {
        const rates = await getPasToInrRate();
        res.json({
            success: true,
            rates: {
                pasToInr: rates.pasToInr,
                pasToUsdc: rates.pasToUsdc,
                usdcToInr: rates.usdcToInr
            },
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
        
        const { data: wallet, error } = await supabase
            .from('wallets')
            .select('balance_inr')
            .eq('user_id', userId)
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
        
        const { data: purchases, error } = await supabase
            .from('crypto_purchases')
            .select('*')
            .eq('user_id', userId)
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
        
        // 2. Check user's wallet balance
        const { data: wallet, error: walletError } = await supabase
            .from('wallets')
            .select('balance_inr')
            .eq('user_id', userId)
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
        
        // 4. Start transaction - Deduct from wallet and create frozen record
        // Using actual cost (not max with slippage)
        const actualInrCost = baseInrCost;
        const newBalance = currentBalance - actualInrCost;
        
        // Create frozen purchase record
        const { data: purchase, error: insertError } = await supabase
            .from('crypto_purchases')
            .insert({
                user_id: userId,
                from_amount: actualInrCost,
                to_token: 'PAS',
                to_amount: pasAmount,
                exchange_rate: rates.pasToInr,
                destination_address: evmAddress,
                xlm_locked: xlmToLock,
                slippage_tolerance: slippageTolerance,
                status: 'frozen', // frozen = INR deducted, waiting for blockchain
                stellar_tx_hash: null,
                evm_tx_hash: null
            })
            .select()
            .single();
        
        if (insertError) {
            throw new Error(`Failed to create purchase record: ${insertError.message}`);
        }
        
        console.log(`   Purchase ID: ${purchase.id}`);
        
        // 5. Deduct INR from wallet
        const { error: updateError } = await supabase
            .from('wallets')
            .update({ 
                balance_inr: newBalance,
                updated_at: new Date().toISOString()
            })
            .eq('user_id', userId);
        
        if (updateError) {
            // Rollback: delete the purchase record
            await supabase.from('crypto_purchases').delete().eq('id', purchase.id);
            throw new Error(`Failed to update wallet: ${updateError.message}`);
        }
        
        console.log(`   Wallet updated: ₹${currentBalance.toFixed(2)} → ₹${newBalance.toFixed(2)}`);
        
        // 6. Lock XLM on Stellar (from owner's account)
        const lockResult = await lockXlmOnStellar(xlmToLock, evmAddress);
        
        if (!lockResult.success) {
            // Rollback: restore wallet balance and mark purchase as failed
            await supabase
                .from('wallets')
                .update({ balance_inr: currentBalance })
                .eq('user_id', userId);
            
            await supabase
                .from('crypto_purchases')
                .update({ status: 'failed', error_message: lockResult.error })
                .eq('id', purchase.id);
            
            throw new Error(`Stellar lock failed: ${lockResult.error}`);
        }
        
        // 7. Update purchase with Stellar TX hash
        await supabase
            .from('crypto_purchases')
            .update({ 
                stellar_tx_hash: lockResult.txHash,
                status: 'locked' // locked = XLM locked, waiting for relayer
            })
            .eq('id', purchase.id);
        
        console.log(`   ✅ XLM locked on Stellar: ${lockResult.txHash}`);
        console.log(`   Waiting for relayer to send PAS...`);
        
        // 8. Return success (PAS will be sent by relayer)
        res.json({
            success: true,
            message: 'Purchase initiated. PAS tokens will be sent to your wallet shortly.',
            data: {
                purchaseId: purchase.id,
                pasAmount,
                inrSpent: actualInrCost,
                evmAddress,
                stellarTxHash: lockResult.txHash,
                status: 'locked',
                newWalletBalance: newBalance
            }
        });
        
    } catch (error) {
        console.error(`   ❌ Error:`, error.message);
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
        // Check if wallet exists
        const { data: existing } = await supabase
            .from('wallets')
            .select('balance_inr')
            .eq('user_id', userId)
            .single();
        
        if (existing) {
            // Update existing wallet
            const newBalance = parseFloat(existing.balance_inr) + amount;
            await supabase
                .from('wallets')
                .update({ balance_inr: newBalance })
                .eq('user_id', userId);
            
            res.json({
                success: true,
                message: `Added ₹${amount} to wallet`,
                newBalance
            });
        } else {
            // Create new wallet
            await supabase
                .from('wallets')
                .insert({ user_id: userId, balance_inr: amount });
            
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
    console.log(`   GET  /health                  - Health check`);
    console.log(`   GET  /api/rates               - Get PAS/INR exchange rate`);
    console.log(`   GET  /api/wallet/:userId      - Get user's INR balance`);
    console.log(`   GET  /api/purchases/:userId   - Get user's purchase history`);
    console.log(`   POST /api/buy-pas             - Buy PAS tokens with INR`);
    console.log(`   POST /api/purchase-completed  - Webhook for relayer`);
    console.log(`   POST /api/test/add-balance    - [TEST] Add INR to wallet`);
    console.log(`\n💡 Example buy request:`);
    console.log(`   curl -X POST http://localhost:${CONFIG.PORT}/api/buy-pas \\`);
    console.log(`     -H "Content-Type: application/json" \\`);
    console.log(`     -d '{"userId":"test-user-1","pasAmount":0.1,"evmAddress":"0x...","slippageTolerance":1}'`);
});

module.exports = app;
