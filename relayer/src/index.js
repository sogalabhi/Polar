require('dotenv').config();
const { SorobanRpc, xdr, scValToNative } = require('@stellar/stellar-sdk');
const { ApiPromise, WsProvider, Keyring } = require('@polkadot/api');
const fs = require('fs');

// ============================================
// CONFIGURATION - UPDATE THESE VALUES
// ============================================
const CONFIG = {
    // Stellar Soroban RPC
    STELLAR_RPC_URL: process.env.STELLAR_RPC_URL || 'https://soroban-testnet.stellar.org',
    
    // Your deployed Vault Contract ID (UPDATE THIS after redeploying!)
    VAULT_CONTRACT_ID: process.env.VAULT_CONTRACT_ID || 'YOUR_NEW_CONTRACT_ID_HERE',
    
    // Polkadot Paseo Testnet
    POLKADOT_RPC_URL: process.env.POLKADOT_RPC_URL || 'wss://paseo.rpc.amforc.com',
    
    // Polkadot Ink! Pool Contract Address (UPDATE after deploying Ink! contract)
    INK_POOL_ADDRESS: process.env.INK_POOL_ADDRESS || '',
    
    // Relayer's Polkadot private key (for signing transactions)
    POLKADOT_RELAYER_SEED: process.env.POLKADOT_RELAYER_SEED || '',
    
    // LTV ratio for calculating loan amount (75% = 0.75)
    LTV_RATIO: 0.75,
    
    // Polling interval in milliseconds
    POLL_INTERVAL: 5000,
    
    // File to track processed events
    PROCESSED_EVENTS_FILE: './processed_events.json'
};

// ============================================
// PROCESSED EVENTS TRACKING
// ============================================
function loadProcessedEvents() {
    try {
        if (fs.existsSync(CONFIG.PROCESSED_EVENTS_FILE)) {
            return JSON.parse(fs.readFileSync(CONFIG.PROCESSED_EVENTS_FILE, 'utf8'));
        }
    } catch (e) {
        console.error('Error loading processed events:', e.message);
    }
    return { lastLedger: 0, processedTxIds: [] };
}

function saveProcessedEvents(data) {
    fs.writeFileSync(CONFIG.PROCESSED_EVENTS_FILE, JSON.stringify(data, null, 2));
}

// ============================================
// STELLAR EVENT LISTENER
// ============================================
async function watchStellarEvents(onLockEvent) {
    const server = new SorobanRpc.Server(CONFIG.STELLAR_RPC_URL);
    
    console.log(`🔭 Watching Stellar Vault: ${CONFIG.VAULT_CONTRACT_ID}`);
    console.log(`   RPC: ${CONFIG.STELLAR_RPC_URL}`);
    
    let processedData = loadProcessedEvents();
    let startLedger = processedData.lastLedger || 0;
    
    // If no saved ledger, get current ledger
    if (startLedger === 0) {
        const latestLedger = await server.getLatestLedger();
        startLedger = latestLedger.sequence - 100; // Start from 100 ledgers ago
        console.log(`   Starting from ledger: ${startLedger}`);
    }
    
    setInterval(async () => {
        try {
            const response = await server.getEvents({
                startLedger: startLedger,
                filters: [
                    {
                        type: "contract",
                        contractIds: [CONFIG.VAULT_CONTRACT_ID],
                        topics: [
                            [xdr.ScVal.scvSymbol("lock").toXDR("base64")]
                        ]
                    },
                ],
                limit: 20
            });
            
            if (response.events && response.events.length > 0) {
                for (const event of response.events) {
                    // Skip if already processed
                    if (processedData.processedTxIds.includes(event.id)) {
                        continue;
                    }
                    
                    console.log('\n🔥 ========== LOCK EVENT DETECTED ==========');
                    console.log(`   Ledger: ${event.ledger}`);
                    console.log(`   Event ID: ${event.id}`);
                    
                    // Parse event data
                    // Topic: ["lock", polkadot_address]
                    // Data: (from_address, amount)
                    try {
                        const topics = event.topic.map(t => {
                            const scVal = xdr.ScVal.fromXDR(t, 'base64');
                            return scValToNative(scVal);
                        });
                        
                        const data = scValToNative(xdr.ScVal.fromXDR(event.value, 'base64'));
                        
                        const polkadotAddress = topics[1]; // Second topic is polkadot address
                        const [stellarAddress, amount] = data;
                        
                        console.log(`   Polkadot Address: ${polkadotAddress}`);
                        console.log(`   Stellar Address: ${stellarAddress}`);
                        console.log(`   Locked Amount: ${amount}`);
                        
                        // Calculate loan amount (amount * LTV)
                        const loanAmount = BigInt(Math.floor(Number(amount) * CONFIG.LTV_RATIO));
                        console.log(`   Loan Amount (${CONFIG.LTV_RATIO * 100}% LTV): ${loanAmount}`);
                        
                        // Trigger callback
                        await onLockEvent({
                            eventId: event.id,
                            polkadotAddress,
                            stellarAddress,
                            lockedAmount: amount,
                            loanAmount,
                            ledger: event.ledger
                        });
                        
                        // Mark as processed
                        processedData.processedTxIds.push(event.id);
                        // Keep only last 1000 events
                        if (processedData.processedTxIds.length > 1000) {
                            processedData.processedTxIds = processedData.processedTxIds.slice(-1000);
                        }
                        
                    } catch (parseError) {
                        console.error('   Error parsing event:', parseError.message);
                    }
                    
                    console.log('============================================\n');
                }
                
                // Update last ledger
                const lastEvent = response.events[response.events.length - 1];
                processedData.lastLedger = lastEvent.ledger;
                saveProcessedEvents(processedData);
            }
            
        } catch (e) {
            if (!e.message?.includes('start is before')) {
                console.error('Polling error:', e.message);
            }
        }
    }, CONFIG.POLL_INTERVAL);
}

