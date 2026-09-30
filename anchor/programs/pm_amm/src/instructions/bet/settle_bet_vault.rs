//! Settle a resolved bet vault. Permissionless.
//!
//! Collects everything the vault PDA is owed on its market — the winning side
//! of its LP residuals (all reserves were released at resolution) plus its
//! entry-side surplus — as USDC straight from the market vault (equivalent to
//! minting those winning tokens and redeeming them 1:1 via `claim_winnings`).
//! The vault's collateral balance (kept USDC + creator fees + this payout) is
//! then frozen as `payout_pool`, split by `claim_bet` among the winning side.

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use fixed::types::I80F48;

use crate::accrual;
use crate::errors::PmAmmError;
use crate::state::{BetVault, LpPosition, Market, Side};

#[derive(Accounts)]
pub struct SettleBetVault<'info> {
    pub signer: Signer<'info>,

    #[account(
        mut,
        seeds = [BetVault::SEED, bet_vault.vault_id.to_le_bytes().as_ref()],
        bump = bet_vault.bump,
    )]
    pub bet_vault: Box<Account<'info, BetVault>>,

    #[account(
        mut,
        constraint = market.key() == bet_vault.market @ PmAmmError::InvalidMarket,
    )]
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

pub fn handler(ctx: Context<SettleBetVault>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require!(
        ctx.accounts.bet_vault.launched,
        PmAmmError::VaultNotLaunched
    );
    require!(
        !ctx.accounts.bet_vault.settled,
        PmAmmError::BetVaultAlreadySettled
    );
    require!(ctx.accounts.market.resolved, PmAmmError::MarketNotResolved);
    let side = ctx
        .accounts
        .market
        .get_winning_side()
        .ok_or(PmAmmError::MarketNotResolved)?;

    let owed = collect_winning_claim(
        &mut ctx.accounts.market,
        &mut ctx.accounts.vault_lp_position,
        side,
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
    v.winning_side = if side == Side::Yes { 1 } else { 2 };
    v.payout_pool = ctx.accounts.vault_collateral.amount;
    v.settled = true;
    msg!(
        "Bet vault settled: {:?} wins, collected {} from market, pool={}",
        side,
        owed,
        v.payout_pool
    );
    Ok(())
}

/// Winning-side tokens the vault's LP position is owed (residuals + surplus),
/// consumed from the position. Losing-side claims are simply dropped.
fn collect_winning_claim(
    market: &mut Market,
    lp: &mut LpPosition,
    side: Side,
    now: i64,
) -> Result<u64> {
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
    let (pending, excess) = match side {
        Side::Yes => (pending_yes, excess_yes),
        Side::No => (pending_no, excess_no),
    };
    Ok(pending
        .max(I80F48::ZERO)
        .to_num::<u64>()
        .saturating_add(excess))
}
