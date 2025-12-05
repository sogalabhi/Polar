#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, Symbol, token};

/// Storage keys for the contract
#[contracttype]
pub enum DataKey {
    Admin,
    LockedBalance(Address),
    TokenAddress,
}

#[contract]
pub struct VaultContract;

#[contractimpl]
impl VaultContract {
    /// Initialize the contract with the admin address and USDC token address
    pub fn init(env: Env, admin: Address, token_address: Address) {
        // Check if already initialized
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("Contract already initialized");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::TokenAddress, &token_address);
    }

    /// User deposits USDC, we lock it and emit an event
    /// 
    /// # Arguments
    /// * `from` - The address depositing USDC
    /// * `amount` - Amount of USDC to lock (in smallest units)
    /// * `polkadot_address` - The user's Polkadot address to receive liquidity
    pub fn deposit(env: Env, from: Address, amount: i128, polkadot_address: Symbol) {
        from.require_auth();
        
        // Get the token address from storage
        let token_addr: Address = env.storage().instance().get(&DataKey::TokenAddress).unwrap();
        
        // Transfer USDC from user to this contract
        let client = token::Client::new(&env, &token_addr);
        let contract_address = env.current_contract_address();
        
        client.transfer(&from, &contract_address, &amount);

        // Update locked balance for user
        let current_balance = Self::get_locked_balance(env.clone(), from.clone());
        let new_balance = current_balance + amount;
        env.storage().persistent().set(&DataKey::LockedBalance(from.clone()), &new_balance);

        // Emit event: ["lock", polkadot_address] -> (from, amount)
        let topic = (Symbol::new(&env, "lock"), polkadot_address);
        env.events().publish(topic, (from, amount));
    }

    /// Admin (Relayer) unlocks USDC to send back to user (if loan repaid)
    /// 
    /// # Arguments
    /// * `to` - The address to receive unlocked USDC
    /// * `amount` - Amount of USDC to unlock
    pub fn unlock(env: Env, to: Address, amount: i128) {
        // Verify admin authorization
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();

        // Check that user has enough locked balance
        let current_balance = Self::get_locked_balance(env.clone(), to.clone());
        if current_balance < amount {
            panic!("Insufficient locked balance");
        }

        // Get the token address from storage
        let token_addr: Address = env.storage().instance().get(&DataKey::TokenAddress).unwrap();
        
        let client = token::Client::new(&env, &token_addr);
        let contract_address = env.current_contract_address();
        
        // Transfer USDC back to user
        client.transfer(&contract_address, &to, &amount);

        // Update locked balance
        let new_balance = current_balance - amount;
        env.storage().persistent().set(&DataKey::LockedBalance(to.clone()), &new_balance);

        // Emit unlock event
        let topic = (Symbol::new(&env, "unlock"),);
        env.events().publish(topic, (to, amount));
    }

    /// Get the locked balance for a specific user
    pub fn get_locked_balance(env: Env, user: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::LockedBalance(user))
            .unwrap_or(0)
    }

    /// Get the admin address
    pub fn get_admin(env: Env) -> Address {
        env.storage().instance().get(&DataKey::Admin).unwrap()
    }

    /// Get the token address
    pub fn get_token(env: Env) -> Address {
        env.storage().instance().get(&DataKey::TokenAddress).unwrap()
    }
}
