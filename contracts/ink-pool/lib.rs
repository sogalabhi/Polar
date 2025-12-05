#![cfg_attr(not(feature = "std"), no_std, no_main)]

#[ink::contract]
mod ink_pool {
    #[ink(storage)]
    pub struct InkPool {
        admin: AccountId,
    }

    #[ink(event)]
    pub struct LiquidityReleased {
        #[ink(topic)]
        to: AccountId,
        amount: Balance,
    }

    impl InkPool {
        #[ink(constructor)]
        pub fn new(admin: AccountId) -> Self {
            Self { admin }
        }

        // Only the Relayer (Admin) can call this to send DOT to the user
        #[ink(message)]
        pub fn release_liquidity(&mut self, to: AccountId, amount: Balance) -> Result<(), ()> {
            let caller = self.env().caller();
            if caller != self.admin {
                return Err(());
            }

            // Transfer native DOT from contract to user
            if self.env().transfer(to, amount).is_err() {
                return Err(());
            }

            self.env().emit_event(LiquidityReleased {
                to,
                amount,
            });

            Ok(())
        }
        
        #[ink(message)]
        pub fn get_admin(&self) -> AccountId {
            self.admin
        }
    }
}
