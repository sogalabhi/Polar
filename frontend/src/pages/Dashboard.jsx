import React, { useState, useEffect } from 'react';
import { useRazorpay } from 'react-razorpay';
import { motion } from 'framer-motion';
import InteractiveBackground from '../components/InteractiveBackground';
import StatCard from '../components/StatCard';
import NotificationModal from '../components/NotificationModal';
import { useWallet } from '../hooks/useWallet';
import { addFunds, createStake } from '../lib/supabase';

// PAS/INR Exchange Rate (you can fetch this from an API)
const PAS_INR_RATE = 85; // 1 PAS = ₹85

const Dashboard = () => {
  const { Razorpay } = useRazorpay();
  const [isNotifOpen, setIsNotifOpen] = useState(false);
  const [stakeAmount, setStakeAmount] = useState('');
  const [isStaking, setIsStaking] = useState(false);
  
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
    isLoading 
  } = useWallet();

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

    setIsStaking(true);
    try {
      const amountPas = amountInr / PAS_INR_RATE;
      const result = await createStake(address, amountInr, amountPas, PAS_INR_RATE);
      
      if (result.success) {
        setNotifications(prev => [{
          title: 'Stake Created!',
          message: `Staked ₹${amountInr} for ${amountPas.toFixed(4)} PAS`,
          time: 'Just now',
          type: 'success'
        }, ...prev]);
        setStakeAmount('');
        await refresh();
      } else {
        alert(result.error || 'Stake failed');
      }
    } catch (error) {
      console.error('Stake error:', error);
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
               <span className="text-sm font-medium text-purple-300">
                 {totalStakedPas.toFixed(2)} <span className="text-purple-400/70">PAS</span>
               </span>
             </div>
           )}

           {/* INR Balance Display */}
           {isConnected && (
             <div className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-green-500/10 to-emerald-500/10 border border-green-500/30 rounded-xl">
               <span className="text-sm font-medium text-green-300">
                 ₹{balance.toFixed(2)}
               </span>
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
            <p className="text-gray-400 text-sm">Manage your liquidity and active loans.</p>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-12">
            <StatCard 
                title="Available INR" 
                value={`₹ ${balance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`}
                icon={<svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M4 4a2 2 0 00-2 2v4a2 2 0 002 2V6h10a2 2 0 00-2-2H4zm2 6a2 2 0 012-2h8a2 2 0 012 2v4a2 2 0 01-2 2H8a2 2 0 01-2-2v-4zm6 4a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" /></svg>}
                subValue="Wallet Balance"
            />
            <StatCard 
                title="Staked INR" 
                value={`₹ ${totalStakedInr.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`}
                icon={<svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" /></svg>}
                subValue="Locked"
            />
             <StatCard 
                title="PAS Tokens" 
                value={`${totalStakedPas.toFixed(4)} PAS`}
                icon={<svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 2a4 4 0 00-4 4v1H5a1 1 0 00-.994.89l-1 9A1 1 0 004 18h12a1 1 0 00.994-1.11l-1-9A1 1 0 0015 7h-1V6a4 4 0 00-4-4zm2 5V6a2 2 0 10-4 0v1h4zm-6 3a1 1 0 112 0 1 1 0 01-2 0zm7-1a1 1 0 100 2 1 1 0 000-2z" clipRule="evenodd" /></svg>}
                subValue="On Paseo Asset Hub"
            />
            <StatCard 
                title="Exchange Rate" 
                value={`1 PAS = ₹${PAS_INR_RATE}`}
                icon={<svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M12 7a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0V8.414l-4.293 4.293a1 1 0 01-1.414 0L8 10.414l-4.293 4.293a1 1 0 01-1.414-1.414l5-5a1 1 0 011.414 0L11 10.586 14.586 7H12z" clipRule="evenodd" /></svg>}
                subValue="Live"
            />
        </div>

        {/* Action Section */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
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
                   <span className="text-purple-400 font-bold ml-1">1 PAS = ₹{PAS_INR_RATE}</span>
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
                      You'll receive: <span className="text-purple-400 font-bold">{(parseFloat(stakeAmount) / PAS_INR_RATE).toFixed(4)} PAS</span>
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

        {/* Active Stakes Section */}
        {stakes.length > 0 && (
          <div className="mt-12">
            <h2 className="text-2xl font-bold mb-6">Your Stakes</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-white/10">
                    <th className="pb-4 text-gray-400 font-medium">Amount INR</th>
                    <th className="pb-4 text-gray-400 font-medium">PAS Tokens</th>
                    <th className="pb-4 text-gray-400 font-medium">Rate</th>
                    <th className="pb-4 text-gray-400 font-medium">Status</th>
                    <th className="pb-4 text-gray-400 font-medium">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {stakes.map((stake) => (
                    <tr key={stake.id} className="border-b border-white/5 hover:bg-white/5">
                      <td className="py-4">₹{parseFloat(stake.amount_inr).toLocaleString()}</td>
                      <td className="py-4 text-purple-400">{parseFloat(stake.amount_pas).toFixed(4)} PAS</td>
                      <td className="py-4 text-gray-400">₹{stake.exchange_rate}</td>
                      <td className="py-4">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                          stake.status === 'completed' ? 'bg-green-500/20 text-green-400' :
                          stake.status === 'pending' ? 'bg-yellow-500/20 text-yellow-400' :
                          'bg-gray-500/20 text-gray-400'
                        }`}>
                          {stake.status}
                        </span>
                      </td>
                      <td className="py-4 text-gray-400">{new Date(stake.created_at).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>

      <NotificationModal 
        isOpen={isNotifOpen} 
        onClose={() => setIsNotifOpen(false)} 
        notifications={notifications}
      />

    </div>
  );
};

export default Dashboard;
