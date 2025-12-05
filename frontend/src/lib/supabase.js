import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

console.log('🔧 Supabase Config:');
console.log('   URL:', supabaseUrl ? `${supabaseUrl.substring(0, 30)}...` : '❌ MISSING!');
console.log('   Key:', supabaseAnonKey ? `${supabaseAnonKey.substring(0, 20)}...` : '❌ MISSING!');

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('❌ Missing Supabase environment variables!');
  console.error('   Make sure you have VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your .env file');
}

export const supabase = createClient(supabaseUrl || '', supabaseAnonKey || '');

// Test Supabase connection on load
(async () => {
  try {
    const { data, error } = await supabase.from('wallets').select('count').limit(1);
    if (error) {
      console.error('❌ Supabase connection test FAILED:', error.message);
      console.error('   Full error:', error);
    } else {
      console.log('✅ Supabase connection test PASSED');
    }
  } catch (e) {
    console.error('❌ Supabase connection test EXCEPTION:', e.message);
  }
})();

// ============================================
// PHASE 1: User Onboarding
// ============================================

/**
 * Check if user exists, if not create a new wallet record
 * Called when user connects their wallet
 * @param {string} walletAddress - User's EVM wallet address
 * @returns {Promise<{success: boolean, wallet: object, isNew: boolean}>}
 */
