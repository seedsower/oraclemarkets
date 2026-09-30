//! Launch the bet vault's market once the commit phase ends. Only the vault's
//! `authority` or `resolver` may launch (fixes the permissionless-launcher-
//! becomes-oracle issue of `launch_vault_market`).
//!
//! Atomically:
//!   1. Create the binary Market (+ mints, market vault, Metaplex metadata) at
//!      the odds implied by the stakes, with `market.authority = bet vault PDA`
//!      (the PDA resolves via `resolve_bet_vault` and collects the creator fee).
//!   2. Deposit `total × effective_lp_bps` as liquidity owned by the vault PDA
//!      (calibrated `max(x, y) = deposit`, entry-side surplus credited to the
//!      vault's LpPosition). The rest of the pot stays in the vault.

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};
use fixed::types::I80F48;

use super::bet_vault_seeds;
use crate::errors::PmAmmError;
use crate::instructions::initialize_market::{NO_MINT_SEED, VAULT_SEED, YES_MINT_SEED};
use crate::instructions::vault::launch_vault_market::{create_token_metadata, truncate_str};
use crate::pm_math;
use crate::state::{deposit_excess, BetVault, LpPosition, Market};

#[derive(Accounts)]
#[instruction(market_id: u64)]
pub struct LaunchBetVault<'info> {
    /// Authority or resolver — pays the rent of the new accounts.
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        mut,
        seeds = [BetVault::SEED, bet_vault.vault_id.to_le_bytes().as_ref()],
        bump = bet_vault.bump,
    )]
    pub bet_vault: Box<Account<'info, BetVault>>,

    #[account(
        init,
        payer = payer,
        space = Market::LEN,
        seeds = [Market::SEED, market_id.to_le_bytes().as_ref()],
        bump,
    )]
    pub market: Box<Account<'info, Market>>,

    #[account(constraint = collateral_mint.key() == bet_vault.collateral_mint @ PmAmmError::InvalidWinningMint)]
    pub collateral_mint: Box<Account<'info, Mint>>,

    #[account(
        init,
        payer = payer,
        mint::decimals = collateral_mint.decimals,
        mint::authority = market,
        seeds = [YES_MINT_SEED, market.key().as_ref()],
        bump,
    )]
    pub yes_mint: Box<Account<'info, Mint>>,

    #[account(
        init,
        payer = payer,
        mint::decimals = collateral_mint.decimals,
        mint::authority = market,
        seeds = [NO_MINT_SEED, market.key().as_ref()],
        bump,
    )]
    pub no_mint: Box<Account<'info, Mint>>,

    #[account(
        init,
        payer = payer,
        token::mint = collateral_mint,
        token::authority = market,
        seeds = [VAULT_SEED, market.key().as_ref()],
        bump,
    )]
    pub market_vault: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        associated_token::mint = collateral_mint,
        associated_token::authority = bet_vault,
    )]
    pub vault_collateral: Box<Account<'info, TokenAccount>>,

    /// The vault PDA's LP position on the new market.
    #[account(
        init,
        payer = payer,
        space = LpPosition::LEN,
        seeds = [LpPosition::SEED, market.key().as_ref(), bet_vault.key().as_ref()],
        bump,
    )]
    pub vault_lp_position: Box<Account<'info, LpPosition>>,

    /// CHECK: Created via CPI to Metaplex Token Metadata program.
    #[account(mut)]
    pub yes_metadata: UncheckedAccount<'info>,
    /// CHECK: idem
    #[account(mut)]
    pub no_metadata: UncheckedAccount<'info>,
    /// CHECK: Metaplex Token Metadata program.
    #[account(address = anchor_spl::metadata::mpl_token_metadata::ID)]
    pub token_metadata_program: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handler(mut ctx: Context<LaunchBetVault>, market_id: u64) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let payer = ctx.accounts.payer.key();
    let v = &ctx.accounts.bet_vault;
    require!(!v.launched, PmAmmError::VaultAlreadyLaunched);
    require!(!v.refunding, PmAmmError::RefundNotAvailable);
    require!(now >= v.commit_end_ts, PmAmmError::CommitPhaseNotEnded);
    require!(
        payer == v.authority || payer == v.resolver,
        PmAmmError::Unauthorized
    );
    require!(v.total() >= v.min_total, PmAmmError::VaultBelowMinTotal);
    require!(v.has_valid_odds(), PmAmmError::BetVaultInvalidOdds);
    require!(v.market_end_ts > now + 300, PmAmmError::InvalidDuration);

    let price_bps = v.raw_price_bps() as u16;
    let effective_lp_bps = v.effective_lp_bps();
    let lp_amount = ((v.total() as u128) * (effective_lp_bps as u128) / 10_000) as u64;

    init_market(&mut ctx, market_id, now, price_bps)?;
    init_vault_lp_position(&mut ctx);
    if lp_amount > 0 {
        bootstrap_liquidity(&mut ctx, now, price_bps, lp_amount)?;
    }
    create_metadata(&ctx)?;

    let bet_vault_key = ctx.accounts.bet_vault.key();
    let v = &mut ctx.accounts.bet_vault;
    v.launched = true;
    v.price_bps = price_bps;
    v.effective_lp_bps = effective_lp_bps;
    v.market = ctx.accounts.market.key();
    let (id_bytes, bump) = (v.vault_id.to_le_bytes(), [v.bump]);

    if lp_amount > 0 {
        let seeds = bet_vault_seeds(&id_bytes, &bump);
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                Transfer {
                    from: ctx.accounts.vault_collateral.to_account_info(),
                    to: ctx.accounts.market_vault.to_account_info(),
                    authority: ctx.accounts.bet_vault.to_account_info(),
                },
                &[&seeds],
            ),
            lp_amount,
        )?;
    }
    msg!(
        "Bet vault {} launched market {} at {} bps, lp={} ({} bps)",
        bet_vault_key,
        market_id,
        price_bps,
        lp_amount,
        effective_lp_bps
    );
    Ok(())
}

