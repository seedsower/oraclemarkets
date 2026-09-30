//! Resolve the bet vault's market. Only `bet_vault.resolver`. The vault PDA is
//! `market.authority`, so this is the only resolution path for that market
//! (`resolve_market` needs the PDA to sign, which no key can).

use anchor_lang::prelude::*;

use crate::accrual;
use crate::errors::PmAmmError;
use crate::state::{BetVault, Market, Side};

#[derive(Accounts)]
pub struct ResolveBetVault<'info> {
    pub resolver: Signer<'info>,

    #[account(
        seeds = [BetVault::SEED, bet_vault.vault_id.to_le_bytes().as_ref()],
        bump = bet_vault.bump,
        constraint = bet_vault.resolver == resolver.key() @ PmAmmError::Unauthorized,
    )]
    pub bet_vault: Box<Account<'info, BetVault>>,

    #[account(
        mut,
        constraint = market.key() == bet_vault.market @ PmAmmError::InvalidMarket,
        constraint = market.authority == bet_vault.key() @ PmAmmError::Unauthorized,
    )]
    pub market: Box<Account<'info, Market>>,
}

pub fn handler(ctx: Context<ResolveBetVault>, winning_side: Side) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require!(
        ctx.accounts.bet_vault.launched,
        PmAmmError::VaultNotLaunched
    );
    let market = &mut ctx.accounts.market;
    require!(!market.resolved, PmAmmError::MarketAlreadyResolved);
    require!(now >= market.end_ts, PmAmmError::MarketNotExpired);

    // Final accrual — releases all remaining reserves to LPs (same as resolve_market).
    accrual::accrue_first(market, now)?;
    market.resolved = true;
    market.set_winning_side(winning_side);
    msg!(
        "Bet vault market {} resolved: {:?}",
        market.market_id,
        winning_side
    );
    Ok(())
}