export async function checkOrCreateUser(walletAddress) {
  console.log('🔍 checkOrCreateUser called with:', walletAddress);
  
  if (!walletAddress) {
    console.error('❌ checkOrCreateUser: No wallet address provided');
    return { success: false, error: 'Wallet address is required' };
  }

  const normalizedAddress = walletAddress.toLowerCase();
  console.log('   Normalized address:', normalizedAddress);

  try {
    // Check if user already exists
    console.log('   Querying Supabase for existing user...');
    const { data: existingWallet, error: fetchError } = await supabase
      .from('wallets')
      .select('*')
      .eq('wallet_address', normalizedAddress)
      .single();

    console.log('   Query result - data:', existingWallet, 'error:', fetchError);

    if (fetchError && fetchError.code !== 'PGRST116') {
      // PGRST116 = no rows returned (user doesn't exist)
      console.error('❌ Supabase fetch error:', fetchError);
      throw fetchError;
    }

    if (existingWallet) {
      // User exists, return their wallet
      console.log('✅ User found in Supabase:', existingWallet);
      return {
        success: true,
        wallet: existingWallet,
        isNew: false,
      };
    }

    // User doesn't exist, create new wallet record
    console.log('   User not found, creating new wallet...');
    const { data: newWallet, error: insertError } = await supabase
      .from('wallets')
      .insert({
        wallet_address: normalizedAddress,
        balance_inr: 0,
      })
      .select()
      .single();

    console.log('   Insert result - data:', newWallet, 'error:', insertError);

    if (insertError) {
      console.error('❌ Supabase insert error:', insertError);
      throw insertError;
    }

    console.log('✅ New user created in Supabase:', newWallet);
    return {
      success: true,
      wallet: newWallet,
      isNew: true,
    };
  } catch (error) {
    console.error('❌ Error in checkOrCreateUser:', error);
    console.error('   Error message:', error.message);
    console.error('   Error details:', JSON.stringify(error, null, 2));
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Get wallet balance for a user
 * @param {string} walletAddress - User's EVM wallet address
 * @returns {Promise<{success: boolean, balance: number}>}
 */
export async function getWalletBalance(walletAddress) {
  if (!walletAddress) {
    return { success: false, error: 'Wallet address is required' };
  }

  const normalizedAddress = walletAddress.toLowerCase();

  try {
    const { data, error } = await supabase
      .from('wallets')
      .select('balance_inr')
      .eq('wallet_address', normalizedAddress)
      .single();

    if (error) {
      throw error;
    }

    return {
      success: true,
      balance: parseFloat(data.balance_inr) || 0,
    };
  } catch (error) {
    console.error('❌ Error in getWalletBalance:', error.message);
    return {
      success: false,
      error: error.message,
      balance: 0,
    };
  }
}

// ============================================
// PHASE 2: Add Funds (Razorpay)
// ============================================

/**
 * Add funds to user's wallet after Razorpay payment success
 * @param {string} walletAddress - User's EVM wallet address
 * @param {number} amount - Amount in INR to add
 * @returns {Promise<{success: boolean, newBalance: number}>}
 */
export async function addFunds(walletAddress, amount) {
  console.log('💰 addFunds called:', { walletAddress, amount });
  
  if (!walletAddress || !amount || amount <= 0) {
    console.error('❌ addFunds: Invalid parameters');
    return { success: false, error: 'Invalid wallet address or amount' };
  }

  const normalizedAddress = walletAddress.toLowerCase();

  try {
    // Get current balance
    console.log('   Fetching current balance...');
    const { data: wallet, error: fetchError } = await supabase
      .from('wallets')
      .select('balance_inr')
      .eq('wallet_address', normalizedAddress)
      .single();

    console.log('   Current wallet:', wallet, 'error:', fetchError);

    if (fetchError) {
      console.error('❌ addFunds fetch error:', fetchError);
      throw fetchError;
    }

    const currentBalance = parseFloat(wallet.balance_inr) || 0;
    const newBalance = currentBalance + amount;
    console.log(`   Updating balance: ₹${currentBalance} + ₹${amount} = ₹${newBalance}`);

    // Update balance
    const { data, error: updateError } = await supabase
      .from('wallets')
      .update({
        balance_inr: newBalance,
        updated_at: new Date().toISOString(),
      })
      .eq('wallet_address', normalizedAddress)
      .select()
      .single();

    console.log('   Update result:', data, 'error:', updateError);

    if (updateError) {
      console.error('❌ addFunds update error:', updateError);
      throw updateError;
    }

    console.log(`✅ Added ₹${amount} to wallet. New balance: ₹${newBalance}`);
    return {
      success: true,
      newBalance: newBalance,
      wallet: data,
    };
  } catch (error) {
    console.error('❌ Error in addFunds:', error);
    console.error('   Full error:', JSON.stringify(error, null, 2));
    return {
      success: false,
      error: error.message,
    };
  }
}

// ============================================
// PHASE 3: Staking (Buy PAS)
// ============================================

/**
 * Buy PAS tokens - calls backend API which handles blockchain first, then database
 * @param {string} walletAddress - User's EVM wallet address
 * @param {number} amountInr - Amount in INR to stake
 * @param {number} amountPas - PAS tokens to receive
 * @param {number} exchangeRate - Exchange rate at time of stake
 * @returns {Promise<{success: boolean, stellarTxHash: string, error: string}>}
 */
export async function createStake(walletAddress, amountInr, amountPas, exchangeRate) {
  console.log('\n🚀 ═══════════════════════════════════════════════════════════════');
  console.log('   💎 WEB3 ACTION: Buy PAS Tokens (Blockchain-First)');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log(`   📋 Wallet: ${walletAddress}`);
  console.log(`   💳 Amount INR: ₹${amountInr}`);
  console.log(`   💰 Expected PAS: ${amountPas}`);
  console.log(`   📈 Exchange Rate: ₹${exchangeRate}/PAS`);
  
  if (!walletAddress || !amountInr || amountInr <= 0) {
    console.error('   ❌ Invalid parameters');
    console.error('═══════════════════════════════════════════════════════════════════\n');
    return { success: false, error: 'Invalid parameters' };
  }

  const normalizedAddress = walletAddress.toLowerCase();

  try {
    // Call the buy-pas API - it handles blockchain TX first, then database
    console.log('\n   🔗 Calling buy-pas API...');
    console.log('   This will:');
    console.log('   1. Execute blockchain transaction (lock XLM on Stellar)');
    console.log('   2. Only if successful, update database');
    
    const response = await fetch('http://localhost:3000/api/buy-pas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: normalizedAddress,
        pasAmount: amountPas,
        evmAddress: walletAddress,
        slippageTolerance: 1
      })
    });
    
    const apiResult = await response.json();
    
    if (apiResult.success) {
      console.log('\n   ═══════════════════════════════════════════════════════════════');
      console.log('   ✅ PURCHASE SUCCESSFUL!');
      console.log('   ═══════════════════════════════════════════════════════════════');
      console.log(`   🔗 Stellar TX Hash: ${apiResult.data.stellarTxHash}`);
      console.log(`   🔗 Explorer: ${apiResult.data.stellarExplorer || `https://stellar.expert/explorer/testnet/tx/${apiResult.data.stellarTxHash}`}`);
      console.log(`   📊 Status: ${apiResult.data.status}`);
      console.log(`   💰 PAS Amount: ${apiResult.data.pasAmount}`);
      console.log(`   💳 INR Spent: ₹${apiResult.data.inrSpent}`);
      console.log(`   💵 New Balance: ₹${apiResult.data.newWalletBalance}`);
      console.log('   ⏳ Waiting for relayer to send PAS to your wallet...');
      console.log('═══════════════════════════════════════════════════════════════════\n');
      
      return {
        success: true,
        stellarTxHash: apiResult.data.stellarTxHash,
        stellarExplorer: apiResult.data.stellarExplorer,
        purchaseId: apiResult.data.purchaseId,
        newBalance: apiResult.data.newWalletBalance,
        pasAmount: apiResult.data.pasAmount,
        inrSpent: apiResult.data.inrSpent,
      };
    } else {
      // API returned an error - could be blockchain failure or other issue
      console.error('\n   ═══════════════════════════════════════════════════════════════');
      console.error('   ❌ PURCHASE FAILED');
      console.error('   ═══════════════════════════════════════════════════════════════');
      console.error(`   Error: ${apiResult.error}`);
      if (apiResult.details) {
        console.error(`   Stage: ${apiResult.details.stage}`);
        console.error(`   Details: ${apiResult.details.message}`);
      }
      console.error('═══════════════════════════════════════════════════════════════════\n');
      
      return {
        success: false,
        error: apiResult.error,
        details: apiResult.details,
      };
    }
  } catch (error) {
    console.error('\n   ═══════════════════════════════════════════════════════════════');
    console.error('   ❌ NETWORK/API ERROR');
    console.error('   ═══════════════════════════════════════════════════════════════');
    console.error(`   Error: ${error.message}`);
    console.error('   Make sure the backend server is running on http://localhost:3000');
    console.error('═══════════════════════════════════════════════════════════════════\n');
    return {
      success: false,
      error: `API connection failed: ${error.message}`,
    };
  }
}

