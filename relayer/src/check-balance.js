require('dotenv').config();
const { Horizon } = require('stellar-sdk');
const { ApiPromise, WsProvider } = require('@polkadot/api');

async function checkBalances() {
    console.log("🔍 Checking connections...");

    // 1. Check Stellar Connection
    try {
        const server = new Horizon.Server('https://horizon-testnet.stellar.org');
        console.log("✅ Stellar: Connected to Horizon Testnet");
        
        // Just checking if we can fetch the fee stats as a connectivity test
        const feeStats = await server.feeStats();
        console.log(`   -> Current Fee Level: ${feeStats.last_ledger_base_fee} stroops`);

    } catch (error) {
        console.error("❌ Stellar: Connection Failed", error.message);
    }

    // 2. Check Polkadot Connection
    try {
        console.log("   -> Connecting to Polkadot (Paseo)...");
        // Paseo Testnet Endpoint
        const wsProvider = new WsProvider('wss://paseo.rpc.amforc.com');
        const api = await ApiPromise.create({ provider: wsProvider });
        
        console.log("✅ Polkadot: Connected to Paseo Testnet");
        
        const [chain, nodeName, nodeVersion] = await Promise.all([
            api.rpc.system.chain(),
            api.rpc.system.name(),
            api.rpc.system.version()
        ]);

        console.log(`   -> Chain: ${chain} | Node: ${nodeName} v${nodeVersion}`);
        
        await api.disconnect();

    } catch (error) {
        console.error("❌ Polkadot: Connection Failed", error.message);
    }
}

checkBalances();
