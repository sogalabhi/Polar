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
    const amountToReturn = parseFloat(stake.amount_inr);
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
 * Get all stakes for a user
 * @param {string} walletAddress - User's wallet address
 * @returns {Promise<{success: boolean, stakes: array}>}
 */
export async function getStakeHistory(walletAddress) {
  const normalizedAddress = walletAddress.toLowerCase();

  try {
    const { data, error } = await supabase
      .from('stakes')
      .select('*')
      .eq('wallet_address', normalizedAddress)
      .order('created_at', { ascending: false });

    if (error) {
      throw error;
    }

    return { success: true, stakes: data || [] };
  } catch (error) {
    console.error('❌ Error in getStakeHistory:', error.message);
    return { success: false, error: error.message, stakes: [] };
  }
}

/**
 * Get active stakes (pending or completed, not paid_back)
 * @param {string} walletAddress - User's wallet address
 * @returns {Promise<{success: boolean, stakes: array}>}
 */
export async function getActiveStakes(walletAddress) {
  const normalizedAddress = walletAddress.toLowerCase();

  try {
    const { data, error } = await supabase
      .from('stakes')
      .select('*')
      .eq('wallet_address', normalizedAddress)
      .in('status', ['pending', 'completed'])
      .order('created_at', { ascending: false });

    if (error) {
      throw error;
    }

    return { success: true, stakes: data || [] };
  } catch (error) {
    console.error('❌ Error in getActiveStakes:', error.message);
    return { success: false, error: error.message, stakes: [] };
  }
}

/**
 * Get total amount currently staked
 * @param {string} walletAddress - User's wallet address
 * @returns {Promise<{success: boolean, totalInr: number, totalPas: number}>}
 */
export async function getTotalStaked(walletAddress) {
  const normalizedAddress = walletAddress.toLowerCase();

  try {
    const { data, error } = await supabase
      .from('stakes')
      .select('amount_inr, amount_pas')
      .eq('wallet_address', normalizedAddress)
      .in('status', ['pending', 'completed']);

    if (error) {
      throw error;
    }

    const totalInr = data.reduce((sum, s) => sum + parseFloat(s.amount_inr), 0);
    const totalPas = data.reduce((sum, s) => sum + parseFloat(s.amount_pas), 0);

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