// ============================================
// PHASE 4: Payback PAS (Get INR back)
// ============================================

/**
 * Initiate payback - get transaction details for sending PAS to pool
 * @param {string} walletAddress - User's EVM wallet address
 * @param {number} pasAmount - Amount of PAS to pay back
 * @param {string} stakeId - The ID of the stake being paid back
 * @returns {Promise<{success: boolean, poolAddress: string, amountWei: string, inrToReceive: number}>}
 */
export async function initiatePayback(walletAddress, pasAmount, stakeId) {
  console.log('\n💰 ═══════════════════════════════════════════════════════════════');
  console.log('   🔄 PAYBACK: Send PAS to get INR back');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log(`   📋 Wallet: ${walletAddress}`);
  console.log(`   💎 PAS Amount: ${pasAmount}`);
  console.log(`   📋 Stake ID: ${stakeId}`);
  
  if (!walletAddress || !pasAmount || pasAmount <= 0) {
    console.error('   ❌ Invalid parameters');
    console.error('═══════════════════════════════════════════════════════════════════\n');
    return { success: false, error: 'Invalid parameters' };
  }

  try {
    // Call the payback-pas API to get transaction details
    console.log('\n   🔗 Getting payback details from API...');
    
    const response = await fetch('http://localhost:3000/api/payback-pas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: walletAddress.toLowerCase(),
        pasAmount: pasAmount,
        evmAddress: walletAddress,
        stakeId: stakeId
      })
    });
    
    const apiResult = await response.json();
    
    if (apiResult.success) {
      console.log('\n   ═══════════════════════════════════════════════════════════════');
      console.log('   ✅ PAYBACK DETAILS RECEIVED');
      console.log('   ═══════════════════════════════════════════════════════════════');
      console.log(`   📋 Pool Address: ${apiResult.data.poolAddress}`);
      console.log(`   💎 PAS Amount: ${apiResult.data.amountPas}`);
      console.log(`   💰 INR to receive: ₹${apiResult.data.inrToReceive}`);
      console.log(`   📈 Exchange Rate: ₹${apiResult.data.exchangeRate}/PAS`);
      console.log('═══════════════════════════════════════════════════════════════════\n');
      
      return {
        success: true,
        poolAddress: apiResult.data.poolAddress,
        amountPas: apiResult.data.amountPas,
        amountWei: apiResult.data.amountWei,
        inrToReceive: parseFloat(apiResult.data.inrToReceive),
        exchangeRate: apiResult.data.exchangeRate,
        paybackId: apiResult.data.paybackId,
      };
    } else {
      console.error('\n   ❌ PAYBACK INITIATION FAILED:', apiResult.error);
      console.error('═══════════════════════════════════════════════════════════════════\n');
      return {
        success: false,
        error: apiResult.error,
      };
    }
  } catch (error) {
    console.error('\n   ═══════════════════════════════════════════════════════════════');
    console.error('   ❌ NETWORK/API ERROR');
    console.error('   ═══════════════════════════════════════════════════════════════');
    console.error(`   Error: ${error.message}`);
    console.error('═══════════════════════════════════════════════════════════════════\n');
    return {
      success: false,
      error: `API connection failed: ${error.message}`,
    };
  }
}

