import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Missing Supabase environment variables!');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

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
  if (!walletAddress) {
    return { success: false, error: 'Wallet address is required' };
  }

  const normalizedAddress = walletAddress.toLowerCase();

  try {
    // Check if user already exists
    const { data: existingWallet, error: fetchError } = await supabase
      .from('wallets')
      .select('*')
      .eq('wallet_address', normalizedAddress)
      .single();

    if (fetchError && fetchError.code !== 'PGRST116') {
      // PGRST116 = no rows returned (user doesn't exist)
      throw fetchError;
    }

    if (existingWallet) {
      // User exists, return their wallet
      console.log('✅ User found:', normalizedAddress);
      return {
        success: true,
        wallet: existingWallet,
        isNew: false,
      };
    }

    // User doesn't exist, create new wallet record
    const { data: newWallet, error: insertError } = await supabase
      .from('wallets')
      .insert({
        wallet_address: normalizedAddress,
        balance_inr: 0,
      })
      .select()
      .single();

    if (insertError) {
      throw insertError;
    }

    console.log('✅ New user created:', normalizedAddress);
    return {
      success: true,
      wallet: newWallet,
      isNew: true,
    };
  } catch (error) {
    console.error('❌ Error in checkOrCreateUser:', error.message);
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
  if (!walletAddress || !amount || amount <= 0) {
    return { success: false, error: 'Invalid wallet address or amount' };
  }

  const normalizedAddress = walletAddress.toLowerCase();

  try {
    // Get current balance
    const { data: wallet, error: fetchError } = await supabase
      .from('wallets')
      .select('balance_inr')
      .eq('wallet_address', normalizedAddress)
      .single();

    if (fetchError) {
      throw fetchError;
    }

    const currentBalance = parseFloat(wallet.balance_inr) || 0;
    const newBalance = currentBalance + amount;

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

    if (updateError) {
      throw updateError;
    }

    console.log(`✅ Added ₹${amount} to wallet. New balance: ₹${newBalance}`);
    return {
      success: true,
      newBalance: newBalance,
      wallet: data,
    };
  } catch (error) {
    console.error('❌ Error in addFunds:', error.message);
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
 * Create a new stake record and deduct from wallet balance
 * @param {string} walletAddress - User's EVM wallet address
 * @param {number} amountInr - Amount in INR to stake
 * @param {number} amountPas - PAS tokens to receive
 * @param {number} exchangeRate - Exchange rate at time of stake
 * @returns {Promise<{success: boolean, stake: object, newBalance: number}>}
 */
export async function createStake(walletAddress, amountInr, amountPas, exchangeRate) {
  if (!walletAddress || !amountInr || amountInr <= 0) {
    return { success: false, error: 'Invalid parameters' };
  }

  const normalizedAddress = walletAddress.toLowerCase();

  try {
    // Get current balance
    const { data: wallet, error: fetchError } = await supabase
      .from('wallets')
      .select('balance_inr')
      .eq('wallet_address', normalizedAddress)
      .single();

    if (fetchError) {
      throw fetchError;
    }

    const currentBalance = parseFloat(wallet.balance_inr) || 0;

    if (currentBalance < amountInr) {
      return {
        success: false,
        error: `Insufficient balance. Have ₹${currentBalance}, need ₹${amountInr}`,
      };
    }

    // Deduct from wallet
    const newBalance = currentBalance - amountInr;

    const { error: updateError } = await supabase
      .from('wallets')
      .update({
        balance_inr: newBalance,
        updated_at: new Date().toISOString(),
      })
      .eq('wallet_address', normalizedAddress);

    if (updateError) {
      throw updateError;
    }

    // Create stake record
    const { data: stake, error: insertError } = await supabase
      .from('stakes')
      .insert({
        wallet_address: normalizedAddress,
        amount_inr: amountInr,
        amount_pas: amountPas,
        exchange_rate: exchangeRate,
        status: 'pending',
      })
      .select()
      .single();

    if (insertError) {
      // Rollback wallet balance on error
      await supabase
        .from('wallets')
        .update({ balance_inr: currentBalance })
        .eq('wallet_address', normalizedAddress);
      throw insertError;
    }

    console.log(`✅ Stake created: ₹${amountInr} for ${amountPas} PAS`);
    return {
      success: true,
      stake: stake,
      newBalance: newBalance,
    };
  } catch (error) {
    console.error('❌ Error in createStake:', error.message);
    return {
      success: false,
      error: error.message,
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
  const normalizedAddress = walletAddress.toLowerCase();

  try {
    const [balanceResult, stakesResult, totalResult] = await Promise.all([
      getWalletBalance(normalizedAddress),
      getStakeHistory(normalizedAddress),
      getTotalStaked(normalizedAddress),
    ]);

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
