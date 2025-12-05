/**
 * TEST: Watch Stellar Events (Standalone)
 * 
 * This script watches for lock events on the Stellar vault.
 * It's a minimal version of the relayer to test event detection.
 * 
 * Usage: node test/test-watch-events.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const StellarSdk = require('@stellar/stellar-sdk');

const { rpc, xdr, scValToNative } = StellarSdk;

// Configuration
const CONFIG = {
    STELLAR_RPC_URL: process.env.STELLAR_RPC_URL || 'https://soroban-testnet.stellar.org',
    VAULT_CONTRACT_ID: process.env.VAULT_CONTRACT_ID || 'CDI75PQ4EA2VBTT7W6EZN2RGJIS4CFDMGT7WJ4L42T4ZSTNEKY42NY2B',
    POLL_INTERVAL: 3000, // 3 seconds
};

async function watchEvents() {
    console.log('\n🔭 ═══════════════════════════════════════════');
    console.log('   TEST: Watch Stellar Vault Events');
    console.log('═══════════════════════════════════════════════\n');
    
    const server = new rpc.Server(CONFIG.STELLAR_RPC_URL);
    
    console.log(`📋 Configuration:`);
    console.log(`   Vault Contract: ${CONFIG.VAULT_CONTRACT_ID}`);
    console.log(`   Poll Interval: ${CONFIG.POLL_INTERVAL}ms`);
    console.log('');
    
    // Get current ledger
    const latestLedger = await server.getLatestLedger();
    let startLedger = latestLedger.sequence - 100; // Start from 100 ledgers ago
    
    console.log(`📡 Current ledger: ${latestLedger.sequence}`);
    console.log(`   Starting from: ${startLedger}`);
    console.log('');
    console.log('👀 Watching for events... (Press Ctrl+C to stop)');
    console.log('');
    
    const seenEvents = new Set();
    
    setInterval(async () => {
        try {
            // Query ALL contract events (no topic filter - more reliable)
            const response = await server.getEvents({
                startLedger: startLedger,
                filters: [
                    {
                        type: "contract",
                        contractIds: [CONFIG.VAULT_CONTRACT_ID],
                    },
                ],
                limit: 50
            });
            
            if (response.events && response.events.length > 0) {
                for (const event of response.events) {
                    // Skip if already seen
                    if (seenEvents.has(event.id)) {
                        continue;
                    }
                    seenEvents.add(event.id);
                    
                    console.log('');
                    console.log('🔥 ═══════════════════════════════════════════');
                    console.log('   NEW LOCK EVENT DETECTED!');
                    console.log('═══════════════════════════════════════════════');
                    console.log(`   Ledger: ${event.ledger}`);
                    console.log(`   Event ID: ${event.id}`);
                    
                    try {
                        // Parse topics - handle both string and object formats
                        const topics = event.topic.map(t => {
                            if (typeof t === 'string') {
                                const scVal = xdr.ScVal.fromXDR(t, 'base64');
                                return scValToNative(scVal);
                            } else if (t.toXDR) {
                                return scValToNative(t);
                            }
                            return t;
                        });
                        
                        // Check if this is a "lock" event
                        if (topics[0] !== 'lock') {
                            console.log(`   (Skipping non-lock event: ${topics[0]})`);
                            continue;
                        }
                        
                        // Parse data - handle BigInt
                        let data;
                        if (typeof event.value === 'string') {
                            const valueScVal = xdr.ScVal.fromXDR(event.value, 'base64');
                            data = scValToNative(valueScVal);
                        } else if (event.value.toXDR) {
                            data = scValToNative(event.value);
                        } else {
                            data = event.value;
                        }
                        
                        // Topic[0] = "lock" (event name)
                        // Topic[1] = EVM address
                        const evmAddress = topics[1];
                        const stellarAddress = data[0];
                        const amount = data[1];
                        const xlmAmount = Number(amount) / 10000000;
                        
                        console.log('');
                        console.log('   📦 Event Data:');
                        console.log(`      Event Type: ${topics[0]}`);
                        console.log(`      EVM Address: ${evmAddress}`);
                        console.log(`      Stellar Sender: ${stellarAddress}`);
                        console.log(`      Amount: ${xlmAmount.toFixed(7)} XLM`);
                        console.log(`      (${amount} stroops)`);
                        console.log('');
                        console.log('   ✅ Relayer should now send PAS to:', evmAddress);
                        console.log('═══════════════════════════════════════════════');
                        console.log('');
                        
                    } catch (parseError) {
                        console.error('   Error parsing event:', parseError.message);
                    }
                }
                
                // Update start ledger
                const lastEvent = response.events[response.events.length - 1];
                startLedger = lastEvent.ledger;
            }
            
        } catch (e) {
            if (!e.message?.includes('start is before')) {
                // Silently ignore "start is before" errors (happens when no new ledgers)
            }
        }
    }, CONFIG.POLL_INTERVAL);
}

watchEvents().catch(console.error);