/**
 * Execute payback - send PAS to pool via MetaMask
 * @param {string} poolAddress - Pool contract address
 * @param {string} amountWei - Amount in wei
 * @returns {Promise<{success: boolean, txHash: string}>}
 */
export async function executePayback(poolAddress, amountWei) {
  console.log('\n📤 ═══════════════════════════════════════════════════════════════');
  console.log('   🔄 EXECUTING PAYBACK: Sending PAS to Pool');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log(`   📋 Pool Address: ${poolAddress}`);
  console.log(`   💎 Amount (Wei): ${amountWei}`);
  
  if (!window.ethereum) {
    console.error('   ❌ MetaMask not installed');
    return { success: false, error: 'MetaMask not installed' };
  }

  try {
    // Get current account
    const accounts = await window.ethereum.request({ method: 'eth_accounts' });
    if (accounts.length === 0) {
      return { success: false, error: 'Please connect your wallet first' };
    }
    
    const fromAddress = accounts[0];
    console.log(`   📋 From: ${fromAddress}`);
    
    // Send transaction to pool
    console.log('\n   📤 Sending transaction via MetaMask...');
    
    const txHash = await window.ethereum.request({
      method: 'eth_sendTransaction',
      params: [{
        from: fromAddress,
        to: poolAddress,
        value: '0x' + BigInt(amountWei).toString(16), // Convert to hex
        // No data needed - just sending native PAS to the pool
      }],
    });
    
    console.log('\n   ═══════════════════════════════════════════════════════════════');
    console.log('   ✅ TRANSACTION SUBMITTED!');
    console.log('   ═══════════════════════════════════════════════════════════════');
    console.log(`   🔗 TX Hash: ${txHash}`);
    console.log(`   🔗 Explorer: https://blockscout-passet-hub.parity-testnet.parity.io/tx/${txHash}`);
    console.log('   ⏳ Waiting for confirmation...');
    console.log('   💡 Your INR will be credited once the relayer detects this transaction');
    console.log('═══════════════════════════════════════════════════════════════════\n');
    
    return {
      success: true,
      txHash,
    };
    
  } catch (error) {
    console.error('\n   ═══════════════════════════════════════════════════════════════');
    console.error('   ❌ TRANSACTION FAILED');
    console.error('   ═══════════════════════════════════════════════════════════════');
    console.error(`   Error: ${error.message}`);
    if (error.code === 4001) {
      console.error('   User rejected the transaction');
    }
    console.error('═══════════════════════════════════════════════════════════════════\n');
    return {
      success: false,
      error: error.code === 4001 ? 'Transaction rejected by user' : error.message,
    };
  }
}

/**
 * Update stake status and tx hashes
 * @param {string} stakeId - Stake ID
 * @param {string} status - New status (pending, completed, paid_back)
 * @param {object} txHashes - Optional tx hashes { stellar_tx_hash, evm_tx_hash }
 */
export async function updateStakeStatus(stakeId, status, txHashes = {}) {
  try {
    const updateData = {
      status,
      ...txHashes,
    };

    if (status === 'paid_back') {
      updateData.paid_back_at = new Date().toISOString();
    }

    const { data, error } = await supabase
      .from('stakes')
      .update(updateData)
      .eq('id', stakeId)
      .select()
      .single();

    if (error) {
      throw error;
    }

    return { success: true, stake: data };
  } catch (error) {
    console.error('❌ Error in updateStakeStatus:', error.message);
    return { success: false, error: error.message };
  }
}

