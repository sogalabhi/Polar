require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const StellarSdk = require('@stellar/stellar-sdk');
const { ethers } = require('ethers');
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase client
const supabase = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.VITE_SUPABASE_ANON_KEY
);

// Extract Stellar SDK components
const { 
    rpc,
    xdr, 
    scValToNative, 
    Keypair, 
    TransactionBuilder, 
    Networks, 
    Operation, 
    Asset, 
    BASE_FEE,
    Horizon
} = StellarSdk;

// Create Server class reference
const SorobanRpcServer = rpc.Server;

// ============================================
// CONFIGURATION
// ============================================
const CONFIG = {
    // Stellar Soroban Configuration
    STELLAR_RPC_URL: process.env.STELLAR_RPC_URL || 'https://soroban-testnet.stellar.org',
    STELLAR_HORIZON_URL: 'https://horizon-testnet.stellar.org',
    VAULT_CONTRACT_ID: process.env.VAULT_CONTRACT_ID || 'CDI75PQ4EA2VBTT7W6EZN2RGJIS4CFDMGT7WJ4L42T4ZSTNEKY42NY2B',
    STELLAR_RELAYER_SECRET: process.env.STELLAR_RELAYER_SECRET || '',
    
    // Paseo Asset Hub EVM Configuration
    EVM_RPC_URL: process.env.EVM_RPC_URL || 'https://testnet-passet-hub-eth-rpc.polkadot.io',
    EVM_CHAIN_ID: process.env.EVM_CHAIN_ID || '420420422',
    EVM_POOL_ADDRESS: process.env.EVM_POOL_ADDRESS || '0x49e12e876588052A977dB816107B1772B4103E3e',
    EVM_RELAYER_PRIVATE_KEY: process.env.EVM_RELAYER_PRIVATE_KEY || '',
    EVM_EXPLORER_URL: 'https://blockscout-passet-hub.parity-testnet.parity.io',
    
    // Polkadot Configuration (Optional - for ink! pool)
    POLKADOT_RPC_URL: process.env.POLKADOT_RPC_URL || 'wss://paseo.rpc.amforc.com',
    POLKADOT_RELAYER_SEED: process.env.POLKADOT_RELAYER_SEED || '',
    
    // API Server URL (for notifying when PAS is sent)
    API_SERVER_URL: process.env.API_SERVER_URL || 'http://localhost:3000',
    
    // LTV ratio for calculating loan amount (100% = 1.0, 1:1 PAS to XLM)
    LTV_RATIO: 1.0,
    
    // Polling interval in milliseconds
    POLL_INTERVAL: 5000,
    
    // File to track processed events
    PROCESSED_EVENTS_FILE: './processed_events.json'
};

// EVM Pool Contract ABI (minimal)
const EVM_POOL_ABI = [
    "event FundsReceived(address indexed from, uint256 amount)",
    "event LiquidityReleased(address indexed to, uint256 amount)",
    "function releaseLiquidity(address payable to, uint256 amount) external",
    "function getBalance() external view returns (uint256)",
    "function admin() external view returns (address)"
];

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
    return { 
        lastStellarLedger: 0, 
        lastEvmBlock: 0,
        processedStellarTxIds: [],
        processedEvmTxIds: []
    };
}

function saveProcessedEvents(data) {
    fs.writeFileSync(CONFIG.PROCESSED_EVENTS_FILE, JSON.stringify(data, null, 2));
}

// ============================================
// EVM (PASEO ASSET HUB) SETUP
// ============================================
async function setupEvm() {
    if (!CONFIG.EVM_RELAYER_PRIVATE_KEY) {
        console.log('⚠️  EVM not configured. Set EVM_RELAYER_PRIVATE_KEY in .env');
        return null;
    }
    
    console.log('🔗 Connecting to Paseo Asset Hub...');
    const provider = new ethers.JsonRpcProvider(CONFIG.EVM_RPC_URL);
    const wallet = new ethers.Wallet(CONFIG.EVM_RELAYER_PRIVATE_KEY, provider);
    const poolContract = new ethers.Contract(CONFIG.EVM_POOL_ADDRESS, EVM_POOL_ABI, wallet);
    
    const balance = await provider.getBalance(wallet.address);
    const poolBalance = await poolContract.getBalance();
    
    console.log(`✅ EVM connected`);
    console.log(`   Relayer: ${wallet.address}`);
    console.log(`   Relayer Balance: ${ethers.formatEther(balance)} PAS`);
    console.log(`   Pool Address: ${CONFIG.EVM_POOL_ADDRESS}`);
    console.log(`   Pool Balance: ${ethers.formatEther(poolBalance)} PAS`);
    
    return { provider, wallet, poolContract };
}

