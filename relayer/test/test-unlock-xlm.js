/**
 * TEST: Unlock/Release XLM from Stellar Vault
 * 
 * This script releases XLM from the vault back to a Stellar address.
 * Only the admin (relayer) can call this function.
 * 
 * Usage: node test/test-unlock-xlm.js <amount_xlm> [stellar_address]
 * Example: node test/test-unlock-xlm.js 0.1
 * Example: node test/test-unlock-xlm.js 0.1 GABC...XYZ
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const StellarSdk = require('@stellar/stellar-sdk');

const { 
    rpc, 
    Keypair, 
    TransactionBuilder, 
    Networks, 
    Contract,
    nativeToScVal,
    Address
} = StellarSdk;

// Configuration
const CONFIG = {
    STELLAR_RPC_URL: process.env.STELLAR_RPC_URL || 'https://soroban-testnet.stellar.org',
    VAULT_CONTRACT_ID: process.env.VAULT_CONTRACT_ID || 'CDI75PQ4EA2VBTT7W6EZN2RGJIS4CFDMGT7WJ4L42T4ZSTNEKY42NY2B',
    STELLAR_SECRET: process.env.STELLAR_RELAYER_SECRET,
};

async function unlockXlm(amountXlm, destinationAddress) {
    console.log('\n🔓 ═══════════════════════════════════════════');
    console.log('   TEST: Unlock XLM from Stellar Vault');
    console.log('═══════════════════════════════════════════════\n');
    
    if (!CONFIG.STELLAR_SECRET) {
        console.error('❌ Error: STELLAR_RELAYER_SECRET not set in .env');
        process.exit(1);
    }
    
    const server = new rpc.Server(CONFIG.STELLAR_RPC_URL);
    const keypair = Keypair.fromSecret(CONFIG.STELLAR_SECRET);
    
    // Default to admin's own address if not specified
    const toAddress = destinationAddress || keypair.publicKey();
    
    console.log(`📋 Configuration:`);
    console.log(`   Vault Contract: ${CONFIG.VAULT_CONTRACT_ID}`);
    console.log(`   Admin Address: ${keypair.publicKey()}`);
    console.log(`   Amount: ${amountXlm} XLM`);
    console.log(`   Destination: ${toAddress}`);
    console.log('');
    
    try {
        // Load account
        console.log('📡 Loading account...');
        const account = await server.getAccount(keypair.publicKey());
        
        // Convert XLM to stroops (1 XLM = 10^7 stroops)
        const amountStroops = Math.floor(amountXlm * 10000000);
        console.log(`   Amount in stroops: ${amountStroops}`);
        
        // Build the contract call
        const contract = new Contract(CONFIG.VAULT_CONTRACT_ID);
        
        // Call the release function (admin only)
        const releaseOp = contract.call(
            "release",
            nativeToScVal(Address.fromString(toAddress), { type: "address" }),
            nativeToScVal(amountStroops, { type: "i128" })
        );
        
        // Build transaction
        console.log('🔨 Building transaction...');
        const transaction = new TransactionBuilder(account, {
            fee: '100000', // 0.01 XLM
            networkPassphrase: Networks.TESTNET
        })
            .addOperation(releaseOp)
            .setTimeout(30)
            .build();
        
        // Simulate
        console.log('🧪 Simulating transaction...');
        const simResponse = await server.simulateTransaction(transaction);
        
        if (rpc.Api.isSimulationError(simResponse)) {
            console.error('❌ Simulation failed:', simResponse.error);
            process.exit(1);
        }
        
        console.log('   ✅ Simulation successful');
        
        // Prepare and sign
        console.log('✍️  Signing transaction...');
        const preparedTx = rpc.assembleTransaction(transaction, simResponse).build();
        preparedTx.sign(keypair);
        
        // Submit
        console.log('📤 Submitting transaction...');
        const sendResponse = await server.sendTransaction(preparedTx);
        console.log(`   TX Hash: ${sendResponse.hash}`);
        
        // Wait for confirmation
        console.log('⏳ Waiting for confirmation...');
        let getResponse = await server.getTransaction(sendResponse.hash);
        let attempts = 0;
        
        while (getResponse.status === 'NOT_FOUND' && attempts < 30) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            getResponse = await server.getTransaction(sendResponse.hash);
            attempts++;
            process.stdout.write('.');
        }
        console.log('');
        
        if (getResponse.status === 'SUCCESS') {
            console.log('\n✅ ═══════════════════════════════════════════');
            console.log('   UNLOCK SUCCESSFUL!');
            console.log('═══════════════════════════════════════════════');
            console.log(`   TX Hash: ${sendResponse.hash}`);
            console.log(`   Amount: ${amountXlm} XLM released`);
            console.log(`   To: ${toAddress}`);
            console.log('');
            
            return {
                success: true,
                txHash: sendResponse.hash,
                amountXlm,
                toAddress
            };
        } else {
            console.error(`\n❌ Transaction failed: ${getResponse.status}`);
            process.exit(1);
        }
        
    } catch (error) {
        console.error('\n❌ Error:', error.message);
        process.exit(1);
    }
}

// Parse command line arguments
const args = process.argv.slice(2);
const amount = parseFloat(args[0]) || 0.1;
const stellarAddress = args[1] || null; // null = use admin's address

if (args.length < 1) {
    console.log('\n📖 Usage: node test/test-unlock-xlm.js <amount_xlm> [stellar_address]');
    console.log('   Example: node test/test-unlock-xlm.js 0.1');
    console.log('   Example: node test/test-unlock-xlm.js 0.1 GABC...XYZ\n');
}

unlockXlm(amount, stellarAddress);