// ============================================
// PHASE 4: Pay Back (Return Stake)
// ============================================

/**
 * Pay back a stake - return funds to wallet and mark as paid_back
 * @param {string} stakeId - Stake ID
 * @param {string} walletAddress - User's wallet address
 * @returns {Promise<{success: boolean, newBalance: number}>}
 */
export async function payBackStake(stakeId, walletAddress) {
  const normalizedAddress = walletAddress.toLowerCase();

  try {
    // Get the stake
    const { data: stake, error: stakeError } = await supabase
      .from('stakes')
      .select('*')
      .eq('id', stakeId)
      .eq('wallet_address', normalizedAddress)
      .single();

    if (stakeError) {
      throw stakeError;
    }

    if (stake.status === 'paid_back') {
      return { success: false, error: 'Stake already paid back' };
    }

    // Get current wallet balance
    const { data: wallet, error: walletError } = await supabase
      .from('wallets')
      .select('balance_inr')
      .eq('wallet_address', normalizedAddress)
      .single();

    if (walletError) {
      throw walletError;
    }

    const currentBalance = parseFloat(wallet.balance_inr) || 0;
    // Default fee percent (frontend-side display only) - server will decide final fee
    const PAYBACK_FEE_PERCENT = 0; // 0 = no fee
    const amountToReturn = parseFloat(stake.amount_inr) * (1 - PAYBACK_FEE_PERCENT);
    const newBalance = currentBalance + amountToReturn;

    // Update wallet balance
    const { error: updateWalletError } = await supabase
      .from('wallets')
      .update({
        balance_inr: newBalance,
        updated_at: new Date().toISOString(),
      })
      .eq('wallet_address', normalizedAddress);

    if (updateWalletError) {
      throw updateWalletError;
    }

    // Mark stake as paid_back
    const { error: updateStakeError } = await supabase
      .from('stakes')
      .update({
        status: 'paid_back',
        paid_back_at: new Date().toISOString(),
      })
      .eq('id', stakeId);

    if (updateStakeError) {
      // Rollback wallet
      await supabase
        .from('wallets')
        .update({ balance_inr: currentBalance })
        .eq('wallet_address', normalizedAddress);
      throw updateStakeError;
    }

    console.log(`✅ Stake paid back: ₹${amountToReturn} returned to wallet`);
    return {
      success: true,
      newBalance: newBalance,
      amountReturned: amountToReturn,
    };
  } catch (error) {
    console.error('❌ Error in payBackStake:', error.message);
    return { success: false, error: error.message };
  }
}

// ============================================
// PHASE 5: Dashboard Queries
// ============================================

/**
 * Get all loans for a user (from lending_loans table)
 * @param {string} walletAddress - User's wallet address
 * @returns {Promise<{success: boolean, stakes: array}>}
 */
export async function getStakeHistory(walletAddress) {
  const normalizedAddress = walletAddress.toLowerCase();

  try {
    const { data, error } = await supabase
      .from('lending_loans')
      .select('*')
      .eq('user_id', normalizedAddress)
      .order('created_at', { ascending: false });

    if (error) {
      throw error;
    }

    // Map lending_loans fields to stakes format for compatibility with existing UI
    const stakes = (data || []).map(p => ({
      id: p.id,
      wallet_address: p.user_id,
      amount_inr: p.collateral_value_inr || p.borrowed_value_inr,
      amount_pas: p.borrowed_pas,
      exchange_rate: p.borrowed_value_inr && p.borrowed_pas ? (p.borrowed_value_inr / p.borrowed_pas).toFixed(2) : 0,
      status: p.status,
      created_at: p.created_at,
      stellar_tx_hash: p.stellar_lock_tx_hash,
      evm_tx_hash: p.evm_release_tx_hash,
      // Additional lending fields
      collateral_xlm: p.collateral_xlm,
      collateral_value_inr: p.collateral_value_inr,
      borrowed_pas: p.borrowed_pas,
      borrowed_value_inr: p.borrowed_value_inr,
      ltv_ratio: p.ltv_ratio,
      interest_rate_apy: p.interest_rate_apy,
      loan_type: p.loan_type,
      loan_duration_days: p.loan_duration_days,
      health_factor: p.health_factor,
      liquidation_price: p.liquidation_price,
      repayment_deadline: p.repayment_deadline,
      is_lending_loan: true
    }));

    return { success: true, stakes };
  } catch (error) {
    console.error('❌ Error in getStakeHistory:', error.message);
    return { success: false, error: error.message, stakes: [] };
  }
}

