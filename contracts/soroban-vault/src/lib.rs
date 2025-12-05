#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, Symbol, String, token};

/// Storage keys for the contract
#[contracttype]
pub enum DataKey {
    Admin,
    LockedBalance(Address),
    TotalLocked,
}

#[contract]
pub struct VaultContract;

#[contractimpl]
impl VaultContract {
    /// Initialize the contract with the admin address
    /// Admin is typically the relayer that will release funds on the other chain
    pub fn init(env: Env, admin: Address) {
        // Check if already initialized
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("Contract already initialized");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::TotalLocked, &0i128);
    }

    /// User deposits native XLM to lock as collateral
    /// Emits a "lock" event with the EVM destination address
    /// 
    /// # Arguments
    /// * `from` - The Stellar address depositing XLM
    /// * `amount` - Amount of XLM to lock (in stroops, 1 XLM = 10^7 stroops)
    /// * `evm_address` - The user's EVM address (e.g., "0x1234...") to receive liquidity on Paseo Asset Hub
    pub fn lock(env: Env, from: Address, amount: i128, evm_address: String) {
        from.require_auth();
        
        if amount <= 0 {
            panic!("Amount must be positive");
        }

        // Transfer native XLM from user to this contract
        let contract_address = env.current_contract_address();
        
        // Use the native token client (XLM)
        let xlm_address = Address::from_string(&String::from_str(&env, "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC"));
        let xlm_client = token::Client::new(&env, &xlm_address);
        
        xlm_client.transfer(&from, &contract_address, &amount);

        // Update locked balance for user
        let current_balance = Self::get_locked_balance(env.clone(), from.clone());
        let new_balance = current_balance + amount;
        env.storage().persistent().set(&DataKey::LockedBalance(from.clone()), &new_balance);

        // Update total locked
        let total: i128 = env.storage().instance().get(&DataKey::TotalLocked).unwrap_or(0);
        env.storage().instance().set(&DataKey::TotalLocked, &(total + amount));

        // Emit event: ["lock", evm_address] -> (from, amount)
        // The relayer listens for this to release funds on EVM
        let topic = (Symbol::new(&env, "lock"), evm_address);
        env.events().publish(topic, (from, amount));
    }

    /// Admin/Relayer releases XLM to a user (when they repay on EVM side)
    /// 
    /// # Arguments
    /// * `to` - The Stellar address to receive XLM
    /// * `amount` - Amount of XLM to release (in stroops)
    pub fn release(env: Env, to: Address, amount: i128) {
        // Verify admin authorization
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();

        if amount <= 0 {
            panic!("Amount must be positive");
        }

        // Use the native token client (XLM)
        let xlm_address = Address::from_string(&String::from_str(&env, "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC"));
        let xlm_client = token::Client::new(&env, &xlm_address);
        
        let contract_address = env.current_contract_address();
        
        // Transfer XLM to user
        xlm_client.transfer(&contract_address, &to, &amount);

        // Emit release event
        let topic = (Symbol::new(&env, "release"),);
        env.events().publish(topic, (to, amount));
    }

    /// Admin unlocks collateral back to user (loan repaid)
    /// 
    /// # Arguments
    /// * `to` - The address to receive unlocked XLM
    /// * `amount` - Amount of XLM to unlock
    pub fn unlock(env: Env, to: Address, amount: i128) {
        // Verify admin authorization
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();

        // Check that user has enough locked balance
        let current_balance = Self::get_locked_balance(env.clone(), to.clone());
        if current_balance < amount {
            panic!("Insufficient locked balance");
        }

        // Use the native token client (XLM)
        let xlm_address = Address::from_string(&String::from_str(&env, "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC"));
        let xlm_client = token::Client::new(&env, &xlm_address);
        
        let contract_address = env.current_contract_address();
        
        // Transfer XLM back to user
        xlm_client.transfer(&contract_address, &to, &amount);

        // Update locked balance
        let new_balance = current_balance - amount;
        env.storage().persistent().set(&DataKey::LockedBalance(to.clone()), &new_balance);

        // Update total locked
        let total: i128 = env.storage().instance().get(&DataKey::TotalLocked).unwrap_or(0);
        env.storage().instance().set(&DataKey::TotalLocked, &(total - amount));

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

    /// Get total locked XLM in the vault
    pub fn get_total_locked(env: Env) -> i128 {
        env.storage().instance().get(&DataKey::TotalLocked).unwrap_or(0)
    }

    /// Get the admin address
    pub fn get_admin(env: Env) -> Address {
        env.storage().instance().get(&DataKey::Admin).unwrap()
    }

    /// Update admin (only current admin can call)
    pub fn set_admin(env: Env, new_admin: Address) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &new_admin);
    }
}
