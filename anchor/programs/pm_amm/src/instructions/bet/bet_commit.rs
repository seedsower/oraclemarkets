//! Stake collateral on YES or NO before `commit_end_ts`. Any number of times;
//! restricted to the allowlist when one is set.

use anchor_lang::prelude::*;
use anchor_spl::token::{transfer, Token, TokenAccount, Transfer};

use crate::errors::PmAmmError;
use crate::state::{BetPosition, BetVault, Side, MIN_COMMIT_USDC};

#[derive(Accounts)]
pub struct BetCommit<'info> {
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
        init_if_needed,
        payer = signer,
        space = BetPosition::LEN,
        seeds = [BetPosition::SEED, bet_vault.key().as_ref(), signer.key().as_ref()],
        bump,
    )]
    pub position: Box<Account<'info, BetPosition>>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<BetCommit>, side: Side, amount: u64) -> Result<()> {
    require!(amount >= MIN_COMMIT_USDC, PmAmmError::CommitTooSmall);
    let now = Clock::get()?.unix_timestamp;
    let signer = ctx.accounts.signer.key();
    {
        let v = &ctx.accounts.bet_vault;
        require!(!v.launched, PmAmmError::VaultAlreadyLaunched);
        require!(now < v.commit_end_ts, PmAmmError::CommitPhaseClosed);
        require!(v.is_allowed(&signer), PmAmmError::NotOnAllowlist);
    }

    transfer(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            Transfer {
                from: ctx.accounts.user_collateral.to_account_info(),
                to: ctx.accounts.vault_collateral.to_account_info(),
                authority: ctx.accounts.signer.to_account_info(),
            },
        ),
        amount,
    )?;

    let v = &mut ctx.accounts.bet_vault;
    let pos = &mut ctx.accounts.position;
    if pos.owner == Pubkey::default() {
        pos.vault = v.key();
        pos.owner = signer;
        pos.bump = ctx.bumps.position;
        v.commit_count = v.commit_count.saturating_add(1);
    }
    let add = |a: u64| a.checked_add(amount).ok_or(PmAmmError::MathOverflow);
    match side {
        Side::Yes => {
            pos.yes_amount = add(pos.yes_amount)?;
            v.yes_total = add(v.yes_total)?;
        }
        Side::No => {
            pos.no_amount = add(pos.no_amount)?;
            v.no_total = add(v.no_total)?;
        }
    }
    msg!(
        "Bet {:?} {} (yes={} no={})",
        side,
        amount,
        v.yes_total,
        v.no_total
    );
    Ok(())
}
