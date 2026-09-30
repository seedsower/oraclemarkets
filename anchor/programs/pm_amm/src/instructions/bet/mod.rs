//! Bet Vault v2 instructions — "winner takes the pot, the pot is the liquidity".
//!
//! Lifecycle: `initialize_bet_vault` → `bet_commit`* → `launch_bet_vault`
//! (authority/resolver) → trading on the launched market → `resolve_bet_vault`
//! (resolver) → `settle_bet_vault` (permissionless) → `claim_bet` per committer.
//! `refund_bet` returns stakes when the vault can never launch.
//!
//! New account types only (`BetVault`, `BetPosition`); the Sprint 22/23
//! `CommitmentVault*` accounts and instructions are untouched.

pub mod bet_commit;
pub mod claim_bet;
pub mod initialize_bet_vault;
pub mod launch_bet_vault;
pub mod refund_bet;
pub mod resolve_bet_vault;
pub mod settle_bet_vault;
pub mod void_bet_vault;

#[allow(ambiguous_glob_reexports)]
pub use bet_commit::*;
#[allow(ambiguous_glob_reexports)]
pub use claim_bet::*;
#[allow(ambiguous_glob_reexports)]
pub use initialize_bet_vault::*;
#[allow(ambiguous_glob_reexports)]
pub use launch_bet_vault::*;
#[allow(ambiguous_glob_reexports)]
pub use refund_bet::*;
#[allow(ambiguous_glob_reexports)]
pub use resolve_bet_vault::*;
#[allow(ambiguous_glob_reexports)]
pub use settle_bet_vault::*;
#[allow(ambiguous_glob_reexports)]
pub use void_bet_vault::*;

use crate::state::BetVault;

/// Signer seeds of a bet vault PDA.
pub(crate) fn bet_vault_seeds<'a>(id_bytes: &'a [u8; 8], bump: &'a [u8; 1]) -> [&'a [u8]; 3] {
    [BetVault::SEED, id_bytes.as_ref(), bump.as_ref()]
}
