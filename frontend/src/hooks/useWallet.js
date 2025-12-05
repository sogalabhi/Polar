import { useState, useEffect, useCallback } from 'react';
import { checkOrCreateUser, getDashboardData } from '../lib/supabase';

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

  // Check if MetaMask is installed
  const isMetaMaskInstalled = typeof window !== 'undefined' && !!window.ethereum;

  // Load user data from Supabase
  const loadUserData = useCallback(async (walletAddress) => {
    if (!walletAddress) return;
    
    setIsLoading(true);
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
    } finally {
      setIsLoading(false);
    }
  }, []);

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
        // Load full user data
        await loadUserData(walletAddress);
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
  }, [isMetaMaskInstalled, loadUserData]);

  // Disconnect wallet function
  const disconnect = useCallback(() => {
    setAddress(null);
    setUserData(null);
    setError(null);
  }, []);

  // Refresh user data
  const refresh = useCallback(async () => {
    if (address) {
      await loadUserData(address);
    }
  }, [address, loadUserData]);

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
          await loadUserData(newAddress);
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
  }, [isMetaMaskInstalled, address, disconnect, loadUserData]);

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
          await loadUserData(walletAddress);
        }
      } catch (err) {
        console.error('Error checking existing connection:', err);
      }
    };

    checkExistingConnection();
  }, [isMetaMaskInstalled, loadUserData]);

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
    
    // Actions
    connect,
    disconnect,
    refresh,
  };
}

export default useWallet;
