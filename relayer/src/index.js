require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const StellarSdk = require('@stellar/stellar-sdk');
const { ethers } = require('ethers');
const fs = require('fs');

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
    VAULT_CONTRACT_ID: process.env.VAULT_CONTRACT_ID || 'CC6EIPVGWIIRI73VCJ3VJYLKMQGK7VBKAML5W5GVGZMFLATRYZICJ26A',
    STELLAR_RELAYER_SECRET: process.env.STELLAR_RELAYER_SECRET || '',
    
    // Moonbase Alpha EVM Configuration
    MOONBASE_RPC_URL: process.env.MOONBASE_RPC_URL || 'https://rpc.api.moonbase.moonbeam.network',
    EVM_POOL_ADDRESS: process.env.EVM_POOL_ADDRESS || '0x1Df2Cc6129568a62379f232087F20f5Bc4E37cE6',
    EVM_RELAYER_PRIVATE_KEY: process.env.EVM_RELAYER_PRIVATE_KEY || '',
    
    // Polkadot Configuration (Optional - for ink! pool)
    POLKADOT_RPC_URL: process.env.POLKADOT_RPC_URL || 'wss://paseo.rpc.amforc.com',
    POLKADOT_RELAYER_SEED: process.env.POLKADOT_RELAYER_SEED || '',
    
    // LTV ratio for calculating loan amount (75% = 0.75)
    LTV_RATIO: 0.75,
    
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
// EVM (MOONBASE) SETUP
// ============================================
async function setupEvm() {
    if (!CONFIG.EVM_RELAYER_PRIVATE_KEY) {
        console.log('⚠️  EVM not configured. Set EVM_RELAYER_PRIVATE_KEY in .env');
        return null;
    }
    
    console.log('🔗 Connecting to Moonbase Alpha...');
    const provider = new ethers.JsonRpcProvider(CONFIG.MOONBASE_RPC_URL);
    const wallet = new ethers.Wallet(CONFIG.EVM_RELAYER_PRIVATE_KEY, provider);
    const poolContract = new ethers.Contract(CONFIG.EVM_POOL_ADDRESS, EVM_POOL_ABI, wallet);
    
    const balance = await provider.getBalance(wallet.address);
    const poolBalance = await poolContract.getBalance();
    
    console.log(`✅ EVM connected`);
    console.log(`   Relayer: ${wallet.address}`);
    console.log(`   Relayer Balance: ${ethers.formatEther(balance)} DEV`);
    console.log(`   Pool Address: ${CONFIG.EVM_POOL_ADDRESS}`);
    console.log(`   Pool Balance: ${ethers.formatEther(poolBalance)} DEV`);
    
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
                    if (processedData.processedStellarTxIds.includes(event.id)) {
                        continue;
                    }
                    
                    console.log('\n🔥 ========== STELLAR LOCK EVENT ==========');
                    console.log(`   Ledger: ${event.ledger}`);
                    console.log(`   Event ID: ${event.id}`);
                    
                    try {
                        const topics = event.topic.map(t => {
                            const scVal = xdr.ScVal.fromXDR(t, 'base64');
                            return scValToNative(scVal);
                        });
                        
                        const data = scValToNative(xdr.ScVal.fromXDR(event.value, 'base64'));
                        
                        // Topic[1] = destination address (EVM address as string)
                        const evmAddress = topics[1];
                        const [stellarAddress, amount] = data;
                        
                        console.log(`   EVM Destination: ${evmAddress}`);
                        console.log(`   Stellar Sender: ${stellarAddress}`);
                        console.log(`   Locked Amount: ${amount} stroops`);
                        
                        // Calculate loan amount (amount * LTV)
                        // Convert stroops to DEV (1 XLM = 1 DEV for simplicity)
                        const xlmAmount = Number(amount) / 10000000; // stroops to XLM
                        const loanAmountDev = xlmAmount * CONFIG.LTV_RATIO;
                        
                        console.log(`   Loan Amount (${CONFIG.LTV_RATIO * 100}% LTV): ${loanAmountDev} DEV`);
                        
                        await onLockEvent({
                            eventId: event.id,
                            evmAddress,
                            stellarAddress,
                            lockedAmount: amount,
                            loanAmountWei: ethers.parseEther(loanAmountDev.toString()),
                            ledger: event.ledger,
                            direction: 'stellar-to-evm'
                        });
                        
                        // Mark as processed
                        processedData.processedStellarTxIds.push(event.id);
                        if (processedData.processedStellarTxIds.length > 1000) {
                            processedData.processedStellarTxIds = processedData.processedStellarTxIds.slice(-1000);
                        }
                        
                    } catch (parseError) {
                        console.error('   Error parsing event:', parseError.message);
                    }
                    
                    console.log('============================================\n');
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
// Uses polling instead of filters (Moonbase doesn't support long-running filters)
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
                console.log(`   Amount: ${ethers.formatEther(amount)} DEV`);
                
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
                
                // Calculate XLM amount to release (DEV to XLM, 1:1 for simplicity)
                const devAmount = parseFloat(ethers.formatEther(amount));
                const xlmLoanAmount = devAmount * CONFIG.LTV_RATIO;
                
                console.log(`   Stellar Destination: ${stellarAddress || 'NOT PROVIDED'}`);
                console.log(`   Loan Amount (${CONFIG.LTV_RATIO * 100}% LTV): ${xlmLoanAmount} XLM`);
                
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
                
                // Mark as processed
                processedData.processedEvmTxIds.push(txHash);
                if (processedData.processedEvmTxIds.length > 1000) {
                    processedData.processedEvmTxIds = processedData.processedEvmTxIds.slice(-1000);
                }
                
                console.log('============================================\n');
            }
            
            // Update last block
            if (currentBlock > processedData.lastEvmBlock) {
                processedData.lastEvmBlock = currentBlock;
                saveProcessedEvents(processedData);
            }
            
        } catch (e) {
            // Silently ignore polling errors
            if (!e.message?.includes('Filter')) {
                console.error('EVM polling error:', e.message);
            }
        }
    }, CONFIG.POLL_INTERVAL);
}

