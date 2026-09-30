//! Open a Bet Vault. Anyone can call; the caller becomes `authority`.
//!
//! Creates the `BetVault` PDA and its collateral ATA (owned by the PDA). The
//! ATA holds the commits, then the non-LP part of the pot, the creator half of
//! swap fees (the PDA is `market.authority`), and finally the payout pool.

use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::errors::PmAmmError;
use crate::state::{
    BetVault, DEFAULT_VOID_GRACE_SECS, MAX_BET_ALLOWLIST, MAX_COMMIT_DURATION_SECS,
    MAX_MARKET_DURATION_SECS, MAX_VOID_GRACE_SECS, MIN_COMMIT_DURATION_SECS,
    MIN_MARKET_DURATION_SECS, MIN_VOID_GRACE_SECS,
};

#[derive(Accounts)]
#[instruction(vault_id: u64)]
pub struct InitializeBetVault<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = BetVault::LEN,
        seeds = [BetVault::SEED, vault_id.to_le_bytes().as_ref()],
        bump,
    )]
    pub bet_vault: Box<Account<'info, BetVault>>,

    /// Collateral mint — any SPL mint (YES/NO inherit its decimals at launch).
    pub collateral_mint: Box<Account<'info, Mint>>,

    /// The vault PDA's collateral ATA. An ATA (not a custom PDA) so the swap
    /// creator-fee account resolves to it like for any market authority.
    #[account(
        init,
        payer = authority,
        associated_token::mint = collateral_mint,
        associated_token::authority = bet_vault,
    )]
    pub vault_collateral: Box<Account<'info, TokenAccount>>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

pub fn handler(
    ctx: Context<InitializeBetVault>,
    vault_id: u64,
    name: String,
    commit_duration_secs: i64,
    market_duration_secs: i64,
    min_total: u64,
    lp_bps: u16,
    resolver: Pubkey,
    allowlist: Vec<Pubkey>,
    void_grace_secs: i64,
) -> Result<()> {
    require!(
        !name.is_empty() && name.len() <= 64,
        PmAmmError::InvalidName
    );
    require!(
        (MIN_COMMIT_DURATION_SECS..=MAX_COMMIT_DURATION_SECS).contains(&commit_duration_secs),
        PmAmmError::InvalidCommitDuration
    );
    require!(
        (MIN_MARKET_DURATION_SECS..=MAX_MARKET_DURATION_SECS).contains(&market_duration_secs),
        PmAmmError::InvalidMarketDuration
    );
    require!(min_total > 0, PmAmmError::InvalidBudget);
    require!(lp_bps <= 10_000, PmAmmError::InvalidLpBps);
    require!(
        allowlist.len() <= MAX_BET_ALLOWLIST,
        PmAmmError::AllowlistTooLong
    );
    // 0 = the 7-day default; anything else must be inside the bounds.
    let void_grace_secs = if void_grace_secs == 0 {
        DEFAULT_VOID_GRACE_SECS
    } else {
        void_grace_secs
    };
    require!(
        (MIN_VOID_GRACE_SECS..=MAX_VOID_GRACE_SECS).contains(&void_grace_secs),
        PmAmmError::InvalidVoidGrace
    );

    let now = Clock::get()?.unix_timestamp;
    let authority = ctx.accounts.authority.key();
    let v = &mut ctx.accounts.bet_vault;
    v.authority = authority;
    v.resolver = if resolver == Pubkey::default() {
        authority
    } else {
        resolver
    };
    v.vault_id = vault_id;
    v.collateral_mint = ctx.accounts.collateral_mint.key();
    let mut name_bytes = [0u8; 64];
    name_bytes[..name.len()].copy_from_slice(name.as_bytes());
    v.name = name_bytes;
    v.commit_end_ts = now + commit_duration_secs;
    v.market_end_ts = v.commit_end_ts + market_duration_secs;
    v.min_total = min_total;
    v.lp_bps = lp_bps;
    v.allowlist_len = allowlist.len() as u8;
    v.allowlist[..allowlist.len()].copy_from_slice(&allowlist);
    v.void_grace_secs = void_grace_secs;
    v.bump = ctx.bumps.bet_vault;

    msg!(
        "Bet vault {} opened: lp_bps={} allowlist={} resolver={}",
        vault_id,
        lp_bps,
        allowlist.len(),
        v.resolver
    );
    Ok(())
}