/// Inline equivalent of `initialize_market` with the vault PDA as authority.
fn init_market(
    ctx: &mut Context<LaunchBetVault>,
    market_id: u64,
    now: i64,
    price_bps: u16,
) -> Result<()> {
    let authority = ctx.accounts.bet_vault.key();
    let name = ctx.accounts.bet_vault.name;
    let end_ts = ctx.accounts.bet_vault.market_end_ts;
    let m = &mut ctx.accounts.market;
    m.authority = authority;
    m.market_id = market_id;
    m.collateral_mint = ctx.accounts.collateral_mint.key();
    m.yes_mint = ctx.accounts.yes_mint.key();
    m.no_mint = ctx.accounts.no_mint.key();
    m.vault = ctx.accounts.market_vault.key();
    m.start_ts = now;
    m.end_ts = end_ts;
    m.last_accrual_ts = now;
    m.name = name;
    m.initial_price_bps = price_bps;
    m.group = Pubkey::default();
    m.bump = ctx.bumps.market;
    Ok(())
}

/// The vault PDA's (possibly empty) LP position. Always initialized — with
/// `lp_bps = 0` there is no liquidity, but `settle_bet_vault` still loads this
/// account, so its `bump` must be set.
fn init_vault_lp_position(ctx: &mut Context<LaunchBetVault>) {
    let (owner, market) = (ctx.accounts.bet_vault.key(), ctx.accounts.market.key());
    let bump = ctx.bumps.vault_lp_position;
    let lp = &mut ctx.accounts.vault_lp_position;
    lp.owner = owner;
    lp.market = market;
    lp.bump = bump;
}

/// Seed the pool with `lp_amount` at the bet odds; the vault PDA owns the shares
/// and the entry-side surplus.
fn bootstrap_liquidity(
    ctx: &mut Context<LaunchBetVault>,
    now: i64,
    price_bps: u16,
    lp_amount: u64,
) -> Result<()> {
    let m = &mut ctx.accounts.market;
    let time_remaining = m.end_ts - now;
    let price = I80F48::from_num(price_bps) / I80F48::from_num(10_000u16);
    let l_zero = pm_math::suggest_l_zero_for_max_reserve(lp_amount, time_remaining, price)?;
    let l_eff = pm_math::l_effective(l_zero, time_remaining)?;
    let (x, y) = pm_math::reserves_from_price(price, l_eff)?;
    m.set_l_zero_fixed(l_zero);
    m.set_reserve_yes_fixed(x);
    m.set_reserve_no_fixed(y);
    m.set_total_lp_shares_fixed(I80F48::from_num(lp_amount));

    let (excess_yes, excess_no) = deposit_excess(lp_amount, x, y);
    let lp = &mut ctx.accounts.vault_lp_position;
    lp.shares = I80F48::from_num(lp_amount).to_bits() as u128;
    lp.collateral_deposited = lp_amount;
    lp.credit_excess(m, excess_yes, excess_no);
    Ok(())
}

fn create_metadata(ctx: &Context<LaunchBetVault>) -> Result<()> {
    let a = &ctx.accounts;
    let id_bytes = a.market.market_id.to_le_bytes();
    let bump = [a.market.bump];
    let seeds: &[&[u8]] = &[Market::SEED, &id_bytes, &bump];
    let name = a.bet_vault.name_str();
    for (meta, mint, prefix, symbol) in [
        (&a.yes_metadata, &a.yes_mint, "YES", "YES"),
        (&a.no_metadata, &a.no_mint, "NO", "NO"),
    ] {
        create_token_metadata(
            meta.to_account_info(),
            mint.to_account_info(),
            a.market.to_account_info(),
            a.payer.to_account_info(),
            a.system_program.to_account_info(),
            a.rent.to_account_info(),
            truncate_str(&format!("{} - {}", prefix, name), 32),
            symbol.to_string(),
            String::new(),
            seeds,
        )?;
    }
    Ok(())
}