/**
 * Get active loans (active or overdue, not repaid/liquidated)
 * @param {string} walletAddress - User's wallet address
 * @returns {Promise<{success: boolean, stakes: array}>}
 */
export async function getActiveStakes(walletAddress) {
  const normalizedAddress = walletAddress.toLowerCase();

  try {
    const { data, error } = await supabase
      .from('lending_loans')
      .select('*')
      .eq('user_id', normalizedAddress)
      .in('status', ['active', 'overdue'])
      .order('created_at', { ascending: false });

    if (error) {
      throw error;
    }

    // Map lending_loans fields to stakes format for compatibility
    const stakes = (data || []).map(p => ({
      id: p.id,
      wallet_address: p.user_id,
      amount_inr: p.collateral_value_inr || p.borrowed_value_inr,
      amount_pas: p.borrowed_pas,
      exchange_rate: p.borrowed_value_inr && p.borrowed_pas ? (p.borrowed_value_inr / p.borrowed_pas).toFixed(2) : 0,
      status: p.status,
      created_at: p.created_at,
      // Additional lending fields
      collateral_xlm: p.collateral_xlm,
      collateral_value_inr: p.collateral_value_inr,
      borrowed_pas: p.borrowed_pas,
      borrowed_value_inr: p.borrowed_value_inr,
      ltv_ratio: p.ltv_ratio,
      health_factor: p.health_factor,
      repayment_deadline: p.repayment_deadline,
      is_lending_loan: true
    }));

    return { success: true, stakes };
  } catch (error) {
    console.error('❌ Error in getActiveStakes:', error.message);
    return { success: false, error: error.message, stakes: [] };
  }
}

/**
 * Get total amount currently in active loans
 * @param {string} walletAddress - User's wallet address
 * @returns {Promise<{success: boolean, totalInr: number, totalPas: number}>}
 */
export async function getTotalStaked(walletAddress) {
  const normalizedAddress = walletAddress.toLowerCase();

  try {
    const { data, error } = await supabase
      .from('lending_loans')
      .select('collateral_value_inr, borrowed_pas')
      .eq('user_id', normalizedAddress)
      .in('status', ['active', 'overdue']);

    if (error) {
      throw error;
    }

    const totalInr = data.reduce((sum, s) => sum + parseFloat(s.collateral_value_inr || 0), 0);
    const totalPas = data.reduce((sum, s) => sum + parseFloat(s.borrowed_pas || 0), 0);

    return {
      success: true,
      totalInr,
      totalPas,
    };
  } catch (error) {
    console.error('❌ Error in getTotalStaked:', error.message);
    return { success: false, error: error.message, totalInr: 0, totalPas: 0 };
  }
}

/**
 * Get user's complete dashboard data
 * @param {string} walletAddress - User's wallet address
 * @returns {Promise<object>} - All user data for dashboard
 */
export async function getDashboardData(walletAddress) {
console.log('🔍 Fetching dashboard data for:', walletAddress);
  const normalizedAddress = walletAddress.toLowerCase();

  try {
    const [balanceResult, stakesResult, totalResult] = await Promise.all([
      getWalletBalance(normalizedAddress),
      getStakeHistory(normalizedAddress),
      getTotalStaked(normalizedAddress),
    ]);
    console.log('✅ Dashboard data fetched successfully');
    return {
      success: true,
      balance: balanceResult.balance || 0,
      stakes: stakesResult.stakes || [],
      totalStakedInr: totalResult.totalInr || 0,
      totalStakedPas: totalResult.totalPas || 0,
    };
  } catch (error) {
    console.error('❌ Error in getDashboardData:', error.message);
    return {
      success: false,
      error: error.message,
      balance: 0,
      stakes: [],
      totalStakedInr: 0,
      totalStakedPas: 0,
    };
  }
}
