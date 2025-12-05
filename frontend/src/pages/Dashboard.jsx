import React, { useState } from 'react';
import { useRazorpay } from 'react-razorpay';
import { motion } from 'framer-motion';
import InteractiveBackground from '../components/InteractiveBackground';
import StatCard from '../components/StatCard';
import NotificationModal from '../components/NotificationModal';

const Dashboard = () => {
  const { Razorpay } = useRazorpay();
  const [isNotifOpen, setIsNotifOpen] = useState(false);
  
  // Mock Data - In a real app, this comes from context/API
  const [stats, setStats] = useState({
    walletBalance: '₹ 1,45,000',
    stakedAmount: '₹ 50,000',
    borrowedDot: '142.5 DOT',
    exchangeRate: '1 DOT = ₹ 580.45',
  });

  const [notifications, setNotifications] = useState([
    { title: 'Loan Disbursed', message: 'You borrowed 50 DOT against your staked INR.', time: '2 mins ago', type: 'success' },
    { title: 'Funds Added', message: '₹ 20,000 added to your wallet via Razorpay.', time: '1 hour ago', type: 'success' },
    { title: 'Rate Update', message: 'Exchange rate updated to ₹ 580.45', time: '5 hours ago', type: 'info' },
  ]);

  const handlePayment = async () => {
    try {
      const response = await fetch('http://localhost:3000/create-order', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          amount: 500, // Example amount
          currency: 'INR',
        }),
      });

      const order = await response.json();

      const options = {
        key: import.meta.env.VITE_RAZORPAY_KEY_ID, 
        amount: order.amount,
        currency: order.currency,
        name: 'Polar Liquidity',
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
                setNotifications(prev => [{
                   title: 'Payment Successful', 
                   message: `Payment Verified. ID: ${response.razorpay_payment_id}`, 
                   time: 'Just now', 
                   type: 'success' 
                }, ...prev]);
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

  return (
    <div className="min-h-screen bg-black text-white font-mono relative overflow-hidden selection:bg-green-500 selection:text-black">
      <InteractiveBackground />
      
      {/* Navbar */}
      <nav className="relative z-20 container mx-auto px-6 py-4 flex justify-between items-center border-b border-white/10 bg-black/50 backdrop-blur-md">
        <div className="text-xl font-bold tracking-tighter flex items-center gap-2">
          <div className="w-6 h-6 rounded-full bg-gradient-to-tr from-green-600 to-green-400" />
          Polar <span className="text-xs text-gray-500 font-normal ml-2">Dashboard</span>
        </div>
        
        <div className="flex items-center gap-4">
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
           
           <div className="w-8 h-8 rounded-full bg-gray-800 border border-white/10 flex items-center justify-center text-xs font-bold text-green-400">
             U
           </div>
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
                value={stats.walletBalance} 
                icon={<svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M4 4a2 2 0 00-2 2v4a2 2 0 002 2V6h10a2 2 0 00-2-2H4zm2 6a2 2 0 012-2h8a2 2 0 012 2v4a2 2 0 01-2 2H8a2 2 0 01-2-2v-4zm6 4a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" /></svg>}
                trend="+15.8%"
            />
            <StatCard 
                title="Staked Amount" 
                value={stats.stakedAmount} 
                icon={<svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" /></svg>}
                subValue="Locked"
            />
             <StatCard 
                title="Borrowed Tokens" 
                value={stats.borrowedDot} 
                icon={<svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 2a4 4 0 00-4 4v1H5a1 1 0 00-.994.89l-1 9A1 1 0 004 18h12a1 1 0 00.994-1.11l-1-9A1 1 0 0015 7h-1V6a4 4 0 00-4-4zm2 5V6a2 2 0 10-4 0v1h4zm-6 3a1 1 0 112 0 1 1 0 01-2 0zm7-1a1 1 0 100 2 1 1 0 000-2z" clipRule="evenodd" /></svg>}
                subValue="Via Polkadot"
            />
            <StatCard 
                title="Live Rate" 
                value={stats.exchangeRate} 
                icon={<svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M12 7a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0V8.414l-4.293 4.293a1 1 0 01-1.414 0L8 10.414l-4.293 4.293a1 1 0 01-1.414-1.414l5-5a1 1 0 011.414 0L11 10.586 14.586 7H12z" clipRule="evenodd" /></svg>}
                trend="+2.1%"
            />
        </div>

        {/* Action Section */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="p-8 rounded-2xl bg-white/5 border border-white/10 hover:border-green-500/20 transition-all">
                <h3 className="text-xl font-bold mb-4">Quick Liquidity</h3>
                <p className="text-gray-400 text-sm mb-6">
                    Add INR to your wallet instantly using Razorpay. Staking will secure your collateral on the Stellar network.
                </p>
                <div className="flex gap-4">
                     <button onClick={handlePayment} className="flex-1 py-3 bg-green-500 text-black font-bold rounded-xl hover:bg-green-400 transition-colors shadow-lg shadow-green-900/20">
                        Add Funds
                     </button>
                      <button className="flex-1 py-3 bg-white/5 text-white font-bold rounded-xl hover:bg-white/10 transition-colors">
                        Withdraw
                     </button>
                </div>
            </div>

            <div className="p-8 rounded-2xl bg-white/5 border border-white/10 hover:border-blue-500/20 transition-all">
                <h3 className="text-xl font-bold mb-4">Bridge & Borrow</h3>
                <p className="text-gray-400 text-sm mb-6">
                   Lock your INR to mint credit lines on Polkadot. 
                   Current LTV: <span className="text-green-400 font-bold">75%</span>
                </p>
                <div className="flex gap-4">
                     <button className="flex-1 py-3 bg-blue-500 text-white font-bold rounded-xl hover:bg-blue-400 transition-colors shadow-lg shadow-blue-900/20">
                        Borrow DOT
                     </button>
                      <button className="flex-1 py-3 bg-white/5 text-white font-bold rounded-xl hover:bg-white/10 transition-colors">
                        Repay Loan
                     </button>
                </div>
            </div>
        </div>
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
