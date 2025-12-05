/**
 * TEST: Debug - Query ALL events from the vault contract
 * 
 * This script queries all events from the vault without topic filtering
 * to help debug why events aren't being detected.
 * 
 * Usage: node test/test-debug-events.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const StellarSdk = require('@stellar/stellar-sdk');

const { rpc, xdr, scValToNative } = StellarSdk;

// Configuration
const CONFIG = {
    STELLAR_RPC_URL: process.env.STELLAR_RPC_URL || 'https://soroban-testnet.stellar.org',
    VAULT_CONTRACT_ID: process.env.VAULT_CONTRACT_ID || 'CDI75PQ4EA2VBTT7W6EZN2RGJIS4CFDMGT7WJ4L42T4ZSTNEKY42NY2B',
};

async function debugEvents() {
    console.log('\n🔍 ═══════════════════════════════════════════');
    console.log('   DEBUG: Query ALL Vault Events');
    console.log('═══════════════════════════════════════════════\n');
    
    const server = new rpc.Server(CONFIG.STELLAR_RPC_URL);
    
    console.log(`📋 Configuration:`);
    console.log(`   Vault Contract: ${CONFIG.VAULT_CONTRACT_ID}`);
    console.log('');
    
    // Get current ledger
    const latestLedger = await server.getLatestLedger();
    console.log(`📡 Latest ledger: ${latestLedger.sequence}`);
    
    // Try different start ledgers
    const startLedgers = [
        latestLedger.sequence - 1000,  // 1000 ledgers ago
        latestLedger.sequence - 500,   // 500 ledgers ago
        latestLedger.sequence - 100,   // 100 ledgers ago
        latestLedger.sequence - 50,    // 50 ledgers ago
    ];
    
    for (const startLedger of startLedgers) {
        console.log(`\n🔎 Querying from ledger ${startLedger}...`);
        
        try {
            // Query WITHOUT topic filter - get all contract events
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
            
            console.log(`   Found ${response.events?.length || 0} events`);
            
            if (response.events && response.events.length > 0) {
                console.log('\n   📦 Events found:');
                for (const event of response.events) {
                    console.log(`\n   ─────────────────────────────────────`);
                    console.log(`   Ledger: ${event.ledger}`);
                    console.log(`   Event ID: ${event.id}`);
                    console.log(`   Type: ${event.type}`);
                    
                    // Parse topics
                    if (event.topic && event.topic.length > 0) {
                        console.log(`   Topics (${event.topic.length}):`);
                        event.topic.forEach((t, i) => {
                            try {
                                // Handle if t is already an object or is base64
                                let scVal;
                                if (typeof t === 'string') {
                                    scVal = xdr.ScVal.fromXDR(t, 'base64');
                                } else if (t.toXDR) {
                                    scVal = t;
                                } else {
                                    console.log(`      [${i}]: (object) ${JSON.stringify(t)}`);
                                    return;
                                }
                                const native = scValToNative(scVal);
                                console.log(`      [${i}]: ${JSON.stringify(native)}`);
                            } catch (e) {
                                console.log(`      [${i}]: (error) ${e.message}`);
                            }
                        });
                    }
                    
                    // Parse value
                    if (event.value) {
                        try {
                            let valueScVal;
                            if (typeof event.value === 'string') {
                                valueScVal = xdr.ScVal.fromXDR(event.value, 'base64');
                            } else if (event.value.toXDR) {
                                valueScVal = event.value;
                            } else {
                                console.log(`   Value: (object) ${JSON.stringify(event.value)}`);
                                continue;
                            }
                            const valueNative = scValToNative(valueScVal);
                            console.log(`   Value: ${JSON.stringify(valueNative)}`);
                        } catch (e) {
                            console.log(`   Value: (error) ${e.message}`);
                        }
                    }
                }
                
                // Found events, no need to try older ledgers
                break;
            }
            
        } catch (e) {
            console.log(`   Error: ${e.message}`);
        }
    }
    
    console.log('\n');
}

debugEvents().catch(console.error);
