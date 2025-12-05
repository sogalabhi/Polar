/**
 * TEST: Release DEV on EVM (Moonbase Alpha)
 * 
 * This script manually releases DEV from the EVM pool to a specified address.
 * Useful for testing the EVM side without relying on Stellar events.
 * 
 * Usage: node test/test-release-dev.js <amount_dev> <to_address>
 * Example: node test/test-release-dev.js 0.1 0xYourMetaMaskAddress
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { ethers } = require('ethers');

// Configuration
const CONFIG = {
    MOONBASE_RPC_URL: process.env.MOONBASE_RPC_URL || 'https://rpc.api.moonbase.moonbeam.network',
    EVM_POOL_ADDRESS: process.env.EVM_POOL_ADDRESS || '0x1Df2Cc6129568a62379f232087F20f5Bc4E37cE6',
    EVM_PRIVATE_KEY: process.env.EVM_RELAYER_PRIVATE_KEY,
};

// Pool Contract ABI (minimal)
const POOL_ABI = [
    "function releaseLiquidity(address payable to, uint256 amount) external",
    "function getBalance() external view returns (uint256)",
    "function admin() external view returns (address)"
];

async function releaseDev(amount, toAddress) {
    console.log('\n💸 ═══════════════════════════════════════════');
    console.log('   TEST: Release DEV on Moonbase Alpha');
    console.log('═══════════════════════════════════════════════\n');
    
    if (!CONFIG.EVM_PRIVATE_KEY) {
        console.error('❌ Error: EVM_RELAYER_PRIVATE_KEY not set in .env');
        process.exit(1);
    }
    
    if (!ethers.isAddress(toAddress)) {
        console.error('❌ Error: Invalid EVM address');
        process.exit(1);
    }
    
    const provider = new ethers.JsonRpcProvider(CONFIG.MOONBASE_RPC_URL);
    const wallet = new ethers.Wallet(CONFIG.EVM_PRIVATE_KEY, provider);
    const poolContract = new ethers.Contract(CONFIG.EVM_POOL_ADDRESS, POOL_ABI, wallet);
    
    console.log(`📋 Configuration:`);
    console.log(`   Pool Contract: ${CONFIG.EVM_POOL_ADDRESS}`);
    console.log(`   Admin: ${wallet.address}`);
    console.log(`   Amount: ${amount} DEV`);
    console.log(`   To: ${toAddress}`);
    console.log('');
    
    try {
        // Check pool balance
        console.log('📊 Checking pool balance...');
        const poolBalance = await poolContract.getBalance();
        console.log(`   Pool Balance: ${ethers.formatEther(poolBalance)} DEV`);
        
        const amountWei = ethers.parseEther(amount.toString());
        
        if (poolBalance < amountWei) {
            console.error(`\n❌ Error: Insufficient pool balance`);
            console.error(`   Requested: ${amount} DEV`);
            console.error(`   Available: ${ethers.formatEther(poolBalance)} DEV`);
            process.exit(1);
        }
        
        // Check admin
        console.log('🔑 Verifying admin...');
        const admin = await poolContract.admin();
        console.log(`   Contract Admin: ${admin}`);
        
        if (admin.toLowerCase() !== wallet.address.toLowerCase()) {
            console.error(`\n❌ Error: Not the admin`);
            console.error(`   Contract Admin: ${admin}`);
            console.error(`   Your Address: ${wallet.address}`);
            process.exit(1);
        }
        
        // Release liquidity
        console.log('\n📤 Sending transaction...');
        const tx = await poolContract.releaseLiquidity(toAddress, amountWei);
        console.log(`   TX Hash: ${tx.hash}`);
        
        console.log('⏳ Waiting for confirmation...');
        const receipt = await tx.wait();
        
        console.log('\n✅ ═══════════════════════════════════════════');
        console.log('   DEV RELEASED SUCCESSFULLY!');
        console.log('═══════════════════════════════════════════════');
        console.log(`   TX Hash: ${tx.hash}`);
        console.log(`   Block: ${receipt.blockNumber}`);
        console.log(`   Amount: ${amount} DEV`);
        console.log(`   To: ${toAddress}`);
        console.log('');
        console.log(`   🔗 View on Explorer:`);
        console.log(`   https://moonbase.moonscan.io/tx/${tx.hash}`);
        console.log('');
        
        // Check new pool balance
        const newBalance = await poolContract.getBalance();
        console.log(`   New Pool Balance: ${ethers.formatEther(newBalance)} DEV`);
        console.log('');
        
    } catch (error) {
        console.error('\n❌ Error:', error.message);
        process.exit(1);
    }
}

// Parse command line arguments
const args = process.argv.slice(2);
const amount = parseFloat(args[0]) || 0.01;
const toAddress = args[1] || '0x0000000000000000000000000000000000000000';

if (args.length < 2) {
    console.log('\n📖 Usage: node test/test-release-dev.js <amount_dev> <to_address>');
    console.log('   Example: node test/test-release-dev.js 0.1 0xYourMetaMaskAddress\n');
    process.exit(1);
}

releaseDev(amount, toAddress);
