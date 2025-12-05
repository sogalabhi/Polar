#![cfg_attr(not(feature = "std"), no_std, no_main)]

#[ink::contract]
mod ink_pool {
    /// The Ink! Pool Contract for PolkaBridge
    /// Holds liquidity (DOT) and releases it to users when the relayer calls release_liquidity
    #[ink(storage)]
    pub struct InkPool {
        /// Admin address (the relayer that can call release_liquidity)
        admin: AccountId,
        /// Total liquidity released
        total_released: Balance,
    }

    /// Event emitted when liquidity is released to a user
    #[ink(event)]
    pub struct LiquidityReleased {
        #[ink(topic)]
        to: AccountId,
        amount: Balance,
    }

    /// Event emitted when the contract receives funds
    #[ink(event)]
    pub struct FundsReceived {
        #[ink(topic)]
        from: AccountId,
        amount: Balance,
    }

    impl InkPool {
        /// Constructor: Initialize with admin (relayer) address
        #[ink(constructor)]
        pub fn new(admin: AccountId) -> Self {
            Self {
                admin,
                total_released: 0,
            }
        }

        /// Constructor: Initialize with caller as admin
        #[ink(constructor)]
        pub fn default() -> Self {
            Self {
                admin: Self::env().caller(),
                total_released: 0,
            }
        }

        /// Receive funds into the contract (anyone can fund it)
        /// This is a payable message - users/deployer send DOT here to fund the pool
        #[ink(message, payable)]
        pub fn fund(&mut self) {
            let caller = self.env().caller();
            let amount = self.env().transferred_value();
            
            self.env().emit_event(FundsReceived {
                from: caller,
                amount,
            });
        }

        /// Release liquidity to a user (admin/relayer only)
        /// This is called by the relayer when a lock event is detected on Stellar
        /// Returns true on success, panics on failure
        #[ink(message)]
        pub fn release_liquidity(&mut self, to: AccountId, amount: Balance) -> bool {
            // Only admin (relayer) can call this
            let caller = self.env().caller();
            assert!(caller == self.admin, "Only admin can release liquidity");

            // Check contract has enough balance
            let contract_balance = self.env().balance();
            assert!(contract_balance >= amount, "Insufficient contract balance");

            // Transfer native DOT from contract to user
            self.env().transfer(to, amount).expect("Transfer failed");

            // Update total released
            self.total_released = self.total_released.saturating_add(amount);

            // Emit event
            self.env().emit_event(LiquidityReleased { to, amount });

            true
        }

        /// Get the admin address
        #[ink(message)]
        pub fn get_admin(&self) -> AccountId {
            self.admin
        }

        /// Get the contract's current balance
        #[ink(message)]
        pub fn get_balance(&self) -> Balance {
            self.env().balance()
        }

        /// Get total liquidity released so far
        #[ink(message)]
        pub fn get_total_released(&self) -> Balance {
            self.total_released
        }

        /// Update admin (current admin only)
        #[ink(message)]
        pub fn set_admin(&mut self, new_admin: AccountId) {
            assert!(self.env().caller() == self.admin, "Only admin can set new admin");
            self.admin = new_admin;
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[ink::test]
        fn new_works() {
            let accounts = ink::env::test::default_accounts::<ink::env::DefaultEnvironment>();
            let contract = InkPool::new(accounts.alice);
            assert_eq!(contract.get_admin(), accounts.alice);
        }
    }
}