// ============================================
// STELLAR SETUP
// ============================================
async function setupStellar() {
    if (!CONFIG.STELLAR_RELAYER_SECRET) {
        console.log('⚠️  Stellar not configured. Set STELLAR_RELAYER_SECRET in .env');
        return null;
    }
    
    console.log('🔗 Connecting to Stellar Testnet...');
    const server = new SorobanRpcServer(CONFIG.STELLAR_RPC_URL);
    const keypair = Keypair.fromSecret(CONFIG.STELLAR_RELAYER_SECRET);
    
    console.log(`✅ Stellar connected`);
    console.log(`   Relayer: ${keypair.publicKey()}`);
    console.log(`   Vault Contract: ${CONFIG.VAULT_CONTRACT_ID}`);
    
    return { server, keypair };
}

// ============================================
// STELLAR EVENT LISTENER (Lock Events → Release on EVM)
// ============================================
async function watchStellarEvents(onLockEvent, processedData) {
    const server = new SorobanRpcServer(CONFIG.STELLAR_RPC_URL);
    
    console.log(`\n🔭 Watching Stellar Vault: ${CONFIG.VAULT_CONTRACT_ID}`);
    
    let startLedger = processedData.lastStellarLedger || 0;
    
    // If no saved ledger, get current ledger
    if (startLedger === 0) {
        const latestLedger = await server.getLatestLedger();
        startLedger = latestLedger.sequence - 100; // Start from 100 ledgers ago
        console.log(`   Starting from ledger: ${startLedger}`);
    }
    
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
                    // Skip if already processed
                    if (processedData.processedStellarTxIds.includes(event.id)) {
                        continue;
                    }
                    
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
                        
                        // Only process "lock" events
                        if (topics[0] !== 'lock') {
                            continue;
                        }
                        
                        console.log('\n🔥 ========== STELLAR LOCK EVENT ==========');
                        console.log(`   Ledger: ${event.ledger}`);
                        console.log(`   Event ID: ${event.id}`);
                        
                        // Parse data - handle both string and object formats
                        let data;
                        if (typeof event.value === 'string') {
                            const valueScVal = xdr.ScVal.fromXDR(event.value, 'base64');
                            data = scValToNative(valueScVal);
                        } else if (event.value.toXDR) {
                            data = scValToNative(event.value);
                        } else {
                            data = event.value;
                        }
                        
                        // Topic[1] = destination address (EVM address as string)
                        const evmAddress = topics[1];
                        const stellarAddress = data[0];
                        const amount = data[1];
                        
                        console.log(`   EVM Destination: ${evmAddress}`);
                        console.log(`   Stellar Sender: ${stellarAddress}`);
                        console.log(`   Locked Amount: ${amount} stroops`);
                        
                        // Calculate loan amount (amount * LTV)
                        // Convert stroops to XLM (this is used for non-lending 1:1 swap events)
                        const xlmAmount = Number(amount) / 10000000; // stroops to XLM
                        const loanAmountDev = xlmAmount * CONFIG.LTV_RATIO;
                        
                        console.log(`   Locked XLM: ${xlmAmount.toFixed(4)} XLM`);
                        console.log(`   Release Amount (${CONFIG.LTV_RATIO * 100}% LTV): ${loanAmountDev.toFixed(4)} (native token)`);
                        
                        // Mark as processed IMMEDIATELY to prevent duplicate processing
                        processedData.processedStellarTxIds.push(event.id);
                        if (processedData.processedStellarTxIds.length > 1000) {
                            processedData.processedStellarTxIds = processedData.processedStellarTxIds.slice(-1000);
                        }
                        saveProcessedEvents(processedData);
                        
                        // CHECK: Is this a lending loan? If so, skip automatic PAS release
                        // (The /api/borrow-pas endpoint handles sending the correct PAS amount)
                        try {
                            const { data: existingLoan, error: loanCheckError } = await supabase
                                .from('crypto_purchases')
                                .select('id, borrowed_pas, status')
                                .eq('destination_address', evmAddress.toLowerCase())
                                .not('borrowed_pas', 'is', null)  // Only lending loans have borrowed_pas
                                .in('status', ['active', 'locked'])
                                .order('created_at', { ascending: false })
                                .limit(1)
                                .single();
                            
                            if (existingLoan && existingLoan.borrowed_pas) {
                                console.log(`\n   ⚠️  LENDING LOAN DETECTED - Skipping automatic PAS release`);
                                console.log(`   📋 Loan ID: ${existingLoan.id}`);
                                console.log(`   📋 Borrowed PAS (from loan): ${existingLoan.borrowed_pas}`);
                                console.log(`   📋 This event was for collateral locking. PAS already sent by /api/borrow-pas.`);
                                console.log('============================================\n');
                                continue; // Skip the automatic PAS release
                            }
                        } catch (loanCheckErr) {
                            // No loan found or error - proceed with normal flow (non-lending lock)
                            console.log(`   📋 No lending loan found - processing as regular stake`);
                        }
                        
                        // Now process the event (async) - only for non-lending locks
                        await onLockEvent({
                            eventId: event.id,
                            evmAddress,
                            stellarAddress,
                            lockedAmount: amount,
                            loanAmountWei: ethers.parseEther(loanAmountDev.toString()),
                            ledger: event.ledger,
                            direction: 'stellar-to-evm'
                        });
                        
                        console.log('============================================\n');
                        
                    } catch (parseError) {
                        console.error('   Error parsing event:', parseError.message);
                    }
                }
                
                const lastEvent = response.events[response.events.length - 1];
                processedData.lastStellarLedger = lastEvent.ledger;
                saveProcessedEvents(processedData);
            }
            
        } catch (e) {
            if (!e.message?.includes('start is before')) {
                // Silently ignore common polling errors
            }
        }
    }, CONFIG.POLL_INTERVAL);
}