// ============================================
// RELEASE LIQUIDITY ON EVM (Moonbase)
// ============================================
async function releaseOnEvm(evm, eventData) {
    if (!evm) {
        console.log('⚠️  EVM not configured. Would release:');
        console.log(`   To: ${eventData.evmAddress}`);
        console.log(`   Amount: ${ethers.formatEther(eventData.loanAmountWei)} DEV`);
        return;
    }
    
    const { poolContract, wallet } = evm;
    
    console.log(`💸 Releasing liquidity on Moonbase...`);
    console.log(`   To: ${eventData.evmAddress}`);
    console.log(`   Amount: ${ethers.formatEther(eventData.loanAmountWei)} DEV`);
    
    try {
        // Check pool balance first
        const poolBalance = await poolContract.getBalance();
        if (poolBalance < eventData.loanAmountWei) {
            console.error(`❌ Insufficient pool balance: ${ethers.formatEther(poolBalance)} DEV`);
            return;
        }
        
        // Call releaseLiquidity on EVM pool
        const tx = await poolContract.releaseLiquidity(
            eventData.evmAddress,
            eventData.loanAmountWei
        );
        
        console.log(`   TX Hash: ${tx.hash}`);
        console.log(`   Waiting for confirmation...`);
        
        const receipt = await tx.wait();
        console.log(`✅ EVM TX confirmed in block ${receipt.blockNumber}`);
        
    } catch (e) {
        console.error(`❌ EVM TX failed: ${e.message}`);
    }
}

// ============================================
// RELEASE LIQUIDITY ON STELLAR
// ============================================
async function releaseOnStellar(stellar, eventData) {
    if (!stellar) {
        console.log('⚠️  Stellar not configured. Would release:');
        console.log(`   To: ${eventData.stellarAddress}`);
        console.log(`   Amount: ${eventData.loanAmountXlm} XLM`);
        return;
    }
    
    const { server, keypair } = stellar;
    
    console.log(`💸 Releasing liquidity on Stellar...`);
    console.log(`   To: ${eventData.stellarAddress}`);
    console.log(`   Amount: ${eventData.loanAmountXlm} XLM`);
    
    try {
        // Load the relayer's account
        const account = await server.getAccount(keypair.publicKey());
        
        // Build transaction to send XLM
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
        
        // Sign and submit
        transaction.sign(keypair);
        const response = await server.sendTransaction(transaction);
        
        console.log(`   TX Hash: ${response.hash}`);
        console.log(`✅ Stellar TX submitted`);
        
    } catch (e) {
        console.error(`❌ Stellar TX failed: ${e.message}`);
    }
}

// ============================================
// MAIN
// ============================================
async function main() {
    console.log('');
    console.log('🌉 ═══════════════════════════════════════════');
    console.log('   POLAR BRIDGE RELAYER');
    console.log('   Stellar ↔ Moonbase Alpha Bidirectional Bridge');
    console.log('═══════════════════════════════════════════════');
    console.log('');
    
    // Load processed events
    const processedData = loadProcessedEvents();
    
    // Setup EVM (Moonbase Alpha)
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
        console.log('   • Stellar (XLM) → Moonbase (DEV)');
        console.log('   • Moonbase (DEV) → Stellar (XLM)');
    } else if (stellar) {
        console.log('   • Stellar (XLM) → (EVM not configured)');
    } else if (evm) {
        console.log('   • Moonbase (DEV) → (Stellar not configured)');
    }
    console.log('');
    console.log('Press Ctrl+C to stop.');
    console.log('');
}

main().catch(console.error);
