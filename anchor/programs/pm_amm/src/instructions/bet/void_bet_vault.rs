//! Fallback when the resolver never shows up: after `market.end_ts +
//! void_grace_secs` with the market still unresolved, ANYONE can void the
//! vault. Every committer is then refunded pro-rata to their stake via
//! `claim_bet` — no winner, no loser.
//!
//! The vault's claims on the market are worth the same on both sides (that is
//! exactly what the entry-side surplus fix restores), so the whole liquidity
//! slice converts back to collateral as complete pairs without knowing the
//! outcome — `min(yes_owed, no_owed)` collateral, the pair-redemption value.
//!
//! Outside traders holding a single side get nothing, which is inherent to a
//! void: with no outcome, only complete pairs have a value.

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use fixed::types::I80F48;

use crate::accrual;
use crate::errors::PmAmmError;
use crate::state::{BetVault, LpPosition, Market};

#[derive(Accounts)]
pub struct VoidBetVault<'info> {
    pub signer: Signer<'info>,

    #[account(
        mut,
        seeds = [BetVault::SEED, bet_vault.vault_id.to_le_bytes().as_ref()],
        bump = bet_vault.bump,
    )]
    pub bet_vault: Box<Account<'info, BetVault>>,

    #[account(mut, constraint = market.key() == bet_vault.market @ PmAmmError::InvalidMarket)]
    pub market: Box<Account<'info, Market>>,

    #[account(mut, constraint = market_vault.key() == market.vault @ PmAmmError::InvalidVault)]
    pub market_vault: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        associated_token::mint = bet_vault.collateral_mint,
        associated_token::authority = bet_vault,
    )]
    pub vault_collateral: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        seeds = [LpPosition::SEED, market.key().as_ref(), bet_vault.key().as_ref()],
        bump = vault_lp_position.bump,
    )]
    pub vault_lp_position: Box<Account<'info, LpPosition>>,

    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<VoidBetVault>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    {
        let v = &ctx.accounts.bet_vault;
        require!(v.launched, PmAmmError::VaultNotLaunched);
        require!(!v.settled, PmAmmError::BetVaultAlreadySettled);
        let market = &ctx.accounts.market;
        require!(!market.resolved, PmAmmError::MarketAlreadyResolved);
        require!(
            now >= market.end_ts.saturating_add(v.void_grace_secs),
            PmAmmError::VoidTooEarly
        );
    }

    let owed = collect_pair_claim(
        &mut ctx.accounts.market,
        &mut ctx.accounts.vault_lp_position,
        now,
    )?;
    require!(
        ctx.accounts.market_vault.amount >= owed,
        PmAmmError::InsufficientVault
    );

    if owed > 0 {
        let m = &ctx.accounts.market;
        let id_bytes = m.market_id.to_le_bytes();
        let bump = [m.bump];
        let seeds: &[&[u8]] = &[Market::SEED, &id_bytes, &bump];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                Transfer {
                    from: ctx.accounts.market_vault.to_account_info(),
                    to: ctx.accounts.vault_collateral.to_account_info(),
                    authority: ctx.accounts.market.to_account_info(),
                },
                &[seeds],
            ),
            owed,
        )?;
    }
    ctx.accounts.vault_collateral.reload()?;

    let v = &mut ctx.accounts.bet_vault;
    v.voided = true;
    v.settled = true;
    v.payout_pool = ctx.accounts.vault_collateral.amount;
    msg!(
        "Bet vault voided (no resolution): recovered {}, refund pool {}",
        owed,
        v.payout_pool
    );
    Ok(())
}

/// Collateral the vault's LP position is worth as complete pairs:
/// `min(yes_owed, no_owed)` over residuals + entry-side surplus. Consumes the
/// position's claims, so the market owes strictly less on BOTH sides
/// afterwards while its vault drops by `min` — solvency is preserved.
fn collect_pair_claim(market: &mut Market, lp: &mut LpPosition, now: i64) -> Result<u64> {
    accrual::accrue_first(market, now)?;
    let (pending_yes, pending_no) = accrual::compute_lp_pending(
        I80F48::from_bits(lp.shares as i128),
        I80F48::from_bits(lp.yes_per_share_checkpoint as i128),
        I80F48::from_bits(lp.no_per_share_checkpoint as i128),
        market.cum_yes_per_share_fixed(),
        market.cum_no_per_share_fixed(),
    );
    lp.yes_per_share_checkpoint = market.cum_yes_per_share;
    lp.no_per_share_checkpoint = market.cum_no_per_share;
    let (excess_yes, excess_no) = lp.take_excess(market);
    let yes = pending_yes
        .max(I80F48::ZERO)
        .to_num::<u64>()
        .saturating_add(excess_yes);
    let no = pending_no
        .max(I80F48::ZERO)
        .to_num::<u64>()
        .saturating_add(excess_no);
    Ok(yes.min(no))
}