// ============================================
// EVM EVENT LISTENER (FundsReceived → Release on Stellar)
// Uses polling instead of filters (some chains don't support long-running filters)
// ============================================
async function watchEvmEvents(evm, onEvmDeposit, processedData) {
    if (!evm) {
        console.log('⚠️  EVM not configured. Skipping EVM event watching.');
        return;
    }
    
    const { provider, poolContract } = evm;
    
    console.log(`\n🔭 Watching EVM Pool: ${CONFIG.EVM_POOL_ADDRESS}`);
    
    // Get current block if not saved
    if (processedData.lastEvmBlock === 0) {
        processedData.lastEvmBlock = await provider.getBlockNumber() - 100;
        console.log(`   Starting from block: ${processedData.lastEvmBlock}`);
    }
    
    // Poll for FundsReceived events instead of using filters
    setInterval(async () => {
        try {
            const currentBlock = await provider.getBlockNumber();
            
            // Query for FundsReceived events from last processed block
            const filter = poolContract.filters.FundsReceived();
            const events = await poolContract.queryFilter(
                filter,
                processedData.lastEvmBlock + 1,
                currentBlock
            );
            
            for (const event of events) {
                const txHash = event.transactionHash;
                
                // Skip if already processed
                if (processedData.processedEvmTxIds.includes(txHash)) {
                    continue;
                }
                
                const [from, amount] = event.args;
                
                console.log('\n🔥 ========== EVM DEPOSIT EVENT ==========');
                console.log(`   Block: ${event.blockNumber}`);
                console.log(`   TX Hash: ${txHash}`);
                console.log(`   From: ${from}`);
                console.log(`   Amount: ${ethers.formatEther(amount)} PAS`);
                
                // Get transaction data to extract Stellar address
                const tx = await provider.getTransaction(txHash);
                let stellarAddress = '';
                
                // Try to decode Stellar address from tx data (if included)
                if (tx.data && tx.data.length > 10) {
                    try {
                        // Assume Stellar address is encoded in data field after function selector
                        const dataHex = tx.data.slice(10); // Remove function selector
                        stellarAddress = ethers.toUtf8String('0x' + dataHex).trim();
                    } catch {
                        // If not encoded in data, we'll need to handle this differently
                        console.log('   ⚠️  Stellar address not found in tx data');
                    }
                }
                
                // Calculate XLM amount to release (PAS to XLM, 1:1 for simplicity)
                const devAmount = parseFloat(ethers.formatEther(amount));
                const xlmLoanAmount = devAmount * CONFIG.LTV_RATIO;
                
                console.log(`   Stellar Destination: ${stellarAddress || 'NOT PROVIDED'}`);
                console.log(`   Loan Amount (${CONFIG.LTV_RATIO * 100}% LTV): ${xlmLoanAmount} XLM`);
                
                // Mark as processed IMMEDIATELY to prevent duplicates
                processedData.processedEvmTxIds.push(txHash);
                if (processedData.processedEvmTxIds.length > 1000) {
                    processedData.processedEvmTxIds = processedData.processedEvmTxIds.slice(-1000);
                }
                saveProcessedEvents(processedData);
                
                // Notify API server about the payback (credit INR to user)
                try {
                    console.log('   📡 Notifying API server to credit INR...');
                    const response = await fetch(`${CONFIG.API_SERVER_URL}/api/payback-completed`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            evmTxHash: txHash,
                            evmAddress: from,
                            pasAmount: devAmount.toString()
                        })
                    });
                    const result = await response.json();
                    if (result.success) {
                        console.log(`   ✅ INR credited: ₹${result.data?.inrCredited?.toFixed(2)}`);
                    } else {
                        console.log(`   ⚠️  API response: ${result.error}`);
                    }
                } catch (apiError) {
                    console.log(`   ⚠️  Could not notify API server: ${apiError.message}`);
                }
                
                // If Stellar address provided, also release XLM on Stellar
                if (stellarAddress) {
                    await onEvmDeposit({
                        txHash,
                        evmAddress: from,
                        stellarAddress,
                        lockedAmount: amount,
                        loanAmountXlm: xlmLoanAmount,
                        block: event.blockNumber,
                        direction: 'evm-to-stellar'
                    });
                }
                
                console.log('============================================\n');
            }
            
            // Update last block
            if (currentBlock > processedData.lastEvmBlock) {
                processedData.lastEvmBlock = currentBlock;
                saveProcessedEvents(processedData);
            }
            
        } catch (e) {
            // Silently ignore common RPC polling errors (Paseo RPC is flaky)
            const ignoredErrors = ['filter', 'Filter', 'coalesce', 'getLogs', 'UNKNOWN_ERROR'];
            const shouldIgnore = ignoredErrors.some(err => e.message?.includes(err));
            if (!shouldIgnore) {
                console.error('EVM polling error:', e.message);
            }
        }
    }, CONFIG.POLL_INTERVAL);
}

