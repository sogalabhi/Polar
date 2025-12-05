/**
 * TEST: Check Vault Balance
 * 
 * This script checks the total XLM locked in the vault contract.
 * 
 * Usage: node test/test-check-balance.js
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
    scValToNative,
    Address
} = StellarSdk;

// Configuration
const CONFIG = {
    STELLAR_RPC_URL: process.env.STELLAR_RPC_URL || 'https://soroban-testnet.stellar.org',
    VAULT_CONTRACT_ID: process.env.VAULT_CONTRACT_ID || 'CDI75PQ4EA2VBTT7W6EZN2RGJIS4CFDMGT7WJ4L42T4ZSTNEKY42NY2B',
    STELLAR_SECRET: process.env.STELLAR_RELAYER_SECRET,
};

async function checkBalance() {
    console.log('\n📊 ═══════════════════════════════════════════');
    console.log('   TEST: Check Stellar Vault Balance');
    console.log('═══════════════════════════════════════════════\n');
    
    if (!CONFIG.STELLAR_SECRET) {
        console.error('❌ Error: STELLAR_RELAYER_SECRET not set in .env');
        process.exit(1);
    }
    
    const server = new rpc.Server(CONFIG.STELLAR_RPC_URL);
    const keypair = Keypair.fromSecret(CONFIG.STELLAR_SECRET);
    
    console.log(`📋 Configuration:`);
    console.log(`   Vault Contract: ${CONFIG.VAULT_CONTRACT_ID}`);
    console.log(`   Admin Address: ${keypair.publicKey()}`);
    console.log('');
    
    try {
        // Load account
        const account = await server.getAccount(keypair.publicKey());
        
        // Build the contract call for get_total_locked
        const contract = new Contract(CONFIG.VAULT_CONTRACT_ID);
        
        console.log('📡 Querying total locked amount...');
        
        const getTotalOp = contract.call("get_total_locked");
        
        const transaction = new TransactionBuilder(account, {
            fee: '100000',
            networkPassphrase: Networks.TESTNET
        })
            .addOperation(getTotalOp)
            .setTimeout(30)
            .build();
        
        const simResponse = await server.simulateTransaction(transaction);
        
        if (rpc.Api.isSimulationError(simResponse)) {
            console.error('❌ Simulation failed:', simResponse.error);
            process.exit(1);
        }
        
        // Extract the result
        if (simResponse.result) {
            const resultXdr = simResponse.result.retval;
            const totalStroops = scValToNative(resultXdr);
            const totalXlm = Number(totalStroops) / 10000000;
            
            console.log('\n✅ ═══════════════════════════════════════════');
            console.log('   VAULT BALANCE');
            console.log('═══════════════════════════════════════════════');
            console.log(`   Total Locked: ${totalXlm.toFixed(7)} XLM`);
            console.log(`   (${totalStroops} stroops)`);
            console.log('');
        }
        
        // Also check admin's locked balance
        console.log('📡 Querying admin locked balance...');
        
        const getBalanceOp = contract.call(
            "get_locked_balance",
            nativeToScVal(Address.fromString(keypair.publicKey()), { type: "address" })
        );
        
        const account2 = await server.getAccount(keypair.publicKey());
        const transaction2 = new TransactionBuilder(account2, {
            fee: '100000',
            networkPassphrase: Networks.TESTNET
        })
            .addOperation(getBalanceOp)
            .setTimeout(30)
            .build();
        
        const simResponse2 = await server.simulateTransaction(transaction2);
        
        if (!rpc.Api.isSimulationError(simResponse2) && simResponse2.result) {
            const resultXdr2 = simResponse2.result.retval;
            const adminStroops = scValToNative(resultXdr2);
            const adminXlm = Number(adminStroops) / 10000000;
            
            console.log(`   Admin Locked: ${adminXlm.toFixed(7)} XLM`);
            console.log(`   (${adminStroops} stroops)`);
            console.log('');
        }
        
    } catch (error) {
        console.error('\n❌ Error:', error.message);
        process.exit(1);
    }
}

checkBalance();
