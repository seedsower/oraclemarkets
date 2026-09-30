//! Claim a settled bet. Winners get `payout_pool × stake / winning_total`
//! (the claim completing the winning side sweeps the rounding dust); losers get
//! 0. On a vault voided by `void_bet_vault` (no resolution), every committer is
//! refunded pro-rata to their total stake instead. The position is closed
//! either way (rent back to the committer).

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use super::bet_vault_seeds;
use crate::errors::PmAmmError;
use crate::state::{bet_payout, BetPosition, BetVault};

#[derive(Accounts)]
pub struct ClaimBet<'info> {
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

pub fn handler(ctx: Context<ClaimBet>) -> Result<()> {
    let v = &mut ctx.accounts.bet_vault;
    require!(v.settled, PmAmmError::BetVaultNotSettled);
    let (stake, basis) = v.payout_basis(&ctx.accounts.position);
    let payout = bet_payout(v.payout_pool, stake, basis, v.claimed_stake, v.paid_out);
    v.claimed_stake = v.claimed_stake.saturating_add(stake);
    v.paid_out = v.paid_out.saturating_add(payout);
    let (id_bytes, bump) = (v.vault_id.to_le_bytes(), [v.bump]);

    if payout > 0 {
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
            payout,
        )?;
    }
    let voided = ctx.accounts.bet_vault.voided;
    msg!(
        "Bet claim {}: stake {} ({}) -> {}",
        ctx.accounts.signer.key(),
        stake,
        if voided {
            "voided refund"
        } else {
            "winning side"
        },
        payout
    );
    Ok(())
}
