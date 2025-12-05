/**
 * ============================================
 * POLAR BRIDGE - LIQUIDATION BOT
 * ============================================
 * 
 * Automated system for:
 * 1. Monitoring loan health factors
 * 2. Auto-liquidating unhealthy positions
 * 3. Calculating daily interest accrual
 * 4. Calculating late fees
 * 5. Force-liquidating overdue loans
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { createClient } = require('@supabase/supabase-js');
const StellarSdk = require('@stellar/stellar-sdk');

const {
    LENDING_CONFIG,
    calculateHealthFactor,
    calculateAccruedInterest,
    calculateLateFee,
    calculateLiquidationAmounts,
    daysBetween,
} = require('./lending-config');

// ============================================
// CONFIGURATION
// ============================================
const CONFIG = {
    VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL,
    VITE_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY,
    
    STELLAR_RPC_URL: process.env.STELLAR_RPC_URL || 'https://soroban-testnet.stellar.org',
    VAULT_CONTRACT_ID: process.env.VAULT_CONTRACT_ID || 'CDI75PQ4EA2VBTT7W6EZN2RGJIS4CFDMGT7WJ4L42T4ZSTNEKY42NY2B',
    STELLAR_OWNER_SECRET: process.env.STELLAR_RELAYER_SECRET,
    
    COINGECKO_API: 'https://api.coingecko.com/api/v3',
    
    // How often to check (ms)
    HEALTH_CHECK_INTERVAL: 5 * 60 * 1000,      // 5 minutes
    INTEREST_ACCRUAL_INTERVAL: 60 * 60 * 1000, // 1 hour (daily at midnight in prod)
};

// Initialize Supabase
const supabase = createClient(CONFIG.VITE_SUPABASE_URL, CONFIG.VITE_SUPABASE_ANON_KEY);

// Initialize Stellar
const { rpc, Keypair, TransactionBuilder, Networks, Contract, nativeToScVal, Address } = StellarSdk;
const stellarServer = new rpc.Server(CONFIG.STELLAR_RPC_URL);
const ownerKeypair = Keypair.fromSecret(CONFIG.STELLAR_OWNER_SECRET);

// ============================================
// PRICE FETCHING
// ============================================

let priceCache = {
    xlm: 0,
    pas: 0,
    lastUpdated: 0
};

async function fetchPrices() {
    const now = Date.now();
    
    // Cache for 60 seconds
    if (now - priceCache.lastUpdated < 60000 && priceCache.xlm > 0) {
        return priceCache;
    }
    
    try {
        const response = await fetch(
            `${CONFIG.COINGECKO_API}/simple/price?ids=stellar,polkadot&vs_currencies=inr`
        );
        const data = await response.json();
        
        priceCache.xlm = data['stellar']?.inr || 18.92;
        priceCache.pas = data['polkadot']?.inr || 500; // PAS uses DOT price
        priceCache.lastUpdated = now;
        
        console.log(`💰 Prices: XLM=₹${priceCache.xlm.toFixed(2)}, PAS=₹${priceCache.pas.toFixed(2)}`);
        
    } catch (error) {
        console.error('Error fetching prices:', error.message);
    }
    
    return priceCache;
}

// ============================================
// STELLAR UNLOCK FUNCTION
// ============================================

async function unlockXlmFromVault(amountXlm, userAddress) {
    console.log(`\n🔓 Unlocking ${amountXlm} XLM from vault for ${userAddress}`);
    
    try {
        const ownerAccount = await stellarServer.getAccount(ownerKeypair.publicKey());
        const amountStroops = Math.floor(amountXlm * 10000000);
        
        const contract = new Contract(CONFIG.VAULT_CONTRACT_ID);
        
        // Call unlock function
        const unlockOp = contract.call(
            "unlock",
            nativeToScVal(Address.fromString(ownerKeypair.publicKey()), { type: "address" }),
            nativeToScVal(amountStroops, { type: "i128" }),
            nativeToScVal(userAddress, { type: "string" })
        );
        
        const transaction = new TransactionBuilder(ownerAccount, {
            fee: '100000',
            networkPassphrase: Networks.TESTNET
        })
            .addOperation(unlockOp)
            .setTimeout(30)
            .build();
        
        const simResponse = await stellarServer.simulateTransaction(transaction);
        
        if (StellarSdk.rpc.Api.isSimulationError(simResponse)) {
            throw new Error(`Simulation failed: ${simResponse.error}`);
        }
        
        const preparedTx = StellarSdk.rpc.assembleTransaction(transaction, simResponse).build();
        preparedTx.sign(ownerKeypair);
        
        const sendResponse = await stellarServer.sendTransaction(preparedTx);
        
        // Wait for confirmation
        let getResponse = await stellarServer.getTransaction(sendResponse.hash);
        let attempts = 0;
        while (getResponse.status === 'NOT_FOUND' && attempts < 30) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            getResponse = await stellarServer.getTransaction(sendResponse.hash);
            attempts++;
        }
        
        if (getResponse.status === 'SUCCESS') {
            console.log(`✅ Unlock successful: ${sendResponse.hash}`);
            return { success: true, txHash: sendResponse.hash };
        } else {
            throw new Error(`Transaction failed: ${getResponse.status}`);
        }
        
    } catch (error) {
        console.error(`❌ Unlock failed: ${error.message}`);
        return { success: false, error: error.message };
    }
}

// ============================================
// HEALTH CHECK & UPDATE
// ============================================

async function updateLoanHealthFactors() {
    console.log('\n📊 ═══════════════════════════════════════════════════════════════');
    console.log('   🔍 UPDATING LOAN HEALTH FACTORS');
    console.log('═══════════════════════════════════════════════════════════════════');
    
    try {
        const prices = await fetchPrices();
        
        // Get all active loans
        const { data: loans, error } = await supabase
            .from('crypto_purchases')
            .select('*')
            .in('status', ['active', 'locked', 'overdue'])
            .eq('is_liquidated', false);
        
        if (error) throw error;
        
        console.log(`   📋 Found ${loans?.length || 0} active loans`);
        
        for (const loan of loans || []) {
            const currentCollateralValue = loan.collateral_xlm * prices.xlm;
            const daysElapsed = daysBetween(loan.loan_start_date || loan.created_at, new Date());
            const daysUntilDeadline = daysBetween(new Date(), loan.repayment_deadline);
            
            // Calculate interest
            const interest = calculateAccruedInterest(
                loan.borrowed_value_inr || loan.from_amount,
                loan.interest_rate_apy || 0.08,
                daysElapsed
            );
            
            // Calculate late fee
            const daysOverdue = Math.max(0, -daysUntilDeadline);
            const lateFee = calculateLateFee(
                (loan.borrowed_value_inr || loan.from_amount) + interest.interestAccrued,
                daysOverdue
            );
            
            // Total debt
            const totalDebt = (loan.borrowed_value_inr || loan.from_amount) + interest.interestAccrued + lateFee;
            
            // Health factor
            const healthFactor = calculateHealthFactor(currentCollateralValue, totalDebt);
            
            // Determine status
            let newStatus = loan.status;
            if (daysUntilDeadline < 0 && loan.status !== 'overdue') {
                newStatus = 'overdue';
            }
            
            // Update loan
            const { error: updateError } = await supabase
                .from('crypto_purchases')
                .update({
                    health_factor: healthFactor,
                    interest_accrued: interest.interestAccrued,
                    late_fee: lateFee,
                    last_interest_update: new Date().toISOString(),
                    status: newStatus
                })
                .eq('id', loan.id);
            
            if (updateError) {
                console.error(`   ⚠️  Failed to update loan ${loan.id}: ${updateError.message}`);
            } else {
                const statusIcon = healthFactor > 1.5 ? '🟢' : healthFactor > 1.2 ? '🟡' : healthFactor > 1.0 ? '🟠' : '🔴';
                console.log(`   ${statusIcon} Loan ${loan.id.slice(0, 8)}... HF=${healthFactor.toFixed(2)} Debt=₹${totalDebt.toFixed(2)}`);
            }
        }
        
        console.log('   ✅ Health factors updated');
        console.log('═══════════════════════════════════════════════════════════════════\n');
        
    } catch (error) {
        console.error(`   ❌ Error: ${error.message}`);
    }
}

// ============================================
// LIQUIDATION CHECK
// ============================================

async function checkAndLiquidate() {
    console.log('\n⚠️  ═══════════════════════════════════════════════════════════════');
    console.log('   🔍 CHECKING FOR LIQUIDATABLE LOANS');
    console.log('═══════════════════════════════════════════════════════════════════');
    
    try {
        const prices = await fetchPrices();
        
        // Find loans with health factor < 1.0 OR overdue by more than max days
        const { data: loans, error } = await supabase
            .from('crypto_purchases')
            .select('*')
            .in('status', ['active', 'locked', 'overdue'])
            .eq('is_liquidated', false)
            .or(`health_factor.lt.1.0,status.eq.overdue`);
        
        if (error) throw error;
        
        console.log(`   📋 Found ${loans?.length || 0} potentially liquidatable loans`);
        
        for (const loan of loans || []) {
            // Check if this loan should be liquidated
            const daysUntilDeadline = daysBetween(new Date(), loan.repayment_deadline);
            const daysOverdue = Math.max(0, -daysUntilDeadline);
            const shouldLiquidateHealth = loan.health_factor < 1.0;
            const shouldLiquidateDeadline = daysOverdue > LENDING_CONFIG.DEADLINES.MAX_LATE_DAYS;
            
            if (!shouldLiquidateHealth && !shouldLiquidateDeadline) {
                console.log(`   ⏳ Loan ${loan.id.slice(0, 8)}... HF=${loan.health_factor?.toFixed(2)} Overdue=${daysOverdue}d - Not yet liquidatable`);
                continue;
            }
            
            const reason = shouldLiquidateHealth ? 'health_factor' : 'deadline';
            console.log(`\n   🔴 LIQUIDATING Loan ${loan.id} (reason: ${reason})`);
            
            await liquidateLoan(loan, prices, reason);
        }
        
        console.log('═══════════════════════════════════════════════════════════════════\n');
        
    } catch (error) {
        console.error(`   ❌ Error: ${error.message}`);
    }
}

// ============================================
// LIQUIDATE LOAN
// ============================================

async function liquidateLoan(loan, prices, reason) {
    console.log(`   📝 Processing liquidation for loan ${loan.id}`);
    
    try {
        // Calculate liquidation amounts
        const liquidation = calculateLiquidationAmounts(loan, prices.xlm);
        
        console.log(`   📊 Liquidation breakdown:`);
        console.log(`      Total Debt: ₹${liquidation.totalDebt.toFixed(2)}`);
        console.log(`      Penalty (10%): ₹${liquidation.penalty.toFixed(2)}`);
        console.log(`      Total to recover: ₹${liquidation.totalToRecover.toFixed(2)}`);
        console.log(`      Collateral value: ₹${liquidation.collateralValueInr.toFixed(2)}`);
        console.log(`      XLM seized: ${liquidation.xlmSeized.toFixed(4)}`);
        console.log(`      XLM returned: ${liquidation.xlmReturned.toFixed(4)}`);
        
        // 1. Unlock collateral from Stellar vault
        console.log(`\n   🔓 Step 1: Unlocking collateral from vault...`);
        const unlockResult = await unlockXlmFromVault(loan.collateral_xlm, loan.destination_address);
        
        if (!unlockResult.success) {
            console.error(`   ❌ Failed to unlock collateral: ${unlockResult.error}`);
            // Continue anyway to update status - manual intervention may be needed
        }
        
        // 2. Record liquidation event
        console.log(`   📝 Step 2: Recording liquidation event...`);
        
        const { error: eventError } = await supabase
            .from('liquidation_events')
            .insert({
                loan_id: loan.id,
                user_id: loan.user_id,
                collateral_seized_xlm: liquidation.xlmSeized,
                collateral_value_inr: liquidation.collateralValueInr,
                debt_repaid_inr: liquidation.totalDebt,
                penalty_amount_inr: liquidation.penalty,
                returned_to_user_xlm: liquidation.xlmReturned,
                returned_to_user_inr: liquidation.inrReturned,
                xlm_price_at_liquidation: prices.xlm,
                pas_price_at_liquidation: prices.pas,
                health_factor_at_liquidation: loan.health_factor,
                liquidation_reason: reason,
                stellar_unlock_tx_hash: unlockResult.txHash || null
            });
        
        if (eventError) {
            console.error(`   ⚠️  Failed to record liquidation event: ${eventError.message}`);
        }
        
        // 3. Update loan status
        console.log(`   📝 Step 3: Updating loan status...`);
        
        const { error: updateError } = await supabase
            .from('crypto_purchases')
            .update({
                status: 'liquidated',
                is_liquidated: true,
                liquidated_at: new Date().toISOString(),
                liquidation_tx_hash: unlockResult.txHash || null
            })
            .eq('id', loan.id);
        
        if (updateError) {
            console.error(`   ⚠️  Failed to update loan status: ${updateError.message}`);
        }
        
        // 4. Return remaining collateral to user's wallet (if any)
        if (liquidation.xlmReturned > 0) {
            console.log(`   💰 Step 4: Crediting remaining collateral to wallet...`);
            
            const { data: wallet } = await supabase
                .from('wallets')
                .select('balance_inr')
                .eq('wallet_address', loan.user_id)
                .single();
            
            if (wallet) {
                const newBalance = parseFloat(wallet.balance_inr) + liquidation.inrReturned;
                
                await supabase
                    .from('wallets')
                    .update({ balance_inr: newBalance })
                    .eq('wallet_address', loan.user_id);
                
                console.log(`   ✅ Credited ₹${liquidation.inrReturned.toFixed(2)} to wallet`);
            }
        }
        
        console.log(`\n   ═══════════════════════════════════════════════════════════`);
        console.log(`   ✅ LOAN ${loan.id.slice(0, 8)}... LIQUIDATED`);
        console.log(`   ═══════════════════════════════════════════════════════════`);
        console.log(`   📋 Reason: ${reason}`);
        console.log(`   💔 Debt: ₹${liquidation.totalDebt.toFixed(2)}`);
        console.log(`   ⚠️  Penalty: ₹${liquidation.penalty.toFixed(2)}`);
        console.log(`   💰 Returned to user: ₹${liquidation.inrReturned.toFixed(2)}`);
        
    } catch (error) {
        console.error(`   ❌ Liquidation failed: ${error.message}`);
    }
}

// ============================================
// INTEREST ACCRUAL JOB
// ============================================

async function accrueInterestForAllLoans() {
    console.log('\n📈 ═══════════════════════════════════════════════════════════════');
    console.log('   💰 ACCRUING DAILY INTEREST');
    console.log('═══════════════════════════════════════════════════════════════════');
    
    try {
        const prices = await fetchPrices();
        
        // Get all active loans
        const { data: loans, error } = await supabase
            .from('crypto_purchases')
            .select('*')
            .in('status', ['active', 'locked', 'overdue'])
            .eq('is_liquidated', false);
        
        if (error) throw error;
        
        let totalInterestAccrued = 0;
        
        for (const loan of loans || []) {
            const daysElapsed = daysBetween(loan.loan_start_date || loan.created_at, new Date());
            
            const interest = calculateAccruedInterest(
                loan.borrowed_value_inr || loan.from_amount,
                loan.interest_rate_apy || 0.08,
                daysElapsed
            );
            
            // Log daily interest
            const { error: historyError } = await supabase
                .from('interest_history')
                .insert({
                    loan_id: loan.id,
                    interest_amount: interest.dailyInterest,
                    principal_at_calc: loan.borrowed_value_inr || loan.from_amount,
                    xlm_price_at_calc: prices.xlm,
                    pas_price_at_calc: prices.pas,
                    health_factor_at_calc: loan.health_factor
                });
            
            if (historyError) {
                console.error(`   ⚠️  Failed to log interest for ${loan.id}: ${historyError.message}`);
            }
            
            totalInterestAccrued += interest.dailyInterest;
        }
        
        console.log(`   ✅ Accrued ₹${totalInterestAccrued.toFixed(2)} interest across ${loans?.length || 0} loans`);
        console.log('═══════════════════════════════════════════════════════════════════\n');
        
    } catch (error) {
        console.error(`   ❌ Error: ${error.message}`);
    }
}

// ============================================
// MAIN LOOP
// ============================================

async function runBot() {
    console.log('\n🤖 ═══════════════════════════════════════════════════════════════');
    console.log('   🏦 POLAR BRIDGE LIQUIDATION BOT STARTED');
    console.log('═══════════════════════════════════════════════════════════════════');
    console.log(`   📋 Health check interval: ${CONFIG.HEALTH_CHECK_INTERVAL / 1000}s`);
    console.log(`   📋 Interest accrual interval: ${CONFIG.INTEREST_ACCRUAL_INTERVAL / 1000}s`);
    console.log(`   📋 Liquidation threshold: HF < 1.0`);
    console.log(`   📋 Max late days: ${LENDING_CONFIG.DEADLINES.MAX_LATE_DAYS}`);
    console.log('═══════════════════════════════════════════════════════════════════\n');
    
    // Initial run
    await updateLoanHealthFactors();
    await checkAndLiquidate();
    await accrueInterestForAllLoans();
    
    // Schedule periodic runs
    setInterval(async () => {
        await updateLoanHealthFactors();
        await checkAndLiquidate();
    }, CONFIG.HEALTH_CHECK_INTERVAL);
    
    setInterval(async () => {
        await accrueInterestForAllLoans();
    }, CONFIG.INTEREST_ACCRUAL_INTERVAL);
    
    console.log('🤖 Bot is running. Press Ctrl+C to stop.\n');
}

// Run if called directly
if (require.main === module) {
    runBot().catch(console.error);
}

module.exports = {
    updateLoanHealthFactors,
    checkAndLiquidate,
    accrueInterestForAllLoans,
    liquidateLoan,
    runBot
};
