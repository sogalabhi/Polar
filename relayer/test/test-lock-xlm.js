/**
 * TEST: Lock XLM on Stellar Vault
 * 
 * This script locks XLM from the owner's account on the Stellar vault contract.
 * The relayer should detect this lock event and release PAS on EVM.
 * 
 * Usage: node test/test-lock-xlm.js <amount_xlm> <evm_address>
 * Example: node test/test-lock-xlm.js 0.1 0xYourMetaMaskAddress
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

async function lockXlm(amountXlm, evmAddress) {
    console.log('\n🔐 ═══════════════════════════════════════════');
    console.log('   TEST: Lock XLM on Stellar Vault');
    console.log('═══════════════════════════════════════════════\n');
    
    if (!CONFIG.STELLAR_SECRET) {
        console.error('❌ Error: STELLAR_RELAYER_SECRET not set in .env');
        process.exit(1);
    }
    
    if (!evmAddress || !evmAddress.startsWith('0x')) {
        console.error('❌ Error: Invalid EVM address. Must start with 0x');
        process.exit(1);
    }
    
    const server = new rpc.Server(CONFIG.STELLAR_RPC_URL);
    const keypair = Keypair.fromSecret(CONFIG.STELLAR_SECRET);
    
    console.log(`📋 Configuration:`);
    console.log(`   Vault Contract: ${CONFIG.VAULT_CONTRACT_ID}`);
    console.log(`   Stellar Address: ${keypair.publicKey()}`);
    console.log(`   Amount: ${amountXlm} XLM`);
    console.log(`   EVM Destination: ${evmAddress}`);
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
        
        const lockOp = contract.call(
            "lock",
            nativeToScVal(Address.fromString(keypair.publicKey()), { type: "address" }),
            nativeToScVal(amountStroops, { type: "i128" }),
            nativeToScVal(evmAddress, { type: "string" })
        );
        
        // Build transaction
        console.log('🔨 Building transaction...');
        const transaction = new TransactionBuilder(account, {
            fee: '100000', // 0.01 XLM
            networkPassphrase: Networks.TESTNET
        })
            .addOperation(lockOp)
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
            console.log('   LOCK SUCCESSFUL!');
            console.log('═══════════════════════════════════════════════');
            console.log(`   TX Hash: ${sendResponse.hash}`);
            console.log(`   Amount: ${amountXlm} XLM (${amountStroops} stroops)`);
            console.log(`   EVM Address: ${evmAddress}`);
            console.log('');
            console.log('🔭 The relayer should now detect this event');
            console.log('   and release PAS tokens to the EVM address.');
            console.log('');
            
            return {
                success: true,
                txHash: sendResponse.hash,
                amountXlm,
                amountStroops,
                evmAddress
            };
        } else {
            console.error(`\n❌ Transaction failed: ${getResponse.status}`);
            if (getResponse.resultXdr) {
                console.error(`   Result XDR: ${getResponse.resultXdr}`);
            }
            process.exit(1);
        }
        
    } catch (error) {
        console.error('\n❌ Error:', error.message);
        if (error.response?.data) {
            console.error('   Details:', JSON.stringify(error.response.data, null, 2));
        }
        process.exit(1);
    }
}

// Parse command line arguments
const args = process.argv.slice(2);
const amount = parseFloat(args[0]) || 0.1;
const evmAddress = args[1] || '0x0000000000000000000000000000000000000000';

if (args.length < 2) {
    console.log('\n📖 Usage: node test/test-lock-xlm.js <amount_xlm> <evm_address>');
    console.log('   Example: node test/test-lock-xlm.js 0.1 0xYourMetaMaskAddress\n');
    console.log('   Using defaults: 0.1 XLM to 0x0000...0000\n');
}

lockXlm(amount, evmAddress);