// ============================================
// RELEASE LIQUIDITY ON EVM (Paseo Asset Hub)
// ============================================
async function releaseOnEvm(evm, eventData) {
    console.log('\n📡 ═══════════════════════════════════════════════════════════════');
    console.log('   💸 WEB3 CONTRACT CALL: Release Liquidity on Paseo Asset Hub');
    console.log('═══════════════════════════════════════════════════════════════════');
    console.log(`   📋 Contract: ${CONFIG.EVM_POOL_ADDRESS}`);
    console.log(`   📋 Method: releaseLiquidity()`);
    console.log(`   📋 Network: Paseo Asset Hub (Chain ID: ${CONFIG.EVM_CHAIN_ID})`);
    console.log(`   📋 Recipient: ${eventData.evmAddress}`);
    console.log(`   📋 Amount: ${ethers.formatEther(eventData.loanAmountWei)} (native token)`);
    console.log(`   📋 Event ID: ${eventData.eventId}`);
    
    if (!evm) {
        console.log('\n   ⚠️  EVM not configured. Would release:');
        console.log(`   To: ${eventData.evmAddress}`);
        console.log(`   Amount: ${ethers.formatEther(eventData.loanAmountWei)} (native token)`);
        console.log('═══════════════════════════════════════════════════════════════════\n');
        return;
    }
    
    const { poolContract, wallet } = evm;
    console.log(`   📋 Relayer Wallet: ${wallet.address}`);
    
    try {
        // Check pool balance first
        console.log('\n   🔍 Step 1: Checking pool balance...');
        const poolBalance = await poolContract.getBalance();
        console.log(`   📊 Pool Balance: ${ethers.formatEther(poolBalance)} (native token)`);
        console.log(`   📊 Required: ${ethers.formatEther(eventData.loanAmountWei)} (native token)`);
        
        if (poolBalance < eventData.loanAmountWei) {
            console.error('\n   ═══════════════════════════════════════════════════════════');
            console.error('   ❌ INSUFFICIENT POOL BALANCE');
            console.error('   ═══════════════════════════════════════════════════════════');
            console.error(`   Available: ${ethers.formatEther(poolBalance)} (native token)`);
            console.error(`   Required: ${ethers.formatEther(eventData.loanAmountWei)} (native token)`);
            console.error(`   Note: This is for non-lending lock events (1:1 XLM swap).`);
            console.error('═══════════════════════════════════════════════════════════════════\n');
            return;
        }
        console.log('   ✅ Sufficient balance available');
        
        // Call releaseLiquidity on EVM pool
        console.log('\n   📤 Step 2: Sending transaction to Paseo Asset Hub...');
        const tx = await poolContract.releaseLiquidity(
            eventData.evmAddress,
            eventData.loanAmountWei
        );
        
        console.log('\n   ═══════════════════════════════════════════════════════════');
        console.log('   ✅ TRANSACTION SUBMITTED TO PASEO');
        console.log('   ═══════════════════════════════════════════════════════════');
        console.log(`   🔗 TX HASH: ${tx.hash}`);
        console.log(`   🔗 Explorer: ${CONFIG.EVM_EXPLORER_URL}/tx/${tx.hash}`);
        console.log(`   📊 Nonce: ${tx.nonce}`);
        console.log(`   ⛽ Gas Limit: ${tx.gasLimit?.toString()}`);
        
        console.log('\n   ⏳ Step 3: Waiting for confirmation...');
        const receipt = await tx.wait();
        
        console.log('\n   ═══════════════════════════════════════════════════════════');
        console.log('   ✅ EVM TRANSACTION CONFIRMED!');
        console.log('   ═══════════════════════════════════════════════════════════');
        console.log(`   🔗 TX HASH: ${tx.hash}`);
        console.log(`   📦 Block Number: ${receipt.blockNumber}`);
        console.log(`   ⛽ Gas Used: ${receipt.gasUsed?.toString()}`);
        console.log(`   📊 Status: ${receipt.status === 1 ? 'SUCCESS ✓' : 'FAILED ✗'}`);
        console.log('═══════════════════════════════════════════════════════════════════\n');
        
        // Notify API server that PAS was sent (if server is running)
        try {
            console.log('   📡 Notifying API server...');
            const response = await fetch(`${CONFIG.API_SERVER_URL}/api/purchase-completed`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    evmAddress: eventData.evmAddress,
                    evmTxHash: tx.hash,
                    stellarEventId: eventData.eventId,
                    amount: ethers.formatEther(eventData.loanAmountWei)
                })
            });
            if (response.ok) {
                console.log(`   ✅ API server notified successfully`);
            }
        } catch (notifyError) {
            // Server might not be running, that's OK
            console.log(`   ⚠️  Could not notify API server: ${notifyError.message}`);
        }
        
    } catch (e) {
        console.error('\n   ═══════════════════════════════════════════════════════════');
        console.error('   ❌ EVM TRANSACTION FAILED');
        console.error('   ═══════════════════════════════════════════════════════════');
        console.error(`   Error: ${e.message}`);
        if (e.transaction) {
            console.error(`   TX Hash: ${e.transaction.hash}`);
        }
        if (e.code) {
            console.error(`   Error Code: ${e.code}`);
        }
        console.error('═══════════════════════════════════════════════════════════════════\n');
    }
}

