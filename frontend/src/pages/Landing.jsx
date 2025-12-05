import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import BridgeAnimation from '../components/BridgeAnimation';
import InteractiveBackground from '../components/InteractiveBackground';

const Landing = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-black text-white selection:bg-green-500 selection:text-black overflow-hidden relative font-mono">
      
      {/* Interactive Background */}
      <InteractiveBackground />

      {/* Background Elements (Gradient Blobs) - kept for extra depth, slightly adjusting z-index if needed */}
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none z-0">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-green-900/10 rounded-full blur-[120px] animate-pulse" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-green-900/05 rounded-full blur-[120px] animate-pulse delay-1000" />
      </div>

      {/* Navbar */}
      <nav className="relative z-20 container mx-auto px-6 py-6 flex justify-between items-center">
        <div className="text-2xl font-bold tracking-tighter flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-green-600 to-green-400" />
          Polar
        </div>
            </nav>

      {/* Hero Section */}
      <main className="relative z-20 container mx-auto px-6 flex flex-col items-center justify-center min-h-[80vh] text-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
          className="max-w-5xl mx-auto w-full"
        >
          <div className="inline-block px-3 py-1 mb-6  border border-green-500/40 rounded-full bg-green-900/10 text-green-400 text-xs font-semibold tracking-wide uppercase shadow-[0_0_10px_rgba(0,255,140,0.3)]
hover:shadow-[0_0_15px_rgba(0,255,140,0.5)]
">
            Bridge the Gap
          </div>
          
          <h1 className="text-6xl md:text-5xl font-black tracking-tight leading-tight mb-8 bg-gradient-to-b from-white to-gray-400 bg-clip-text text-transparent">
            Global Liquidity in <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-green-400 to-green-600">Indian Rupee</span>
          </h1>

                    <p className="text-lg md:text-xl text-gray-400 max-w-2xl mx-auto mb-12 leading-relaxed">
             Seamlessly bridge assets and unlock instant liquidity in INR with our secure, decentralized cross-chain protocol.
          </p>

          <motion.div 
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.2, duration: 0.5 }}
            className="flex flex-col sm:flex-row gap-4 justify-center items-center"
          >
            <button 
              onClick={() => navigate('/dashboard')}
              className="px-4 py-2 bg-black text-white text-lg font-medium rounded-lg cursor-pointer transform hover:scale-105 transition-all shadow-[0_0_25px_4px_rgba(16,255,140,0.3)]"
            >
              Launch App
            </button>

          </motion.div>
          
          {/* Replaced static text with Bridge Animation */}
          <div >
            <BridgeAnimation />
          </div>


        </motion.div>
      </main>
       </div>
  );
};

export default Landing;