// ============================================
// POLKADOT TRANSACTION SENDER
// ============================================
async function setupPolkadot() {
    if (!CONFIG.INK_POOL_ADDRESS || !CONFIG.POLKADOT_RELAYER_SEED) {
        console.log('⚠️  Polkadot not configured. Skipping Polkadot setup.');
        console.log('   Set INK_POOL_ADDRESS and POLKADOT_RELAYER_SEED in .env');
        return null;
    }
    
    console.log('🔗 Connecting to Polkadot (Paseo)...');
    const wsProvider = new WsProvider(CONFIG.POLKADOT_RPC_URL);
    const api = await ApiPromise.create({ provider: wsProvider });
    
    const keyring = new Keyring({ type: 'sr25519' });
    const relayerAccount = keyring.addFromUri(CONFIG.POLKADOT_RELAYER_SEED);
    
    console.log(`✅ Polkadot connected. Relayer: ${relayerAccount.address}`);
    
    return { api, relayerAccount };
}

async function releaseLiquidity(polkadot, eventData) {
    if (!polkadot) {
        console.log('⚠️  Polkadot not configured. Would release:');
        console.log(`   To: ${eventData.polkadotAddress}`);
        console.log(`   Amount: ${eventData.loanAmount}`);
        return;
    }
    
    const { api, relayerAccount } = polkadot;
    
    console.log(`💸 Releasing liquidity on Polkadot...`);
    console.log(`   To: ${eventData.polkadotAddress}`);
    console.log(`   Amount: ${eventData.loanAmount}`);
    
    // TODO: Call Ink! contract release_liquidity function
    // This would use @polkadot/api-contract to invoke the Ink! contract
    // For now, we'll just log the intent
    
    try {
        // Simple balance transfer (replace with Ink! contract call)
        const transfer = api.tx.balances.transferKeepAlive(
            eventData.polkadotAddress,
            eventData.loanAmount
        );
        
        const hash = await transfer.signAndSend(relayerAccount);
        console.log(`✅ Polkadot TX submitted: ${hash.toHex()}`);
        
    } catch (e) {
        console.error(`❌ Polkadot TX failed: ${e.message}`);
    }
}

// ============================================
// MAIN
// ============================================
async function main() {
    console.log('');
    console.log('🌉 PolkaBridge Relayer Starting...');
    console.log('================================');
    console.log('');
    
    // Validate config
    if (CONFIG.VAULT_CONTRACT_ID === 'YOUR_NEW_CONTRACT_ID_HERE') {
        console.error('❌ ERROR: Please set VAULT_CONTRACT_ID in .env or update CONFIG');
        console.error('   Run: stellar contract deploy ... to get a new contract ID');
        process.exit(1);
    }
    
    // Setup Polkadot (optional - will work without it for testing)
    const polkadot = await setupPolkadot();
    
    // Start watching Stellar events
    await watchStellarEvents(async (eventData) => {
        console.log('📤 Processing lock event...');
        await releaseLiquidity(polkadot, eventData);
    });
    
    console.log('');
    console.log('✅ Relayer is running. Press Ctrl+C to stop.');
    console.log('');
}

main().catch(console.error);
