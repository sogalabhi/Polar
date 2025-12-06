import React, { useState, useEffect, useCallback } from 'react';
import { useRazorpay } from 'react-razorpay';
import { motion } from 'framer-motion';
import InteractiveBackground from '../components/InteractiveBackground';
import StatCard from '../components/StatCard';
import NotificationModal from '../components/NotificationModal';
import { useWallet } from '../hooks/useWallet';
import { addFunds, createStake, initiatePayback, executePayback } from '../lib/supabase';

// API Base URL
const API_BASE = 'http://localhost:3000';

// Loan Types Configuration (will be updated from API)
const DEFAULT_LOAN_TYPES = [
  { id: 'short', name: 'Short Term', icon: '⚡', duration: 7, rate: 12, maxLtv: 70, description: 'Quick loan for immediate needs' },
  { id: 'standard', name: 'Standard', icon: '📊', duration: 30, rate: 8, maxLtv: 75, description: 'Balanced terms for most borrowers', recommended: true },
  { id: 'long', name: 'Long Term', icon: '🏦', duration: 90, rate: 6, maxLtv: 65, description: 'Extended loan with lower rates' },
  { id: 'custom', name: 'Custom', icon: '⚙️', duration: null, rate: null, maxLtv: null, description: 'Set your own terms' },
];

// Health Factor Badge Component
const HealthFactorBadge = ({ factor }) => {
  const getColor = () => {
    if (factor > 1.5) return 'bg-green-500/20 text-green-400 border-green-500/30';
    if (factor > 1.2) return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
    if (factor > 1.0) return 'bg-orange-500/20 text-orange-400 border-orange-500/30';
    return 'bg-red-500/20 text-red-400 border-red-500/30';
  };
  
  const getMessage = () => {
    if (factor > 1.5) return 'Safe';
    if (factor > 1.2) return 'Moderate';
    if (factor > 1.0) return 'At Risk';
    return 'Danger';
  };
  
  return (
    <span className={`px-3 py-1 rounded-full text-sm font-medium border ${getColor()}`}>
      {factor.toFixed(2)} {getMessage()}
    </span>
  );
};

