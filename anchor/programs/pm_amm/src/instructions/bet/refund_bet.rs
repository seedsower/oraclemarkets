//! Refund a committer 1:1 when the bet vault can never launch: after the commit
//! phase, while unlaunched, and if it is below `min_total`, has invalid odds
//! (one-sided or outside [1%, 99%]), or the launch window has closed
//! (`market_end_ts <= now + 300`). A healthy vault can't be griefed into
//! refunds while it's still launchable. The first refund locks launch.

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use super::bet_vault_seeds;
use crate::errors::PmAmmError;
use crate::state::{BetPosition, BetVault};

#[derive(Accounts)]
pub struct RefundBet<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,

    #[account(
        mut,
        seeds = [BetVault::SEED, bet_vault.vault_id.to_le_bytes().as_ref()],
        bump = bet_vault.bump,
    )]
    pub bet_vault: Box<Account<'info, BetVault>>,

    #[account(
        mut,
        associated_token::mint = bet_vault.collateral_mint,
        associated_token::authority = bet_vault,
    )]
    pub vault_collateral: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        constraint = user_collateral.mint == bet_vault.collateral_mint @ PmAmmError::InvalidVault,
        constraint = user_collateral.owner == signer.key() @ PmAmmError::Unauthorized,
    )]
    pub user_collateral: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        close = signer,
        seeds = [BetPosition::SEED, bet_vault.key().as_ref(), signer.key().as_ref()],
        bump = position.bump,
        constraint = position.owner == signer.key() @ PmAmmError::Unauthorized,
    )]
    pub position: Box<Account<'info, BetPosition>>,

    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<RefundBet>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let (yes, no) = (
        ctx.accounts.position.yes_amount,
        ctx.accounts.position.no_amount,
    );
    let v = &mut ctx.accounts.bet_vault;
    require!(!v.launched, PmAmmError::VaultAlreadyLaunched);
    require!(now >= v.commit_end_ts, PmAmmError::CommitPhaseNotEnded);
    let never_launchable = v.refunding
        || v.total() < v.min_total
        || !v.has_valid_odds()
        || now.saturating_add(300) >= v.market_end_ts;
    require!(never_launchable, PmAmmError::RefundNotAvailable);
    let amount = yes.saturating_add(no);
    require!(amount > 0, PmAmmError::NoCommitFunds);

    v.refunding = true;
    v.yes_total = v.yes_total.saturating_sub(yes);
    v.no_total = v.no_total.saturating_sub(no);
    let (id_bytes, bump) = (v.vault_id.to_le_bytes(), [v.bump]);
    let seeds = bet_vault_seeds(&id_bytes, &bump);
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            Transfer {
                from: ctx.accounts.vault_collateral.to_account_info(),
                to: ctx.accounts.user_collateral.to_account_info(),
                authority: ctx.accounts.bet_vault.to_account_info(),
            },
            &[&seeds],
        ),
        amount,
    )?;
    msg!("Bet refund {}: {}", ctx.accounts.signer.key(), amount);
    Ok(())
}
