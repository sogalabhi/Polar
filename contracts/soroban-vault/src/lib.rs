#![no_std]
use soroban_sdk::{contract, contractimpl, Address, Env, Symbol, token};

#[contract]
pub struct VaultContract;

#[contractimpl]
impl VaultContract {
    // Initialize the contract with the admin address
    pub fn init(env: Env, admin: Address) {
        // In a real app, check if already initialized
        env.storage().instance().set(&Symbol::new(&env, "admin"), &admin);
    }

    // User deposits USDC, we lock it and emit an event
    pub fn deposit(env: Env, from: Address, token: Address, amount: i128, polkadot_address: Symbol) {
        from.require_auth();
        
        // Transfer USDC from user to this contract
        let client = token::Client::new(&env, &token);
        let contract_address = env.current_contract_address();
        
        client.transfer(&from, &contract_address, &amount);

        // Emit event: ["lock", polkadot_address] -> amount
        let topic = (Symbol::new(&env, "lock"), polkadot_address);
        env.events().publish(topic, amount);
    }

    // Admin (Relayer) unlocks USDC to send back to user (if loan repaid)
    pub fn unlock(env: Env, to: Address, token: Address, amount: i128) {
        let admin: Address = env.storage().instance().get(&Symbol::new(&env, "admin")).unwrap();
        admin.require_auth();

        let client = token::Client::new(&env, &token);
        let contract_address = env.current_contract_address();
        
        client.transfer(&contract_address, &to, &amount);
    }
}