// ============================================
// RELEASE LIQUIDITY ON STELLAR
// ============================================
async function releaseOnStellar(stellar, eventData) {
    console.log('\n📡 ═══════════════════════════════════════════════════════════════');
    console.log('   💸 WEB3 CALL: Release Liquidity on Stellar');
    console.log('═══════════════════════════════════════════════════════════════════');
    console.log(`   📋 Network: Stellar Testnet`);
    console.log(`   📋 Operation: Payment`);
    console.log(`   📋 Recipient: ${eventData.stellarAddress}`);
    console.log(`   📋 Amount: ${eventData.loanAmountXlm} XLM`);
    console.log(`   📋 Source TX: ${eventData.txHash}`);
    
    if (!stellar) {
        console.log('\n   ⚠️  Stellar not configured. Would release:');
        console.log(`   To: ${eventData.stellarAddress}`);
        console.log(`   Amount: ${eventData.loanAmountXlm} XLM`);
        console.log('═══════════════════════════════════════════════════════════════════\n');
        return;
    }
    
    const { server, keypair } = stellar;
    console.log(`   📋 Relayer: ${keypair.publicKey()}`);
    
    try {
        // Load the relayer's account
        console.log('\n   🔍 Step 1: Loading relayer account...');
        const account = await server.getAccount(keypair.publicKey());
        console.log(`   ✅ Account loaded. Sequence: ${account.sequenceNumber()}`);
        
        // Build transaction to send XLM
        console.log('\n   🔨 Step 2: Building payment transaction...');
        const transaction = new TransactionBuilder(account, {
            fee: BASE_FEE,
            networkPassphrase: Networks.TESTNET
        })
        .addOperation(Operation.payment({
            destination: eventData.stellarAddress,
            asset: Asset.native(),
            amount: eventData.loanAmountXlm.toFixed(7)
        }))
        .setTimeout(30)
        .build();
        console.log('   ✅ Transaction built');
        
        // Sign and submit
        console.log('\n   ✍️  Step 3: Signing transaction...');
        transaction.sign(keypair);
        console.log('   ✅ Transaction signed');
        
        console.log('\n   📤 Step 4: Submitting to Stellar network...');
        const response = await server.sendTransaction(transaction);
        
        console.log('\n   ═══════════════════════════════════════════════════════════');
        console.log('   ✅ STELLAR TRANSACTION SUBMITTED!');
        console.log('   ═══════════════════════════════════════════════════════════');
        console.log(`   🔗 TX HASH: ${response.hash}`);
        console.log(`   🔗 Explorer: https://stellar.expert/explorer/testnet/tx/${response.hash}`);
        console.log(`   📊 Status: ${response.status}`);
        console.log('═══════════════════════════════════════════════════════════════════\n');
        
    } catch (e) {
        console.error('\n   ═══════════════════════════════════════════════════════════');
        console.error('   ❌ STELLAR TRANSACTION FAILED');
        console.error('   ═══════════════════════════════════════════════════════════');
        console.error(`   Error: ${e.message}`);
        console.error('═══════════════════════════════════════════════════════════════════\n');
    }
}

