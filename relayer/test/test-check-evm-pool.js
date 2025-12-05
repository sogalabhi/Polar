/**
 * TEST: Check EVM Pool Balance
 * 
 * This script checks the PAS balance in the EVM pool contract.
 * 
 * Usage: node test/test-check-evm-pool.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { ethers } = require('ethers');

// Configuration
const CONFIG = {
    EVM_RPC_URL: process.env.EVM_RPC_URL || 'https://testnet-passet-hub-eth-rpc.polkadot.io',
    EVM_POOL_ADDRESS: process.env.EVM_POOL_ADDRESS || '0x49e12e876588052A977dB816107B1772B4103E3e',
    EVM_PRIVATE_KEY: process.env.EVM_RELAYER_PRIVATE_KEY,
    EVM_EXPLORER_URL: 'https://blockscout-passet-hub.parity-testnet.parity.io',
};

// Pool Contract ABI (minimal)
const POOL_ABI = [
    "function getBalance() external view returns (uint256)",
    "function admin() external view returns (address)"
];

async function checkEvmPool() {
    console.log('\n📊 ═══════════════════════════════════════════');
    console.log('   TEST: Check EVM Pool Balance');
    console.log('═══════════════════════════════════════════════\n');
    
    const provider = new ethers.JsonRpcProvider(CONFIG.EVM_RPC_URL);
    const poolContract = new ethers.Contract(CONFIG.EVM_POOL_ADDRESS, POOL_ABI, provider);
    
    console.log(`📋 Configuration:`);
    console.log(`   Pool Contract: ${CONFIG.EVM_POOL_ADDRESS}`);
    console.log(`   Network: Paseo Asset Hub (Chain ID: 420420422)`);
    console.log('');
    
    try {
        // Check pool balance
        console.log('📡 Querying pool balance...');
        const poolBalance = await poolContract.getBalance();
        
        // Check admin
        const admin = await poolContract.admin();
        
        console.log('\n✅ ═══════════════════════════════════════════');
        console.log('   EVM POOL STATUS');
        console.log('═══════════════════════════════════════════════');
        console.log(`   Pool Balance: ${ethers.formatEther(poolBalance)} PAS`);
        console.log(`   Admin: ${admin}`);
        console.log('');
        console.log(`   🔗 View on Explorer:`);
        console.log(`   ${CONFIG.EVM_EXPLORER_URL}/address/${CONFIG.EVM_POOL_ADDRESS}`);
        console.log('');
        
        // Check admin wallet balance if private key is set
        if (CONFIG.EVM_PRIVATE_KEY) {
            const wallet = new ethers.Wallet(CONFIG.EVM_PRIVATE_KEY, provider);
            const adminBalance = await provider.getBalance(wallet.address);
            console.log(`   Admin Wallet Balance: ${ethers.formatEther(adminBalance)} PAS`);
            console.log('');
        }
        
    } catch (error) {
        console.error('\n❌ Error:', error.message);
        process.exit(1);
    }
}

checkEvmPool();
