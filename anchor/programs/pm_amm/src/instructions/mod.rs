//! Instruction handlers for pm-AMM.

// Every module exports a `handler`, so the glob re-exports below (needed for
// the `#[derive(Accounts)]` structs and their generated client modules) always
// collide on that name. `lib.rs` calls each handler by its full path. A
// module-level allow: an item-level one only covered the first `pub use`, and
// newer toolchains (rustc 1.98, CI) flag the others under `-D warnings`.
#![allow(ambiguous_glob_reexports)]

pub mod accrue;
pub mod bet;
pub mod claim_lp_residuals;
pub mod claim_winnings;
pub mod deposit_liquidity;
pub mod group;
pub mod initialize_market;
pub mod redeem_pair;
pub mod resolve_market;
pub mod suggest_l_zero;
pub mod swap;
pub mod vault;
pub mod withdraw_liquidity;

pub use accrue::*;
pub use bet::*;
pub use claim_lp_residuals::*;
pub use claim_winnings::*;
pub use deposit_liquidity::*;
pub use group::*;
pub use initialize_market::*;
pub use redeem_pair::*;
pub use resolve_market::*;
pub use suggest_l_zero::*;
pub use swap::*;
pub use vault::*;
pub use withdraw_liquidity::*;
