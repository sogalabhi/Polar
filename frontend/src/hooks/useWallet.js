import { useState, useEffect, useCallback } from 'react';
import { checkOrCreateUser, getDashboardData } from '../lib/supabase';

const API_BASE = 'http://localhost:3000';

/**
 * Custom hook for managing wallet connection and user data
 * Integrates MetaMask with Supabase user management
 */
export function useWallet() {
  const [address, setAddress] = useState(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState(null);
  const [userData, setUserData] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [realPasBalance, setRealPasBalance] = useState('0');
  const [pasInrRate, setPasInrRate] = useState(200); // Default rate

  // Check if MetaMask is installed
  const isMetaMaskInstalled = typeof window !== 'undefined' && !!window.ethereum;

  // Fetch real PAS balance from blockchain
  const fetchRealPasBalance = useCallback(async (walletAddress) => {
    if (!walletAddress) return;
    
    console.log('\n📡 ═══════════════════════════════════════════════════════════════');
    console.log('   💰 WEB3 CALL: Fetching PAS Balance from Blockchain');
    console.log('═══════════════════════════════════════════════════════════════════');
    console.log(`   📋 Wallet: ${walletAddress}`);
    console.log(`   📋 Network: Paseo Asset Hub`);
    console.log(`   📋 API: ${API_BASE}/api/pas-balance/${walletAddress}`);
    
    try {
      console.log('\n   🔍 Querying balance...');
      const response = await fetch(`${API_BASE}/api/pas-balance/${walletAddress}`);
      const data = await response.json();
      
      if (data.success) {
        setRealPasBalance(data.balance);
        console.log('\n   ═══════════════════════════════════════════════════════════');
        console.log('   ✅ BALANCE RETRIEVED');
        console.log('   ═══════════════════════════════════════════════════════════');
        console.log(`   💰 Balance: ${data.balance} PAS`);
        console.log(`   💰 Value: ${data.valueInrFormatted || 'N/A'}`);
        console.log(`   📋 Network: ${data.network}`);
        console.log('═══════════════════════════════════════════════════════════════════\n');
      } else {
        console.error('\n   ❌ Failed to fetch PAS balance:', data.error);
        console.error('═══════════════════════════════════════════════════════════════════\n');
      }
    } catch (err) {
      console.error('\n   ═══════════════════════════════════════════════════════════');
      console.error('   ❌ BALANCE FETCH ERROR');
      console.error('   ═══════════════════════════════════════════════════════════');
      console.error(`   Error: ${err.message}`);
      console.error('═══════════════════════════════════════════════════════════════════\n');
    }
  }, []);

  // Fetch exchange rate from backend (calls CoinGecko)
  const fetchExchangeRate = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/api/rates`);
      const data = await response.json();
      
      if (data.success && data.rates) {
        setPasInrRate(data.rates.pasToInr);
        console.log('📈 PAS/INR Rate:', data.rates.pasToInr);
        console.log('   (1 PAS = $' + data.rates.pasToUsdc + ' USDC, 1 USDC = ₹' + data.rates.usdcToInr + ')');
      }
    } catch (err) {
      console.error('Error fetching exchange rate:', err);
    }
  }, []);

  // Load user data from Supabase
  const loadUserData = useCallback(async (walletAddress) => {
    if (!walletAddress) return;
    
    try {
      const result = await getDashboardData(walletAddress);
      if (result.success) {
        setUserData({
          balance: result.balance,
          stakes: result.stakes,
          totalStakedInr: result.totalStakedInr,
          totalStakedPas: result.totalStakedPas,
        });
      } else {
        console.error('Failed to load user data:', result.error);
      }
    } catch (err) {
      console.error('Error loading user data:', err);
    }
  }, []);

  // Load all data (Supabase + blockchain) with loading state
  const loadAllData = useCallback(async (walletAddress) => {
    if (!walletAddress) return;
    
    setIsLoading(true);
    try {
      // Fetch all data in parallel
      await Promise.all([
        loadUserData(walletAddress),
        fetchRealPasBalance(walletAddress),
        fetchExchangeRate(),
      ]);
    } catch (err) {
      console.error('Error loading data:', err);
    } finally {
      setIsLoading(false);
    }
  }, [loadUserData, fetchRealPasBalance, fetchExchangeRate]);

  // Connect wallet function
  const connect = useCallback(async () => {
    if (!isMetaMaskInstalled) {
      setError('MetaMask is not installed. Please install it to continue.');
      return;
    }

    setIsConnecting(true);
    setError(null);

    try {
      // Request account access
      const accounts = await window.ethereum.request({
        method: 'eth_requestAccounts',
      });

      if (accounts.length === 0) {
        throw new Error('No accounts found');
      }

      const walletAddress = accounts[0];
      setAddress(walletAddress);

      // Check or create user in Supabase
      console.log('📡 Checking/creating user in Supabase...');
      const result = await checkOrCreateUser(walletAddress);
      
      if (result.success) {
        console.log(result.isNew ? '🆕 New user created!' : '👋 Welcome back!');
        // Load all data (Supabase + blockchain)
        await loadAllData(walletAddress);
      } else {
        console.error('Failed to register user:', result.error);
        setError('Failed to register wallet. Please try again.');
      }
    } catch (err) {
      console.error('Error connecting wallet:', err);
      if (err.code === 4001) {
        setError('Connection rejected. Please approve the connection in MetaMask.');
      } else {
        setError(err.message || 'Failed to connect wallet');
      }
    } finally {
      setIsConnecting(false);
    }
  }, [isMetaMaskInstalled, loadAllData]);

  // Disconnect wallet function
  const disconnect = useCallback(() => {
    setAddress(null);
    setUserData(null);
    setRealPasBalance('0');
    setError(null);
  }, []);

  // Refresh user data
  const refresh = useCallback(async () => {
    if (address) {
      await loadAllData(address);
    }
  }, [address, loadAllData]);

  // Listen for account changes
  useEffect(() => {
    if (!isMetaMaskInstalled) return;

    const handleAccountsChanged = async (accounts) => {
      if (accounts.length === 0) {
        // User disconnected
        disconnect();
      } else if (accounts[0] !== address) {
        // User switched accounts
        const newAddress = accounts[0];
        setAddress(newAddress);
        
        // Register new wallet and load data
        const result = await checkOrCreateUser(newAddress);
        if (result.success) {
          await loadAllData(newAddress);
        }
      }
    };

    const handleChainChanged = () => {
      // Reload the page on chain change as recommended by MetaMask
      window.location.reload();
    };

    window.ethereum.on('accountsChanged', handleAccountsChanged);
    window.ethereum.on('chainChanged', handleChainChanged);

    return () => {
      window.ethereum.removeListener('accountsChanged', handleAccountsChanged);
      window.ethereum.removeListener('chainChanged', handleChainChanged);
    };
  }, [isMetaMaskInstalled, address, disconnect, loadAllData]);

  // Check for existing connection on mount
  useEffect(() => {
    if (!isMetaMaskInstalled) return;

    const checkExistingConnection = async () => {
      try {
        const accounts = await window.ethereum.request({
          method: 'eth_accounts',
        });

        if (accounts.length > 0) {
          const walletAddress = accounts[0];
          setAddress(walletAddress);
          
          // Load user data for existing connection
          await checkOrCreateUser(walletAddress);
          await loadAllData(walletAddress);
        }
      } catch (err) {
        console.error('Error checking existing connection:', err);
      }
    };

    checkExistingConnection();
  }, [isMetaMaskInstalled, loadAllData]);

  return {
    // Wallet state
    address,
    isConnected: !!address,
    isConnecting,
    error,
    isMetaMaskInstalled,
    
    // User data from Supabase
    userData,
    isLoading,
    balance: userData?.balance || 0,
    stakes: userData?.stakes || [],
    totalStakedInr: userData?.totalStakedInr || 0,
    totalStakedPas: userData?.totalStakedPas || 0,
    
    // Real blockchain data
    realPasBalance,
    pasInrRate,
    
    // Actions
    connect,
    disconnect,
    refresh,
    fetchRealPasBalance,
  };
}

export default useWallet;