const Dashboard = () => {
  const { Razorpay } = useRazorpay();
  const [isNotifOpen, setIsNotifOpen] = useState(false);
  const [stakeAmount, setStakeAmount] = useState('');
  const [isStaking, setIsStaking] = useState(false);
  const [payingBackStakeId, setPayingBackStakeId] = useState(null);
  
  // Loan Creation Wizard State
  const [showLoanWizard, setShowLoanWizard] = useState(false);
  const [loanStep, setLoanStep] = useState(1);
  const [selectedLoanType, setSelectedLoanType] = useState(null);
  const [borrowAmount, setBorrowAmount] = useState(500);
  const [ltvRatio, setLtvRatio] = useState(60);
  const [customDuration, setCustomDuration] = useState(30);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [isCreatingLoan, setIsCreatingLoan] = useState(false);
  
  // Lending API State
  const [lendingConfig, setLendingConfig] = useState(null);
  const [loanPreview, setLoanPreview] = useState(null);
  const [activeLoans, setActiveLoans] = useState([]);
  const [loansLoading, setLoansLoading] = useState(false);
  const [loanSummary, setLoanSummary] = useState({ loan_count: 0, total_collateral_xlm: 0, total_borrowed_pas: 0, total_borrowed_inr: 0 });
  const [loanPrices, setLoanPrices] = useState({ xlm: 0, pas: 0 });
  const [LOAN_TYPES, setLoanTypes] = useState(DEFAULT_LOAN_TYPES);
  
  // Get wallet data from Supabase via useWallet hook
  const { 
    address, 
    isConnected, 
    connect, 
    disconnect,
    balance, 
    totalStakedInr, 
    totalStakedPas,
    stakes,
    refresh,
    isLoading,
    realPasBalance,
    pasInrRate 
  } = useWallet();

  // Fetch lending configuration from API
  const fetchLendingConfig = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/api/lending/config`);
      const data = await response.json();
      if (data.success) {
        setLendingConfig(data.config);
        // Update loan types with API data
        if (data.config.loanTypes) {
          const updatedTypes = data.config.loanTypes.map(lt => ({
            id: lt.id,
            name: lt.name,
            icon: lt.id === 'short' ? '⚡' : lt.id === 'standard' ? '📊' : lt.id === 'long' ? '🏦' : '⚙️',
            duration: lt.defaultDuration,
            rate: lt.interestRate,
            maxLtv: lt.maxLtv,
            description: lt.description,
            recommended: lt.id === 'standard'
          }));
          // Add custom option
          updatedTypes.push({ id: 'custom', name: 'Custom', icon: '⚙️', duration: null, rate: null, maxLtv: null, description: 'Set your own terms' });
          setLoanTypes(updatedTypes);
        }
      }
    } catch (error) {
      console.error('Failed to fetch lending config:', error);
    }
  }, []);

  // Fetch user's active loans from API
  const fetchActiveLoans = useCallback(async () => {
    if (!address) return;
    
    setLoansLoading(true);
    try {
      const response = await fetch(`${API_BASE}/api/loans/${address}`);
      const data = await response.json();
      if (data.success && data.loans) {
        // Transform API response to match UI format
        const transformedLoans = data.loans.map(loan => ({
          id: loan.id,
          collateralXlm: parseFloat(loan.collateral_xlm) || 0,
          collateralValueInr: parseFloat(loan.collateral_value_inr) || 0,
          borrowedPas: parseFloat(loan.borrowed_pas) || 0,
          borrowedValueInr: parseFloat(loan.borrowed_value_inr) || 0,
          interestAccrued: parseFloat(loan.interestAccrued) || 0,
          lateFee: parseFloat(loan.lateFee) || 0,
          healthFactor: parseFloat(loan.healthFactor) || parseFloat(loan.health_factor) || 0,
          ltv: parseFloat(loan.ltv_ratio) || 0,
          status: loan.status,
          loanType: loan.loan_type || 'standard',
          duration: loan.loan_duration_days || 30,
          interestRate: parseFloat(loan.interest_rate_apy) || 8,
          createdAt: new Date(loan.created_at),
          deadline: loan.repayment_deadline ? new Date(loan.repayment_deadline) : null,
          liquidationPrice: parseFloat(loan.liquidation_price) || 0,
          xlmPrice: parseFloat(loan.current_xlm_price) || 0,
        }));
        setActiveLoans(transformedLoans);
        // Set auth prices
        if (data.prices) setLoanPrices(data.prices);
        // Fetch summary from view
        try {
          const summaryResp = await fetch(`${API_BASE}/api/loans/${address}/summary`);
          const summaryData = await summaryResp.json();
          if (summaryData.success && summaryData.summary) {
            setLoanSummary(summaryData.summary);
          }
        } catch (err) {
          console.error('Failed to fetch loan summary:', err);
        }
      }
    } catch (error) {
      console.error('Failed to fetch active loans:', error);
    } finally {
      setLoansLoading(false);
    }
  }, [address]);

  // Fetch loan preview from API
  const fetchLoanPreview = useCallback(async (amountInr, ltv, duration) => {
    try {
      const response = await fetch(`${API_BASE}/api/lending/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amountInr, ltv, durationDays: duration })
      });
      const data = await response.json();
      if (data.success) {
        setLoanPreview(data.preview);
      }
      return data;
    } catch (error) {
      console.error('Failed to fetch loan preview:', error);
      return null;
    }
  }, []);

  // Fetch config on mount
  useEffect(() => {
    fetchLendingConfig();
  }, [fetchLendingConfig]);

  // Fetch loans when address changes
  useEffect(() => {
    if (address) {
      fetchActiveLoans();
    }
  }, [address, fetchActiveLoans]);

  // Update loan preview when wizard params change
  useEffect(() => {
    if (showLoanWizard && loanStep >= 2 && selectedLoanType) {
      const selectedType = LOAN_TYPES.find(t => t.id === selectedLoanType);
      const duration = selectedType?.duration || customDuration;
      fetchLoanPreview(borrowAmount, ltvRatio, duration);
    }
  }, [showLoanWizard, loanStep, selectedLoanType, borrowAmount, ltvRatio, customDuration, fetchLoanPreview, LOAN_TYPES]);

  const [notifications, setNotifications] = useState([
    { title: 'Welcome to Polar!', message: 'Connect your wallet to get started.', time: 'Just now', type: 'info' },
  ]);

  const handlePayment = async (amountInr = 500) => {
    if (!isConnected) {
      alert('Please connect your wallet first!');
      return;
    }
    
    try {
      const response = await fetch('http://localhost:3000/create-order', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          amount: amountInr,
          currency: 'INR',
        }),
      });

      const order = await response.json();

      const options = {
        key: import.meta.env.VITE_RAZORPAY_KEY_ID, 
        amount: order.amount,
        currency: order.currency,
        name: 'Polar Bridge',
        description: 'Add Funds to Wallet',
        order_id: order.id,
        handler: async function (response) {
          try {
             const verifyResponse = await fetch('http://localhost:3000/verify-payment', {
                method: 'POST',
                headers: {
                   'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                   razorpay_order_id: response.razorpay_order_id,
                   razorpay_payment_id: response.razorpay_payment_id,
                   razorpay_signature: response.razorpay_signature,
                }),
             });

             const verifyResult = await verifyResponse.json();

             if (verifyResult.success) {
                // Add funds to Supabase wallet
                const result = await addFunds(address, amountInr);
                if (result.success) {
                  setNotifications(prev => [{
                     title: 'Payment Successful', 
                     message: `₹${amountInr} added to your wallet!`, 
                     time: 'Just now', 
                     type: 'success' 
                  }, ...prev]);
                  // Refresh wallet data
                  await refresh();
                }
             } else {
                alert('Payment Verification Failed!');
             }
          } catch (error) {
             console.error('Verification Error:', error);
             alert('Payment Verification Error');
          }
        },
        prefill: {
          name: 'Polar User',
          email: 'user@polar.finance',
          contact: '9999999999',
        },
        theme: {
          color: '#22c55e',
        },
      };

      const rzp1 = new Razorpay(options);
      rzp1.on('payment.failed', function (response) {
        alert(response.error.description);
      });
      rzp1.open();
    } catch (error) {
      console.error('Payment Error:', error);
    }
  };

  // Handle staking INR for PAS
  const handleStake = async () => {
    if (!isConnected) {
      alert('Please connect your wallet first!');
      return;
    }

    const amountInr = parseFloat(stakeAmount);
    if (!amountInr || amountInr <= 0) {
      alert('Please enter a valid amount');
      return;
    }

    if (amountInr > balance) {
      alert(`Insufficient balance. You have ₹${balance.toFixed(2)}`);
      return;
    }

    console.log('\n🚀 ═══════════════════════════════════════════════════════════════════');
    console.log('   USER ACTION: Buy PAS Tokens (Stake INR)');
    console.log('═══════════════════════════════════════════════════════════════════════');
    console.log(`   📋 Wallet Address: ${address}`);
    console.log(`   💳 Amount INR: ₹${amountInr}`);
    console.log(`   📈 Exchange Rate: 1 PAS = ₹${pasInrRate}`);
    console.log(`   💰 Expected PAS: ${(amountInr / pasInrRate).toFixed(6)}`);
    console.log(`   📊 Current Balance: ₹${balance.toFixed(2)}`);
    console.log('═══════════════════════════════════════════════════════════════════════\n');

    setIsStaking(true);
    try {
      const amountPas = amountInr / pasInrRate;
      console.log('   🔄 Calling createStake()...');
      const result = await createStake(address, amountInr, amountPas, pasInrRate);
      
      if (result.success) {
        console.log('\n   ═══════════════════════════════════════════════════════════════');
        console.log('   ✅ STAKE SUCCESSFUL!');
        console.log('   ═══════════════════════════════════════════════════════════════');
        if (result.stellarTxHash) {
          console.log(`   🔗 Stellar TX Hash: ${result.stellarTxHash}`);
          console.log(`   🔗 Explorer: https://stellar.expert/explorer/testnet/tx/${result.stellarTxHash}`);
        }
        if (result.purchaseId) {
          console.log(`   📋 Purchase ID: ${result.purchaseId}`);
        }
        console.log(`   💰 New Balance: ₹${result.newBalance}`);
        if (result.warning) {
          console.log(`   ⚠️  Warning: ${result.warning}`);
        }
        console.log('═══════════════════════════════════════════════════════════════════\n');
        
        setNotifications(prev => [{
          title: 'Stake Created!',
          message: `Staked ₹${amountInr} for ${amountPas.toFixed(4)} PAS${result.stellarTxHash ? ` (TX: ${result.stellarTxHash.slice(0, 8)}...)` : ''}`,
          time: 'Just now',
          type: 'success'
        }, ...prev]);
        setStakeAmount('');
        await refresh();
      } else {
        console.error('\n   ❌ STAKE FAILED:', result.error);
        console.error('═══════════════════════════════════════════════════════════════════\n');
        alert(result.error || 'Stake failed');
      }
    } catch (error) {
      console.error('\n   ═══════════════════════════════════════════════════════════════');
      console.error('   ❌ STAKE ERROR');
      console.error('   ═══════════════════════════════════════════════════════════════');
      console.error(`   Error: ${error.message}`);
      console.error('═══════════════════════════════════════════════════════════════════\n');
      alert('Failed to create stake');
    } finally {
      setIsStaking(false);
    }
  };

  // Format address for display
  const formatAddress = (addr) => {
    if (!addr) return '';
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  // Calculate loan details based on wizard inputs (uses API preview when available)
  const calculateLoanDetails = () => {
    // Use API preview if available
    if (loanPreview) {
      const selectedType = LOAN_TYPES.find(t => t.id === selectedLoanType);
      return {
        duration: loanPreview.durationDays,
        rate: loanPreview.interestRateApy,
        maxLtv: selectedType?.maxLtv || (lendingConfig?.maxLtv || 75),
        collateralNeeded: loanPreview.collateralNeededInr,
        collateralXlm: loanPreview.collateralXlm,
        healthFactor: loanPreview.healthFactor,
        interestEstimate: loanPreview.estimatedInterestInr,
        liquidationPrice: loanPreview.liquidationPrice,
        dropPercent: ((loanPreview.xlmPrice - loanPreview.liquidationPrice) / loanPreview.xlmPrice * 100).toFixed(0),
        borrowPas: loanPreview.borrowPas,
        xlmPrice: loanPreview.xlmPrice,
      };
    }
    
    // Fallback calculation if API not available
    const selectedType = LOAN_TYPES.find(t => t.id === selectedLoanType);
    const duration = selectedType?.duration || customDuration;
    const rate = selectedType?.rate || (customDuration <= 7 ? 12 : customDuration <= 14 ? 10 : customDuration <= 30 ? 8 : customDuration <= 60 ? 7 : 6);
    const maxLtv = selectedType?.maxLtv || 75;
    const collateralNeeded = borrowAmount / (ltvRatio / 100);
    const healthFactor = (collateralNeeded * 0.85) / borrowAmount;
    const interestEstimate = borrowAmount * (rate / 100) * (duration / 365);
    const xlmPrice = 18.92; // Fallback XLM price
    const collateralXlm = collateralNeeded / xlmPrice;
    const liquidationPrice = (borrowAmount / collateralXlm) / 0.85;
    const dropPercent = ((xlmPrice - liquidationPrice) / xlmPrice * 100).toFixed(0);
    
    return { duration, rate, maxLtv, collateralNeeded, collateralXlm, healthFactor, interestEstimate, liquidationPrice, dropPercent, borrowPas: borrowAmount / pasInrRate, xlmPrice };
  };

  // Get days until/since deadline
  const getDaysRemaining = (deadline) => {
    const now = new Date();
    const diff = deadline - now;
    const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
    return days;
  };

  // Handle payback PAS to get INR for a specific stake
  const handlePayback = async (stake) => {
    if (!isConnected) {
      alert('Please connect your wallet first!');
      return;
    }

    const amountPas = parseFloat(stake.amount_pas);
    if (!amountPas || amountPas <= 0) {
      alert('Invalid stake amount');
      return;
    }

    if (amountPas > parseFloat(realPasBalance)) {
      alert(`Insufficient PAS balance. You have ${parseFloat(realPasBalance).toFixed(4)} PAS but need ${amountPas.toFixed(4)} PAS`);
      return;
    }

    const currentInrValue = amountPas * pasInrRate;

    console.log('\n🔄 ═══════════════════════════════════════════════════════════════════');
    console.log('   USER ACTION: Sell PAS from Stake');
    console.log('═══════════════════════════════════════════════════════════════════════');
    console.log(`   📋 Stake ID: ${stake.id}`);
    console.log(`   📋 Wallet Address: ${address}`);
    console.log(`   💰 Amount PAS: ${amountPas}`);
    console.log(`   📈 Original Rate: 1 PAS = ₹${stake.exchange_rate}`);
    console.log(`   📈 Current Rate: 1 PAS = ₹${pasInrRate}`);
    console.log(`   💵 INR at current rate: ₹${currentInrValue.toFixed(2)}`);
    console.log('═══════════════════════════════════════════════════════════════════════\n');

    setPayingBackStakeId(stake.id);
    try {
      // Step 1: Initiate payback to get pool address (pass stake.id to update existing record)
      console.log('   🔄 Step 1: Initiating payback...');
      const initResult = await initiatePayback(address, amountPas, stake.id);
      
      if (!initResult.success) {
        throw new Error(initResult.error || 'Failed to initiate payback');
      }

      console.log(`   ✅ Pool Address: ${initResult.poolAddress}`);
      console.log(`   💵 INR to receive: ₹${initResult.inrToReceive}`);
      console.log(`   💰 Amount Wei: ${initResult.amountWei}`);

      // Step 2: Execute the PAS transfer via MetaMask
      console.log('\n   🔄 Step 2: Sending PAS to pool via MetaMask...');
      const execResult = await executePayback(initResult.poolAddress, initResult.amountWei);

      if (execResult.success) {
        console.log('\n   ═══════════════════════════════════════════════════════════════');
        console.log('   ✅ PAYBACK SUCCESSFUL!');
        console.log('   ═══════════════════════════════════════════════════════════════');
        console.log(`   🔗 Transaction Hash: ${execResult.txHash}`);
        console.log(`   🔗 Explorer: https://blockscout-asset-hub-paseo.parity-chains-scoutplorer.io/tx/${execResult.txHash}`);
        console.log(`   💵 INR Credited: ₹${initResult.inrToReceive}`);
        console.log('   ⏳ INR will be credited once relayer confirms the transaction');
        console.log('═══════════════════════════════════════════════════════════════════\n');

        setNotifications(prev => [{
          title: 'Sell Order Submitted!',
          message: `Sent ${amountPas.toFixed(4)} PAS. ₹${initResult.inrToReceive} will be credited after confirmation.`,
          time: 'Just now',
          type: 'success'
        }, ...prev]);
        
        // Refresh after a short delay to show updated balances
        setTimeout(() => refresh(), 3000);
      } else {
        throw new Error(execResult.error || 'Transaction failed');
      }
    } catch (error) {
      console.error('\n   ═══════════════════════════════════════════════════════════════');
      console.error('   ❌ PAYBACK ERROR');
      console.error('   ═══════════════════════════════════════════════════════════════');
      console.error(`   Error: ${error.message}`);
      console.error('═══════════════════════════════════════════════════════════════════\n');
      
      setNotifications(prev => [{
        title: 'Sell Failed',
        message: error.message,
        time: 'Just now',
        type: 'error'
      }, ...prev]);
    } finally {
      setPayingBackStakeId(null);
    }
  };

  // Handle loan creation
  const handleCreateLoan = async () => {
    if (!isConnected) {
      alert('Please connect your wallet first!');
      return;
    }

    const details = calculateLoanDetails();
    
    console.log('\n🏦 ═══════════════════════════════════════════════════════════════════');
    console.log('   USER ACTION: Create Collateralized Loan');
    console.log('═══════════════════════════════════════════════════════════════════════');
    console.log(`   📋 Wallet Address: ${address}`);
    console.log(`   💰 Borrow Amount: ₹${borrowAmount} (${details.borrowPas?.toFixed(4) || 'N/A'} PAS)`);
    console.log(`   🔒 Collateral: ${details.collateralXlm?.toFixed(4)} XLM (₹${details.collateralNeeded?.toFixed(2)})`);
    console.log(`   📊 LTV Ratio: ${ltvRatio}%`);
    console.log(`   📈 Interest Rate: ${details.rate}% APY`);
    console.log(`   ⏰ Duration: ${details.duration} days`);
    console.log(`   💚 Health Factor: ${details.healthFactor?.toFixed(2)}`);
    console.log('═══════════════════════════════════════════════════════════════════════\n');

    setIsCreatingLoan(true);
    try {
      const selectedType = LOAN_TYPES.find(t => t.id === selectedLoanType);
      
      const response = await fetch(`${API_BASE}/api/borrow-pas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: address,
          borrowAmountInr: borrowAmount,
          evmAddress: address,  // MetaMask address is the EVM address
          ltvRatio: ltvRatio,
          customDuration: selectedLoanType === 'custom' ? customDuration : null,
          loanType: selectedLoanType === 'custom' ? 'custom' : selectedLoanType
        })
      });

      const result = await response.json();

      if (result.success) {
        console.log('\n   ═══════════════════════════════════════════════════════════════');
        console.log('   ✅ LOAN CREATED SUCCESSFULLY!');
        console.log('   ═══════════════════════════════════════════════════════════════');
        console.log(`   📋 Loan ID: ${result.loan?.id || result.purchaseId}`);
        console.log(`   🔗 Stellar TX: ${result.stellarTxHash || 'Pending'}`);
        console.log(`   💰 PAS Received: ${result.loan?.borrowedPas || details.borrowPas?.toFixed(4)} PAS`);
        console.log(`   🔒 XLM Locked: ${result.loan?.collateralXlm || details.collateralXlm?.toFixed(4)} XLM`);
        console.log('═══════════════════════════════════════════════════════════════════\n');

        setNotifications(prev => [{
          title: 'Loan Created!',
          message: `Borrowed ${result.loan?.borrowedPas?.toFixed(4) || details.borrowPas?.toFixed(4)} PAS with ${result.loan?.collateralXlm?.toFixed(2) || details.collateralXlm?.toFixed(2)} XLM collateral`,
          time: 'Just now',
          type: 'success'
        }, ...prev]);

        // Reset wizard and refresh data
        setShowLoanWizard(false);
        setLoanStep(1);
        setSelectedLoanType(null);
        setAcceptedTerms(false);
        setBorrowAmount(500);
        setLtvRatio(60);
        
        // Refresh loans and wallet data
        await Promise.all([fetchActiveLoans(), refresh()]);
      } else {
        throw new Error(result.error || 'Failed to create loan');
      }
    } catch (error) {
      console.error('\n   ═══════════════════════════════════════════════════════════════');
      console.error('   ❌ LOAN CREATION ERROR');
      console.error('   ═══════════════════════════════════════════════════════════════');
      console.error(`   Error: ${error.message}`);
      console.error('═══════════════════════════════════════════════════════════════════\n');

      setNotifications(prev => [{
        title: 'Loan Creation Failed',
        message: error.message,
        time: 'Just now',
        type: 'error'
      }, ...prev]);
    } finally {
      setIsCreatingLoan(false);
    }
  };

  // State for repay/add collateral modals
  const [repayingLoanId, setRepayingLoanId] = useState(null);
  const [addingCollateralLoanId, setAddingCollateralLoanId] = useState(null);
  const [additionalCollateral, setAdditionalCollateral] = useState('');
  const [showCollateralModal, setShowCollateralModal] = useState(false);
  const [selectedLoanForCollateral, setSelectedLoanForCollateral] = useState(null);

  // Handle loan repayment with PAS
  const handleRepayLoan = async (loan) => {
    if (!isConnected) {
      alert('Please connect your wallet first!');
      return;
    }

    setRepayingLoanId(loan.id);
    try {
      // Step 1: Get repayment details from API
      console.log('\n💰 ═══════════════════════════════════════════════════════════════════');
      console.log('   USER ACTION: Repay Loan with PAS');
      console.log('═══════════════════════════════════════════════════════════════════════');
      console.log(`   📋 Loan ID: ${loan.id}`);
      
      const detailsResponse = await fetch(`${API_BASE}/api/lending/repay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: address,
          loanId: loan.id
        })
      });

      const detailsResult = await detailsResponse.json();
      
      if (!detailsResult.success) {
        throw new Error(detailsResult.error || 'Failed to get repayment details');
      }

      const { repaymentDetails, loan: loanInfo } = detailsResult;
      const totalPas = repaymentDetails.totalPas;
      
      console.log(`   💰 Total Due: ${totalPas.toFixed(4)} PAS (₹${repaymentDetails.totalInr.toFixed(2)})`);
      console.log(`   🔒 Collateral to release: ${loanInfo.collateralXlm?.toFixed(4)} XLM`);
      
      // Check PAS balance
      if (parseFloat(realPasBalance) < totalPas) {
        alert(`Insufficient PAS balance. You have ${parseFloat(realPasBalance).toFixed(4)} PAS, need ${totalPas.toFixed(4)} PAS`);
        setRepayingLoanId(null);
        return;
      }

      // Confirm with user
      if (!window.confirm(`Send ${totalPas.toFixed(4)} PAS to repay this loan?\n\nBreakdown:\n- Principal: ${repaymentDetails.principalPas.toFixed(4)} PAS\n- Interest: ${repaymentDetails.interestPas.toFixed(4)} PAS\n- Late Fee: ${repaymentDetails.lateFeePas.toFixed(4)} PAS\n\nYour collateral (${loanInfo.collateralXlm?.toFixed(4)} XLM) will be released.`)) {
        setRepayingLoanId(null);
        return;
      }

      // Step 2: Send PAS to pool via MetaMask
      console.log('\n   🔄 Step 2: Sending PAS to pool via MetaMask...');
      const poolAddress = repaymentDetails.poolAddress;
      const amountWei = BigInt(Math.floor(totalPas * 1e18)).toString(16);
      
      const txHash = await window.ethereum.request({
        method: 'eth_sendTransaction',
        params: [{
          from: address,
          to: poolAddress,
          value: '0x' + amountWei,
        }],
      });

      console.log(`   🔗 TX Hash: ${txHash}`);
      console.log('   ⏳ Waiting for confirmation...');

      // Step 3: Confirm repayment with backend
      console.log('\n   🔄 Step 3: Confirming repayment...');
      const confirmResponse = await fetch(`${API_BASE}/api/lending/repay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: address,
          loanId: loan.id,
          txHash: txHash
        })
      });

      const result = await confirmResponse.json();

      if (result.success) {
        console.log('\n   ═══════════════════════════════════════════════════════════════');
        console.log('   ✅ LOAN REPAID SUCCESSFULLY!');
        console.log('   ═══════════════════════════════════════════════════════════════');
        console.log(`   💰 Total Paid: ${result.repayment?.totalPaidPas?.toFixed(4)} PAS`);
        console.log(`   🔓 Collateral Released: ${result.collateral?.xlm?.toFixed(4)} XLM`);
        console.log(`   🔗 TX: ${txHash}`);
        console.log('═══════════════════════════════════════════════════════════════════\n');

        setNotifications(prev => [{
          title: 'Loan Repaid!',
          message: `Paid ${result.repayment?.totalPaidPas?.toFixed(4)} PAS. Your ${result.collateral?.xlm?.toFixed(4)} XLM collateral has been released.`,
          time: 'Just now',
          type: 'success'
        }, ...prev]);

        // Refresh loans and wallet data
        await Promise.all([fetchActiveLoans(), refresh()]);
      } else {
        throw new Error(result.error || 'Failed to confirm repayment');
      }
    } catch (error) {
      console.error('\n   ❌ REPAY ERROR:', error.message);
      setNotifications(prev => [{
        title: 'Repayment Failed',
        message: error.message,
        time: 'Just now',
        type: 'error'
      }, ...prev]);
    } finally {
      setRepayingLoanId(null);
    }
  };

  // Handle adding collateral to loan
  const handleAddCollateral = async () => {
    if (!isConnected || !selectedLoanForCollateral) {
      alert('Please connect your wallet first!');
      return;
    }

    const xlmAmount = parseFloat(additionalCollateral);
    if (!xlmAmount || xlmAmount <= 0) {
      alert('Please enter a valid XLM amount');
      return;
    }

    console.log('\n📈 ═══════════════════════════════════════════════════════════════════');
    console.log('   USER ACTION: Add Collateral');
    console.log('═══════════════════════════════════════════════════════════════════════');
    console.log(`   📋 Loan ID: ${selectedLoanForCollateral.id}`);
    console.log(`   🔒 Additional XLM: ${xlmAmount}`);
    console.log('═══════════════════════════════════════════════════════════════════════\n');

    setAddingCollateralLoanId(selectedLoanForCollateral.id);
    try {
      const response = await fetch(`${API_BASE}/api/lending/add-collateral`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: address,
          loanId: selectedLoanForCollateral.id,
          additionalXlm: xlmAmount
        })
      });

      const result = await response.json();

      if (result.success) {
        console.log('\n   ═══════════════════════════════════════════════════════════════');
        console.log('   ✅ COLLATERAL ADDED SUCCESSFULLY!');
        console.log('   ═══════════════════════════════════════════════════════════════');
        console.log(`   📊 Health Factor: ${result.loan?.healthFactor?.previous?.toFixed(2)} → ${result.loan?.healthFactor?.new?.toFixed(2)}`);
        console.log('═══════════════════════════════════════════════════════════════════\n');

        setNotifications(prev => [{
          title: 'Collateral Added!',
          message: `Added ${xlmAmount} XLM. Health factor improved: ${result.loan?.healthFactor?.previous?.toFixed(2)} → ${result.loan?.healthFactor?.new?.toFixed(2)}`,
          time: 'Just now',
          type: 'success'
        }, ...prev]);

        // Reset and refresh
        setShowCollateralModal(false);
        setSelectedLoanForCollateral(null);
        setAdditionalCollateral('');
        await Promise.all([fetchActiveLoans(), refresh()]);
      } else {
        throw new Error(result.error || 'Failed to add collateral');
      }
    } catch (error) {
      console.error('\n   ❌ ADD COLLATERAL ERROR:', error.message);
      setNotifications(prev => [{
        title: 'Add Collateral Failed',
        message: error.message,
        time: 'Just now',
        type: 'error'
      }, ...prev]);
    } finally {
      setAddingCollateralLoanId(null);
    }
  };

  // Open add collateral modal
  const openCollateralModal = (loan) => {
    setSelectedLoanForCollateral(loan);
    setShowCollateralModal(true);
    setAdditionalCollateral('');
  };

  return (
    <div className="min-h-screen bg-black text-white font-mono relative overflow-hidden selection:bg-green-500 selection:text-black">
      <InteractiveBackground />
      
      {/* Navbar */}
      <nav className="relative z-20 container mx-auto px-6 py-4 flex justify-between items-center border-b border-white/10 bg-black/50 backdrop-blur-md">
        <div className="text-xl font-bold tracking-tighter flex items-center gap-2">
          <div className="w-6 h-6 rounded-full bg-gradient-to-tr from-green-600 to-green-400" />
          Polar <span className="text-xs text-gray-500 font-normal ml-2">Bridge</span>
        </div>
        
        <div className="flex items-center gap-4">
           {/* PAS Balance Display */}
           {isConnected && (
             <div className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-purple-500/10 to-blue-500/10 border border-purple-500/30 rounded-xl">
               <div className="w-5 h-5 rounded-full bg-gradient-to-tr from-purple-500 to-blue-400 flex items-center justify-center">
                 <span className="text-[10px] font-bold text-white">P</span>
               </div>
               {isLoading ? (
                 <div className="animate-pulse h-4 w-20 bg-purple-500/20 rounded"></div>
               ) : (
                 <span className="text-sm font-medium text-purple-300">
                   {parseFloat(realPasBalance).toFixed(4)} <span className="text-purple-400/70">PAS</span>
                 </span>
               )}
             </div>
           )}

           {/* INR Balance Display */}
           {isConnected && (
             <div className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-green-500/10 to-emerald-500/10 border border-green-500/30 rounded-xl">
               {isLoading ? (
                 <div className="animate-pulse h-4 w-16 bg-green-500/20 rounded"></div>
               ) : (
                 <span className="text-sm font-medium text-green-300">
                   ₹{balance.toFixed(2)}
                 </span>
               )}
             </div>
           )}

           {/* Notification Trigger */}
           <button 
             onClick={() => setIsNotifOpen(true)}
             className="relative p-2 text-gray-400 hover:text-white transition-colors"
           >
             <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
               <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
             </svg>
             {notifications.length > 0 && (
               <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-green-500 rounded-full animate-pulse" />
             )}
           </button>
           
           {/* Wallet Connection */}
           {isConnected ? (
             <button 
               onClick={disconnect}
               className="flex items-center gap-2 px-4 py-2 bg-white/5 border border-white/10 rounded-xl hover:bg-white/10 transition-colors"
             >
               <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
               <span className="text-sm font-medium">{formatAddress(address)}</span>
             </button>
           ) : (
             <button 
               onClick={connect}
               className="px-4 py-2 bg-green-500 text-black font-bold rounded-xl hover:bg-green-400 transition-colors"
             >
               Connect Wallet
             </button>
           )}
        </div>
      </nav>

      {/* Main Content */}
      <main className="relative z-20 container mx-auto px-6 py-8">
        
        {/* Header */}
        <div className="mb-8">
            <h1 className="text-3xl font-bold mb-2">My Assets</h1>
            <p className="text-gray-400 text-sm">Manage your liquidity, loans, and collateral.</p>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            <StatCard 
                title="Available INR" 
                value={`₹ ${balance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`}
                icon={<svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M4 4a2 2 0 00-2 2v4a2 2 0 002 2V6h10a2 2 0 00-2-2H4zm2 6a2 2 0 012-2h8a2 2 0 012 2v4a2 2 0 01-2 2H8a2 2 0 01-2-2v-4zm6 4a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" /></svg>}
                subValue="Wallet Balance"
                isLoading={isLoading}
            />
            <StatCard 
              title="Total Collateral" 
              value={`₹ ${activeLoans.reduce((sum, l) => sum + (l.collateralValueInr || 0), 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`}
                icon={<svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" /></svg>}
                subValue="Locked in Loans"
                isLoading={isLoading}
            />
             <StatCard 
                title="PAS Borrowed" 
                value={`${activeLoans.reduce((sum, l) => sum + l.borrowedPas, 0).toFixed(4)} PAS`}
                icon={<svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 2a4 4 0 00-4 4v1H5a1 1 0 00-.994.89l-1 9A1 1 0 004 18h12a1 1 0 00.994-1.11l-1-9A1 1 0 0015 7h-1V6a4 4 0 00-4-4zm2 5V6a2 2 0 10-4 0v1h4zm-6 3a1 1 0 112 0 1 1 0 01-2 0zm7-1a1 1 0 100 2 1 1 0 000-2z" clipRule="evenodd" /></svg>}
                subValue={`Active Loans: ${activeLoans.filter(l => l.status === 'active' || l.status === 'overdue').length}`}
                isLoading={isLoading}
            />
            <StatCard 
                title="Total Debt" 
                value={`₹ ${activeLoans.reduce((sum, l) => sum + l.borrowedValueInr + l.interestAccrued + l.lateFee, 0).toFixed(2)}`}
                icon={<svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M12 7a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0V8.414l-4.293 4.293a1 1 0 01-1.414 0L8 10.414l-4.293 4.293a1 1 0 01-1.414-1.414l5-5a1 1 0 011.414 0L11 10.586 14.586 7H12z" clipRule="evenodd" /></svg>}
                subValue="Principal + Interest"
                isLoading={isLoading}
            />
        </div>

        {/* Quick Actions + Create Loan Button */}
        <div className="flex justify-between items-center mb-8">
          <div className="flex gap-4">
            <button 
              onClick={() => handlePayment(500)} 
              className="px-6 py-3 bg-green-500/20 border border-green-500/30 text-green-400 font-medium rounded-xl hover:bg-green-500/30 transition-all"
              disabled={!isConnected}
            >
              + Add Funds
            </button>
          </div>
          <button 
            onClick={() => { setShowLoanWizard(true); setLoanStep(1); setSelectedLoanType(null); setAcceptedTerms(false); }}
            className="px-6 py-3 bg-gradient-to-r from-purple-500 to-pink-500 text-white font-bold rounded-xl hover:opacity-90 transition-all shadow-lg shadow-purple-500/20"
          >
            🏦 Create New Loan
          </button>
        </div>

        {/* Loan Creation Wizard Modal */}
        {showLoanWizard && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-gray-900 border border-white/10 rounded-3xl p-8 max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto"
            >
              {/* Header */}
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold">🏦 Create New Loan</h2>
                <button onClick={() => setShowLoanWizard(false)} className="text-gray-400 hover:text-white text-2xl">&times;</button>
              </div>
              
              {/* Progress Steps */}
              <div className="flex justify-center mb-8">
                {[1, 2, 3].map(s => (
                  <div key={s} className="flex items-center">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold transition-all ${
                      loanStep >= s ? 'bg-purple-500 text-white' : 'bg-white/10 text-gray-500'
                    }`}>
                      {loanStep > s ? '✓' : s}
                    </div>
                    {s < 3 && <div className={`w-16 h-1 mx-2 transition-all ${loanStep > s ? 'bg-purple-500' : 'bg-white/10'}`} />}
                  </div>
                ))}
              </div>
              
              {/* Step 1: Select Loan Type */}
              {loanStep === 1 && (
                <div>
                  <h3 className="text-lg font-semibold mb-4 text-center text-gray-300">Select Loan Type</h3>
                  <div className="grid grid-cols-2 gap-4 mb-6">
                    {LOAN_TYPES.map(type => (
                      <button
                        key={type.id}
                        onClick={() => setSelectedLoanType(type.id)}
                        className={`p-5 rounded-2xl border-2 text-left transition-all relative ${
                          selectedLoanType === type.id 
                            ? 'border-purple-500 bg-purple-500/20' 
                            : 'border-white/10 hover:border-white/30 bg-white/5'
                        }`}
                      >
                        {type.recommended && (
                          <span className="absolute -top-2 -right-2 text-xs bg-purple-500 text-white px-2 py-0.5 rounded-full">
                            BEST
                          </span>
                        )}
                        <div className="text-2xl mb-2">{type.icon}</div>
                        <div className="font-bold">{type.name}</div>
                        {type.duration ? (
                          <div className="text-xs text-gray-400 mt-1">
                            {type.duration}d • {type.rate}% APY • {type.maxLtv}% LTV
                          </div>
                        ) : (
                          <div className="text-xs text-gray-400 mt-1">Configure your terms</div>
                        )}
                        <div className="text-xs text-gray-500 mt-2">{type.description}</div>
                      </button>
                    ))}
                  </div>
                  
                  {/* Custom Duration Selector (if custom selected) */}
                  {selectedLoanType === 'custom' && (
                    <div className="bg-white/5 rounded-xl p-4 mb-6">
                      <label className="block text-sm text-gray-400 mb-3">Loan Duration</label>
                      <div className="flex gap-2 flex-wrap">
                        {[7, 14, 30, 60, 90].map(d => (
                          <button
                            key={d}
                            onClick={() => setCustomDuration(d)}
                            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                              customDuration === d 
                                ? 'bg-purple-500 text-white' 
                                : 'bg-white/10 text-gray-300 hover:bg-white/20'
                            }`}
                          >
                            {d} days
                          </button>
                        ))}
                      </div>
                      <p className="text-xs text-gray-500 mt-2">
                        Rate: {customDuration <= 7 ? 12 : customDuration <= 14 ? 10 : customDuration <= 30 ? 8 : customDuration <= 60 ? 7 : 6}% APY
                      </p>
                    </div>
                  )}
                  
                  <button
                    onClick={() => setLoanStep(2)}
                    disabled={!selectedLoanType}
                    className="w-full py-4 bg-purple-500 text-white font-bold rounded-xl disabled:opacity-50 disabled:cursor-not-allowed hover:bg-purple-400 transition-all"
                  >
                    Next: Set Amount →
                  </button>
                </div>
              )}
              
              {/* Step 2: Amount & LTV */}
              {loanStep === 2 && (
                <div>
                  <div className="text-center mb-6">
                    <span className="text-sm text-gray-400">Selected: </span>
                    <span className="text-purple-400 font-medium">
                      {LOAN_TYPES.find(t => t.id === selectedLoanType)?.icon} {LOAN_TYPES.find(t => t.id === selectedLoanType)?.name}
                    </span>
                  </div>
                  
                  {/* Borrow Amount */}
                  <div className="mb-6">
                    <label className="block text-sm text-gray-400 mb-2">Borrow Amount (₹)</label>
                    <input
                      type="range"
                      min="100"
                      max="10000"
                      step="100"
                      value={borrowAmount}
                      onChange={(e) => setBorrowAmount(Number(e.target.value))}
                      className="w-full h-2 bg-white/10 rounded-lg appearance-none cursor-pointer accent-purple-500"
                    />
                    <div className="flex justify-between text-xs text-gray-500 mt-1">
                      <span>₹100</span>
                      <span className="text-2xl font-bold text-white">₹{borrowAmount.toLocaleString()}</span>
                      <span>₹10,000</span>
                    </div>
                  </div>
                  
                  {/* LTV Slider */}
                  <div className="mb-6">
                    <label className="block text-sm text-gray-400 mb-2">
                      LTV Ratio (Loan-to-Value) — <span className="text-purple-400 font-bold">{ltvRatio}%</span>
                    </label>
                    <input
                      type="range"
                      min="50"
                      max={calculateLoanDetails().maxLtv}
                      step="5"
                      value={ltvRatio}
                      onChange={(e) => setLtvRatio(Number(e.target.value))}
                      className="w-full h-2 bg-white/10 rounded-lg appearance-none cursor-pointer accent-purple-500"
                    />
                    <div className="flex justify-between text-xs text-gray-500 mt-1">
                      <span>50% (Safer)</span>
                      <span>{calculateLoanDetails().maxLtv}% (Max)</span>
                    </div>
                  </div>
                  
                  {/* Calculated Summary */}
                  <div className="bg-black/40 rounded-xl p-5 mb-6 border border-white/10">
                    <h4 className="font-semibold mb-4 text-gray-300">📊 Loan Preview {loanPreview && <span className="text-xs text-green-400 ml-2">✓ Live</span>}</h4>
                    {(() => {
                      const details = calculateLoanDetails();
                      return (
                        <div className="space-y-3 text-sm">
                          <div className="flex justify-between">
                            <span className="text-gray-400">You Borrow</span>
                            <span className="text-purple-400 font-bold">₹{borrowAmount} ({(details.borrowPas || borrowAmount / pasInrRate).toFixed(4)} PAS)</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-400">Collateral Needed</span>
                            <span className="text-blue-400 font-bold">₹{details.collateralNeeded?.toFixed(0) || 0} ({details.collateralXlm?.toFixed(4) || 0} XLM)</span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-gray-400">Health Factor</span>
                            <HealthFactorBadge factor={details.healthFactor || 1.5} />
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-400">Liquidation if XLM drops</span>
                            <span className="text-orange-400">{details.dropPercent || 0}% (to ₹{details.liquidationPrice?.toFixed(2) || 0})</span>
                          </div>
                          {details.xlmPrice && (
                            <div className="flex justify-between">
                              <span className="text-gray-400">Current XLM Price</span>
                              <span className="text-white">₹{details.xlmPrice.toFixed(2)}</span>
                            </div>
                          )}
                          <div className="border-t border-white/10 pt-3 mt-3">
                            <div className="flex justify-between">
                              <span className="text-gray-400">Duration</span>
                              <span>{details.duration} days</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-400">Interest Rate</span>
                              <span>{details.rate}% APY</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-400">Est. Interest</span>
                              <span className="text-yellow-400">₹{details.interestEstimate?.toFixed(2) || 0}</span>
                            </div>
                            <div className="flex justify-between font-bold mt-2">
                              <span>Total to Repay</span>
                              <span className="text-green-400">₹{(borrowAmount + (details.interestEstimate || 0)).toFixed(2)}</span>
                            </div>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                  
                  <div className="flex gap-4">
                    <button
                      onClick={() => setLoanStep(1)}
                      className="flex-1 py-4 bg-white/10 text-white font-medium rounded-xl hover:bg-white/20 transition-all"
                    >
                      ← Back
                    </button>
                    <button
                      onClick={() => setLoanStep(3)}
                      className="flex-1 py-4 bg-purple-500 text-white font-bold rounded-xl hover:bg-purple-400 transition-all"
                    >
                      Next: Review →
                    </button>
                  </div>
                </div>
              )}
              
              {/* Step 3: Review & Confirm */}
              {loanStep === 3 && (
                <div>
                  <h3 className="text-lg font-semibold mb-4 text-center text-gray-300">Review & Confirm</h3>
                  
                  {(() => {
                    const details = calculateLoanDetails();
                    return (
                      <>
                        {/* Summary Cards */}
                        <div className="grid grid-cols-2 gap-4 mb-6">
                          <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-4 text-center">
                            <p className="text-xs text-gray-400 mb-1">You Provide (Collateral)</p>
                            <p className="text-xl font-bold text-blue-400">{details.collateralXlm?.toFixed(4) || 0} XLM</p>
                            <p className="text-sm text-gray-400">≈ ₹{details.collateralNeeded?.toFixed(0) || 0}</p>
                          </div>
                          <div className="bg-purple-500/10 border border-purple-500/30 rounded-xl p-4 text-center">
                            <p className="text-xs text-gray-400 mb-1">You Receive (Loan)</p>
                            <p className="text-xl font-bold text-purple-400">{(details.borrowPas || borrowAmount / pasInrRate).toFixed(4)} PAS</p>
                            <p className="text-sm text-gray-400">≈ ₹{borrowAmount}</p>
                          </div>
                        </div>
                        
                        {/* Loan Details */}
                        <div className="bg-white/5 rounded-xl p-5 mb-6 border border-white/10">
                          <div className="grid grid-cols-2 gap-4 text-sm">
                            <div>
                              <span className="text-gray-500">Loan Type</span>
                              <p className="font-medium">{LOAN_TYPES.find(t => t.id === selectedLoanType)?.name}</p>
                            </div>
                            <div>
                              <span className="text-gray-500">Duration</span>
                              <p className="font-medium">{details.duration} days</p>
                            </div>
                            <div>
                              <span className="text-gray-500">Interest Rate</span>
                              <p className="font-medium">{details.rate}% APY</p>
                            </div>
                            <div>
                              <span className="text-gray-500">LTV Ratio</span>
                              <p className="font-medium">{ltvRatio}%</p>
                            </div>
                            <div>
                              <span className="text-gray-500">Health Factor</span>
                              <p className="font-medium text-green-400">{details.healthFactor?.toFixed(2) || 0}</p>
                            </div>
                            <div>
                              <span className="text-gray-500">Liquidation Price</span>
                              <p className="font-medium text-orange-400">₹{details.liquidationPrice?.toFixed(2) || 0}/XLM</p>
                            </div>
                          </div>
                          <div className="border-t border-white/10 mt-4 pt-4">
                            <div className="flex justify-between">
                              <span className="text-gray-400">Repayment Deadline</span>
                              <span className="font-medium">{new Date(Date.now() + details.duration * 24 * 60 * 60 * 1000).toLocaleDateString()}</span>
                            </div>
                            <div className="flex justify-between mt-2">
                              <span className="text-gray-400">Total to Repay</span>
                              <span className="font-bold text-lg text-green-400">₹{(borrowAmount + (details.interestEstimate || 0)).toFixed(2)}</span>
                            </div>
                          </div>
                        </div>
                        
                        {/* Terms Warning */}
                        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 mb-6">
                          <p className="text-sm text-red-300 font-medium mb-2">⚠️ Important Terms</p>
                          <ul className="text-xs text-gray-400 space-y-1">
                            <li>• Late fee: {lendingConfig?.lateFeePerDay || 2}% per day after deadline</li>
                            <li>• Force liquidation: {lendingConfig?.maxLateDays || 7} days after deadline</li>
                            <li>• Liquidation penalty: {lendingConfig?.liquidationPenalty || 10}% of debt</li>
                            <li>• Liquidation threshold: {lendingConfig?.liquidationThreshold || 85}% LTV</li>
                          </ul>
                        </div>
                        
                        {/* Accept Terms */}
                        <label className="flex items-start gap-3 mb-6 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={acceptedTerms}
                            onChange={(e) => setAcceptedTerms(e.target.checked)}
                            className="mt-1 w-4 h-4 accent-purple-500"
                          />
                          <span className="text-sm text-gray-400">
                            I understand that my collateral may be liquidated if the health factor drops below 1.0 or if I fail to repay on time.
                          </span>
                        </label>
                      </>
                    );
                  })()}
                  
                  <div className="flex gap-4">
                    <button
                      onClick={() => setLoanStep(2)}
                      disabled={isCreatingLoan}
                      className="flex-1 py-4 bg-white/10 text-white font-medium rounded-xl hover:bg-white/20 transition-all disabled:opacity-50"
                    >
                      ← Back
                    </button>
                    <button
                      disabled={!acceptedTerms || isCreatingLoan}
                      onClick={handleCreateLoan}
                      className="flex-1 py-4 bg-gradient-to-r from-purple-500 to-pink-500 text-white font-bold rounded-xl disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 transition-all"
                    >
                      {isCreatingLoan ? '🔄 Creating Loan...' : '🔒 Lock XLM & Borrow PAS'}
                    </button>
                  </div>
                </div>
              )}
            </motion.div>
          </div>
        )}

        {/* Active Loans Section */}
        {(activeLoans.length > 0 || loansLoading) && (
          <div className="mb-12">
            <div className="flex items-center gap-3 mb-6">
              <h2 className="text-2xl font-bold">Active Loans</h2>
              {loansLoading && <span className="text-sm text-gray-400">Loading...</span>}
              <button 
                onClick={fetchActiveLoans} 
                className="text-sm text-purple-400 hover:text-purple-300 ml-auto"
                disabled={loansLoading}
              >
                🔄 Refresh
              </button>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {activeLoans.map((loan) => {
                const daysRemaining = loan.deadline ? getDaysRemaining(loan.deadline) : null;
                const totalDue = loan.borrowedValueInr + loan.interestAccrued + loan.lateFee;
                const loanTypeInfo = LOAN_TYPES.find(t => t.id === loan.loanType);
                
                return (
                  <div key={loan.id} className="bg-white/5 border border-white/10 rounded-2xl p-6 hover:border-purple-500/30 transition-all">
                    {/* Header */}
                    <div className="flex justify-between items-start mb-4">
                      <div>
                        <h3 className="font-bold text-lg">Loan #{String(loan.id).slice(-6)}</h3>
                        <p className="text-xs text-gray-500">
                          {loanTypeInfo?.icon || '📄'} {loanTypeInfo?.name || loan.loanType || 'Standard'} • {loan.duration}d
                        </p>
                      </div>
                      <HealthFactorBadge factor={loan.healthFactor || 1} />
                    </div>
                    
                    {/* Collateral & Debt */}
                    <div className="grid grid-cols-2 gap-3 mb-4">
                      <div className="bg-blue-500/10 rounded-xl p-3">
                        <p className="text-xs text-gray-400">Collateral</p>
                        <p className="font-bold text-blue-400">{loan.collateralXlm?.toFixed(4) || 0} XLM</p>
                        <p className="text-xs text-gray-500">≈ ₹{loan.collateralValueInr?.toFixed(0) || 0}</p>
                      </div>
                      <div className="bg-purple-500/10 rounded-xl p-3">
                        <p className="text-xs text-gray-400">Borrowed</p>
                        <p className="font-bold text-purple-400">{loan.borrowedPas?.toFixed(4) || 0} PAS</p>
                        <p className="text-xs text-gray-500">≈ ₹{loan.borrowedValueInr?.toFixed(0) || 0}</p>
                      </div>
                    </div>
                    
                    {/* Amount Breakdown */}
                    <div className="bg-black/30 rounded-xl p-4 mb-4 text-sm">
                      <div className="flex justify-between mb-1">
                        <span className="text-gray-400">Principal</span>
                        <span>₹{loan.borrowedValueInr}</span>
                      </div>
                      <div className="flex justify-between mb-1">
                        <span className="text-gray-400">Interest ({loan.interestRate}% APY)</span>
                        <span className="text-yellow-400">₹{loan.interestAccrued?.toFixed(2) || 0}</span>
                      </div>
                      {loan.lateFee > 0 && (
                        <div className="flex justify-between mb-1">
                          <span className="text-red-400">Late Fee</span>
                          <span className="text-red-400">₹{loan.lateFee?.toFixed(2) || 0}</span>
                        </div>
                      )}
                      <div className="border-t border-white/10 pt-2 mt-2 flex justify-between font-bold">
                        <span>Total Due</span>
                        <span className="text-green-400">₹{totalDue?.toFixed(2) || 0}</span>
                      </div>
                    </div>
                    
                    {/* Deadline Status */}
                    {loan.deadline && (
                      <div className={`rounded-xl p-3 mb-4 text-sm ${
                        daysRemaining < 0 
                          ? 'bg-red-500/20 border border-red-500/30' 
                          : daysRemaining <= 3 
                            ? 'bg-orange-500/20 border border-orange-500/30'
                            : 'bg-white/5 border border-white/10'
                      }`}>
                        <div className="flex justify-between items-center">
                          <span className="text-gray-400">⏰ Deadline</span>
                          <span className={`font-medium ${daysRemaining < 0 ? 'text-red-400' : daysRemaining <= 3 ? 'text-orange-400' : 'text-white'}`}>
                            {loan.deadline.toLocaleDateString()}
                          </span>
                        </div>
                        <div className="flex justify-between items-center mt-1">
                          <span className="text-gray-400">Status</span>
                          <span className={`font-bold ${daysRemaining < 0 ? 'text-red-400' : daysRemaining <= 3 ? 'text-orange-400' : 'text-green-400'}`}>
                            {daysRemaining < 0 
                              ? `🔴 ${Math.abs(daysRemaining)} days OVERDUE` 
                              : daysRemaining <= 3 
                                ? `🟠 ${daysRemaining} days left - ACT NOW`
                                : `🟢 ${daysRemaining} days remaining`
                            }
                          </span>
                        </div>
                      </div>
                    )}
                    
                    {/* Liquidation Warning */}
                    {loan.healthFactor && loan.healthFactor < 1.2 && (
                      <div className="bg-red-500/20 border border-red-500/30 rounded-xl p-3 mb-4 text-sm">
                        <p className="text-red-400 font-bold">⚠️ Liquidation Risk</p>
                        <p className="text-xs text-gray-300">
                          XLM must stay above ₹{loan.liquidationPrice?.toFixed(2) || 0} to avoid liquidation.
                        </p>
                      </div>
                    )}
                    
                    {/* Actions */}
                    <div className="flex gap-3">
                      <button 
                        onClick={() => handleRepayLoan(loan)}
                        disabled={repayingLoanId === loan.id}
                        className="flex-1 py-3 bg-green-500 text-black font-bold rounded-xl hover:bg-green-400 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {repayingLoanId === loan.id ? 'Sending PAS...' : `Repay ${(totalDue / pasInrRate).toFixed(2)} PAS`}
                      </button>
                      <button 
                        onClick={() => openCollateralModal(loan)}
                        disabled={addingCollateralLoanId === loan.id}
                        className="flex-1 py-3 bg-blue-500/20 border border-blue-500/30 text-blue-400 font-medium rounded-xl hover:bg-blue-500/30 transition-all disabled:opacity-50"
                      >
                        + Collateral
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Original Action Section - Add Funds & Buy PAS */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-12">
            <div className="p-8 rounded-2xl bg-white/5 border border-white/10 hover:border-green-500/20 transition-all">
                <h3 className="text-xl font-bold mb-4">Add Funds</h3>
                <p className="text-gray-400 text-sm mb-6">
                    Add INR to your wallet instantly using Razorpay. Use this balance to buy PAS tokens.
                </p>
                <div className="flex gap-4">
                     <button 
                       onClick={() => handlePayment(100)} 
                       className="flex-1 py-3 bg-green-500 text-black font-bold rounded-xl hover:bg-green-400 transition-colors shadow-lg shadow-green-900/20"
                       disabled={!isConnected}
                     >
                        + ₹100
                     </button>
                     <button 
                       onClick={() => handlePayment(500)} 
                       className="flex-1 py-3 bg-green-500 text-black font-bold rounded-xl hover:bg-green-400 transition-colors shadow-lg shadow-green-900/20"
                       disabled={!isConnected}
                     >
                        + ₹500
                     </button>
                     <button 
                       onClick={() => handlePayment(1000)} 
                       className="flex-1 py-3 bg-green-500 text-black font-bold rounded-xl hover:bg-green-400 transition-colors shadow-lg shadow-green-900/20"
                       disabled={!isConnected}
                     >
                        + ₹1000
                     </button>
                </div>
            </div>

            <div className="p-8 rounded-2xl bg-white/5 border border-white/10 hover:border-purple-500/20 transition-all">
                <h3 className="text-xl font-bold mb-4">Buy PAS Tokens</h3>
                <p className="text-gray-400 text-sm mb-4">
                   Convert your INR balance to PAS tokens on Paseo Asset Hub.
                   <span className="text-purple-400 font-bold ml-1">1 PAS = ₹{pasInrRate}</span>
                </p>
                <div className="mb-4">
                  <div className="flex items-center gap-2 mb-2">
                    <input
                      type="number"
                      value={stakeAmount}
                      onChange={(e) => setStakeAmount(e.target.value)}
                      placeholder="Amount in INR"
                      className="flex-1 px-4 py-3 bg-black/50 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-purple-500"
                    />
                  </div>
                  {stakeAmount && parseFloat(stakeAmount) > 0 && (
                    <p className="text-sm text-gray-400">
                      You'll receive: <span className="text-purple-400 font-bold">{(parseFloat(stakeAmount) / pasInrRate).toFixed(4)} PAS</span>
                    </p>
                  )}
                </div>
                <div className="flex gap-4">
                     <button 
                       onClick={handleStake}
                       disabled={!isConnected || isStaking || !stakeAmount}
                       className="flex-1 py-3 bg-purple-500 text-white font-bold rounded-xl hover:bg-purple-400 transition-colors shadow-lg shadow-purple-900/20 disabled:opacity-50 disabled:cursor-not-allowed"
                     >
                        {isStaking ? 'Processing...' : 'Buy PAS'}
                     </button>
                </div>
            </div>
        </div>

        {/* Active Stakes/Purchases History */}
        {stakes.length > 0 && (
          <div className="mb-12">
            <h2 className="text-2xl font-bold mb-6">Purchase History</h2>
            <div className="overflow-x-auto bg-white/5 rounded-2xl border border-white/10">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-white/10">
                    <th className="p-4 text-gray-400 font-medium">Amount INR</th>
                    <th className="p-4 text-gray-400 font-medium">PAS Tokens</th>
                    <th className="p-4 text-gray-400 font-medium">Rate</th>
                    <th className="p-4 text-gray-400 font-medium">Current Value</th>
                    <th className="p-4 text-gray-400 font-medium">Status</th>
                    <th className="p-4 text-gray-400 font-medium">Date</th>
                    <th className="p-4 text-gray-400 font-medium">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {stakes.map((stake) => {
                    const currentValue = parseFloat(stake.amount_pas) * pasInrRate;
                    const originalValue = parseFloat(stake.amount_inr);
                    const pnl = currentValue - originalValue;
                    const pnlPercent = ((pnl / originalValue) * 100).toFixed(1);
                    
                    return (
                      <tr key={stake.id} className="border-b border-white/5 hover:bg-white/5">
                        <td className="p-4">₹{parseFloat(stake.amount_inr).toLocaleString()}</td>
                        <td className="p-4 text-purple-400">{parseFloat(stake.amount_pas).toFixed(4)} PAS</td>
                        <td className="p-4 text-gray-400">₹{stake.exchange_rate}</td>
                        <td className="p-4">
                          <span className="text-white">₹{currentValue.toFixed(2)}</span>
                          <span className={`ml-2 text-xs ${pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {pnl >= 0 ? '+' : ''}{pnlPercent}%
                          </span>
                        </td>
                        <td className="p-4">
                          <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                            stake.status === 'completed' ? 'bg-green-500/20 text-green-400' :
                            stake.status === 'locked' ? 'bg-blue-500/20 text-blue-400' :
                            stake.status === 'pending' ? 'bg-yellow-500/20 text-yellow-400' :
                            stake.status === 'paid_back' ? 'bg-purple-500/20 text-purple-400' :
                            'bg-gray-500/20 text-gray-400'
                          }`}>
                            {stake.status}
                          </span>
                        </td>
                        <td className="p-4 text-gray-400">{new Date(stake.created_at).toLocaleDateString()}</td>
                        <td className="p-4">
                          {(stake.status === 'completed' || stake.status === 'locked') && (
                            <button
                              onClick={() => handlePayback(stake)}
                              disabled={payingBackStakeId === stake.id || parseFloat(stake.amount_pas) > parseFloat(realPasBalance)}
                              className="px-4 py-2 bg-orange-500 text-white text-sm font-bold rounded-lg hover:bg-orange-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                              title={parseFloat(stake.amount_pas) > parseFloat(realPasBalance) ? `Insufficient PAS balance (need ${parseFloat(stake.amount_pas).toFixed(4)} PAS)` : `Sell for ₹${currentValue.toFixed(2)}`}
                            >
                              {payingBackStakeId === stake.id ? 'Selling...' : `Sell for ₹${currentValue.toFixed(0)}`}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>

      {/* Add Collateral Modal */}
      {showCollateralModal && selectedLoanForCollateral && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <motion.div 
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-gray-900 border border-white/10 rounded-2xl p-6 max-w-md w-full"
          >
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold">Add Collateral</h2>
              <button 
                onClick={() => setShowCollateralModal(false)}
                className="text-gray-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            {/* Current Loan Info */}
            <div className="bg-white/5 rounded-xl p-4 mb-4">
              <div className="flex justify-between mb-2">
                <span className="text-gray-400">Current Collateral</span>
                <span className="font-bold">{selectedLoanForCollateral.collateralXlm?.toFixed(4)} XLM</span>
              </div>
              <div className="flex justify-between mb-2">
                <span className="text-gray-400">Current Health Factor</span>
                <HealthFactorBadge factor={selectedLoanForCollateral.healthFactor || 0} />
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Borrowed</span>
                <span className="text-purple-400">₹{selectedLoanForCollateral.borrowedValueInr?.toFixed(0)}</span>
              </div>
            </div>

            {/* Input */}
            <div className="mb-4">
              <label className="block text-sm text-gray-400 mb-2">Additional XLM to Lock</label>
              <input
                type="number"
                value={additionalCollateral}
                onChange={(e) => setAdditionalCollateral(e.target.value)}
                placeholder="Enter XLM amount"
                className="w-full px-4 py-3 bg-black/50 border border-white/10 rounded-xl focus:border-blue-500 focus:outline-none"
              />
            </div>

            {/* Preview */}
            {additionalCollateral && parseFloat(additionalCollateral) > 0 && (
              <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-4 mb-4">
                <h4 className="text-sm font-bold text-blue-400 mb-2">Preview After Adding</h4>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">New Total Collateral</span>
                  <span>{(selectedLoanForCollateral.collateralXlm + parseFloat(additionalCollateral)).toFixed(4)} XLM</span>
                </div>
                <div className="flex justify-between text-sm mt-1">
                  <span className="text-gray-400">Estimated Health Factor</span>
                  <span className="text-green-400">
                    ~{(((selectedLoanForCollateral.collateralXlm + parseFloat(additionalCollateral)) * (selectedLoanForCollateral.xlmPrice || 18)) * 0.85 / selectedLoanForCollateral.borrowedValueInr).toFixed(2)}
                  </span>
                </div>
              </div>
            )}

            {/* Info */}
            <p className="text-xs text-gray-500 mb-4">
              💡 Adding collateral improves your health factor and reduces liquidation risk. You'll need to lock additional XLM in the vault.
            </p>

            {/* Actions */}
            <div className="flex gap-3">
              <button
                onClick={() => setShowCollateralModal(false)}
                className="flex-1 py-3 bg-white/5 border border-white/10 rounded-xl hover:bg-white/10 transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleAddCollateral}
                disabled={!additionalCollateral || parseFloat(additionalCollateral) <= 0 || addingCollateralLoanId}
                className="flex-1 py-3 bg-blue-500 text-white font-bold rounded-xl hover:bg-blue-400 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {addingCollateralLoanId ? 'Adding...' : 'Add Collateral'}
              </button>
            </div>
          </motion.div>
        </div>
      )}

      <NotificationModal 
        isOpen={isNotifOpen} 
        onClose={() => setIsNotifOpen(false)} 
        notifications={notifications}
      />

    </div>
  );
};

export default Dashboard;