// ============================================
// MAIN
// ============================================
async function main() {
    console.log('');
    console.log('🌉 ═══════════════════════════════════════════');
    console.log('   POLAR BRIDGE RELAYER');
    console.log('   Stellar ↔ Paseo Asset Hub Bidirectional Bridge');
    console.log('═══════════════════════════════════════════════');
    console.log('');
    
    // Load processed events
    const processedData = loadProcessedEvents();
    
    // Setup EVM (Paseo Asset Hub)
    const evm = await setupEvm();
    
    // Setup Stellar
    const stellar = await setupStellar();
    
    if (!evm && !stellar) {
        console.error('❌ ERROR: Neither EVM nor Stellar is configured!');
        console.error('   Please set the required environment variables in .env');
        process.exit(1);
    }
    
    // Watch Stellar events → Release on EVM
    if (stellar) {
        await watchStellarEvents(async (eventData) => {
            console.log('📤 Processing Stellar lock → EVM release...');
            await releaseOnEvm(evm, eventData);
        }, processedData);
    }
    
    // Watch EVM events → Release on Stellar
    if (evm) {
        await watchEvmEvents(evm, async (eventData) => {
            console.log('📤 Processing EVM deposit → Stellar release...');
            await releaseOnStellar(stellar, eventData);
        }, processedData);
    }
    
    console.log('');
    console.log('✅ Relayer is running!');
    console.log('');
    console.log('🔄 Bridge Flows Active:');
    if (stellar && evm) {
        console.log('   • Stellar (XLM) → Paseo (PAS)');
        console.log('   • Paseo (PAS) → Stellar (XLM)');
    } else if (stellar) {
        console.log('   • Stellar (XLM) → (EVM not configured)');
    } else if (evm) {
        console.log('   • Paseo (PAS) → (Stellar not configured)');
    }
    console.log('');
    console.log('Press Ctrl+C to stop.');
    console.log('');
}

main().catch(console.error);
