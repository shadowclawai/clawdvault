use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer, MintTo};
use anchor_spl::associated_token::AssociatedToken;

declare_id!("GMdG56oR3Qpc8NT6TwAtwdwNggxRADn6VAYbotLF1aM");

// ============================================================================
// CONSTANTS
// ============================================================================

/// Total token supply (1 billion with 6 decimals)
pub const TOTAL_SUPPLY: u64 = 1_000_000_000_000_000; // 1B * 10^6

/// Initial virtual SOL reserves (30 SOL) - creates initial price
pub const INITIAL_VIRTUAL_SOL: u64 = 30_000_000_000; // 30 SOL in lamports

/// Initial virtual token reserves (matches total supply)
pub const INITIAL_VIRTUAL_TOKENS: u64 = TOTAL_SUPPLY;

/// Graduation threshold in lamports (~120 SOL for ~$69K market cap)
pub const GRADUATION_THRESHOLD: u64 = 120_000_000_000; // 120 SOL

/// Protocol fee in basis points (0.5%)
pub const PROTOCOL_FEE_BPS: u64 = 50;

/// Creator fee in basis points (0.5%)
pub const CREATOR_FEE_BPS: u64 = 50;

/// Total fee in basis points (1%)
pub const TOTAL_FEE_BPS: u64 = 100;

/// Basis points denominator
pub const BPS_DENOMINATOR: u64 = 10_000;

/// Seeds for PDAs
pub const CURVE_SEED: &[u8] = b"bonding_curve";
pub const VAULT_SEED: &[u8] = b"sol_vault";
pub const TOKEN_VAULT_SEED: &[u8] = b"token_vault";

// ============================================================================
// PROGRAM
// ============================================================================

#[program]
pub mod clawdvault {
    use super::*;

    /// Initialize the protocol with fee recipient
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.authority = ctx.accounts.authority.key();
        config.fee_recipient = ctx.accounts.fee_recipient.key();
        config.total_tokens_created = 0;
        config.total_volume_sol = 0;
        config.bump = ctx.bumps.config;
        
        msg!("ClawdVault initialized!");
        msg!("Authority: {}", config.authority);
        msg!("Fee recipient: {}", config.fee_recipient);
        
        Ok(())
    }

    /// Create a new token with bonding curve
    pub fn create_token(
        ctx: Context<CreateToken>,
        name: String,
        symbol: String,
        uri: String,
    ) -> Result<()> {
        require!(name.len() <= 32, ClawdVaultError::NameTooLong);
        require!(symbol.len() <= 10, ClawdVaultError::SymbolTooLong);
        require!(uri.len() <= 200, ClawdVaultError::UriTooLong);

        let curve = &mut ctx.accounts.bonding_curve;
        let config = &mut ctx.accounts.config;
        
        // Initialize bonding curve state
        curve.creator = ctx.accounts.creator.key();
        curve.mint = ctx.accounts.mint.key();
        curve.virtual_sol_reserves = INITIAL_VIRTUAL_SOL;
        curve.virtual_token_reserves = INITIAL_VIRTUAL_TOKENS;
        curve.real_sol_reserves = 0;
        curve.real_token_reserves = TOTAL_SUPPLY;
        curve.token_total_supply = TOTAL_SUPPLY;
        curve.graduated = false;
        curve.created_at = Clock::get()?.unix_timestamp;
        curve.bump = ctx.bumps.bonding_curve;
        curve.sol_vault_bump = ctx.bumps.sol_vault;
        curve.token_vault_bump = ctx.bumps.token_vault;
        
        // Mint total supply to token vault (curve holds all tokens initially)
        let mint_key = ctx.accounts.mint.key();
        let seeds = &[
            CURVE_SEED,
            mint_key.as_ref(),
            &[curve.bump],
        ];
        let signer_seeds = &[&seeds[..]];
        
        token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.token_vault.to_account_info(),
                    authority: ctx.accounts.bonding_curve.to_account_info(),
                },
                signer_seeds,
            ),
            TOTAL_SUPPLY,
        )?;
        
        // Update protocol stats
        config.total_tokens_created = config.total_tokens_created.checked_add(1)
            .ok_or(ClawdVaultError::MathOverflow)?;
        
        msg!("🐺 Token created: {} ({})", name, symbol);
        msg!("Mint: {}", ctx.accounts.mint.key());
        msg!("Creator: {}", curve.creator);
        msg!("Initial price: {} SOL per token", 
            INITIAL_VIRTUAL_SOL as f64 / INITIAL_VIRTUAL_TOKENS as f64);
        
        Ok(())
    }

    /// Buy tokens from bonding curve
    pub fn buy(ctx: Context<Buy>, sol_amount: u64, min_tokens_out: u64) -> Result<()> {
        require!(sol_amount > 0, ClawdVaultError::ZeroAmount);
        
        let curve = &mut ctx.accounts.bonding_curve;
        let config = &ctx.accounts.config;
        
        require!(!curve.graduated, ClawdVaultError::AlreadyGraduated);
        
        // Calculate tokens out using constant product formula
        // k = virtual_sol * virtual_tokens (invariant)
        // new_virtual_tokens = k / new_virtual_sol
        // tokens_out = old_virtual_tokens - new_virtual_tokens
        
        let new_virtual_sol = curve.virtual_sol_reserves
            .checked_add(sol_amount)
            .ok_or(ClawdVaultError::MathOverflow)?;
        
        // Use u128 for intermediate calculation to prevent overflow
        let invariant = (curve.virtual_sol_reserves as u128)
            .checked_mul(curve.virtual_token_reserves as u128)
            .ok_or(ClawdVaultError::MathOverflow)?;
        
        let new_virtual_tokens = invariant
            .checked_div(new_virtual_sol as u128)
            .ok_or(ClawdVaultError::MathOverflow)? as u64;
        
        let tokens_out = curve.virtual_token_reserves
            .checked_sub(new_virtual_tokens)
            .ok_or(ClawdVaultError::MathOverflow)?;
        
        require!(tokens_out >= min_tokens_out, ClawdVaultError::SlippageExceeded);
        require!(tokens_out <= curve.real_token_reserves, ClawdVaultError::InsufficientLiquidity);
        
        // Calculate fees
        let total_fee = sol_amount
            .checked_mul(TOTAL_FEE_BPS)
            .ok_or(ClawdVaultError::MathOverflow)?
            .checked_div(BPS_DENOMINATOR)
            .ok_or(ClawdVaultError::MathOverflow)?;
        
        let protocol_fee = sol_amount
            .checked_mul(PROTOCOL_FEE_BPS)
            .ok_or(ClawdVaultError::MathOverflow)?
            .checked_div(BPS_DENOMINATOR)
            .ok_or(ClawdVaultError::MathOverflow)?;
        
        let creator_fee = total_fee.checked_sub(protocol_fee)
            .ok_or(ClawdVaultError::MathOverflow)?;
        
        let sol_to_curve = sol_amount.checked_sub(total_fee)
            .ok_or(ClawdVaultError::MathOverflow)?;
        
        // Transfer SOL from buyer to curve vault
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.buyer.to_account_info(),
                    to: ctx.accounts.sol_vault.to_account_info(),
                },
            ),
            sol_to_curve,
        )?;
        
        // Transfer protocol fee
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.buyer.to_account_info(),
                    to: ctx.accounts.fee_recipient.to_account_info(),
                },
            ),
            protocol_fee,
        )?;
        
        // Transfer creator fee
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.buyer.to_account_info(),
                    to: ctx.accounts.creator.to_account_info(),
                },
            ),
            creator_fee,
        )?;
        
        // Transfer tokens from vault to buyer
        let mint_key = curve.mint;
        let seeds = &[
            CURVE_SEED,
            mint_key.as_ref(),
            &[curve.bump],
        ];
        let signer_seeds = &[&seeds[..]];
        
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.token_vault.to_account_info(),
                    to: ctx.accounts.buyer_token_account.to_account_info(),
                    authority: ctx.accounts.bonding_curve.to_account_info(),
                },
                signer_seeds,
            ),
            tokens_out,
        )?;
        
        // Update curve state
        curve.virtual_sol_reserves = new_virtual_sol;
        curve.virtual_token_reserves = new_virtual_tokens;
        curve.real_sol_reserves = curve.real_sol_reserves
            .checked_add(sol_to_curve)
            .ok_or(ClawdVaultError::MathOverflow)?;
        curve.real_token_reserves = curve.real_token_reserves
            .checked_sub(tokens_out)
            .ok_or(ClawdVaultError::MathOverflow)?;
        
        // Check for graduation
        if curve.real_sol_reserves >= GRADUATION_THRESHOLD {
            curve.graduated = true;
            msg!("🎓 TOKEN GRADUATED! Ready for Raydium migration");
        }
        
        msg!("🟢 BUY: {} lamports -> {} tokens", sol_amount, tokens_out);
        msg!("Fees: {} protocol, {} creator", protocol_fee, creator_fee);
        msg!("New price: {} lamports/token", 
            (curve.virtual_sol_reserves as u128 * 1_000_000 / curve.virtual_token_reserves as u128));
        
        // Emit event
        emit!(TradeEvent {
            mint: curve.mint,
            trader: ctx.accounts.buyer.key(),
            is_buy: true,
            sol_amount,
            token_amount: tokens_out,
            protocol_fee,
            creator_fee,
            virtual_sol_reserves: curve.virtual_sol_reserves,
            virtual_token_reserves: curve.virtual_token_reserves,
            timestamp: Clock::get()?.unix_timestamp,
        });
        
        Ok(())
    }

    /// Sell tokens back to bonding curve
    pub fn sell(ctx: Context<Sell>, token_amount: u64, min_sol_out: u64) -> Result<()> {
        require!(token_amount > 0, ClawdVaultError::ZeroAmount);
        
        let curve = &mut ctx.accounts.bonding_curve;
        
        require!(!curve.graduated, ClawdVaultError::AlreadyGraduated);
        
        // Calculate SOL out using constant product formula
        let new_virtual_tokens = curve.virtual_token_reserves
            .checked_add(token_amount)
            .ok_or(ClawdVaultError::MathOverflow)?;
        
        let invariant = (curve.virtual_sol_reserves as u128)
            .checked_mul(curve.virtual_token_reserves as u128)
            .ok_or(ClawdVaultError::MathOverflow)?;
        
        let new_virtual_sol = invariant
            .checked_div(new_virtual_tokens as u128)
            .ok_or(ClawdVaultError::MathOverflow)? as u64;
        
        let sol_out_gross = curve.virtual_sol_reserves
            .checked_sub(new_virtual_sol)
            .ok_or(ClawdVaultError::MathOverflow)?;
        
        require!(sol_out_gross <= curve.real_sol_reserves, ClawdVaultError::InsufficientLiquidity);
        
        // Calculate fees (taken from output)
        let total_fee = sol_out_gross
            .checked_mul(TOTAL_FEE_BPS)
            .ok_or(ClawdVaultError::MathOverflow)?
            .checked_div(BPS_DENOMINATOR)
            .ok_or(ClawdVaultError::MathOverflow)?;
        
        let protocol_fee = sol_out_gross
            .checked_mul(PROTOCOL_FEE_BPS)
            .ok_or(ClawdVaultError::MathOverflow)?
            .checked_div(BPS_DENOMINATOR)
            .ok_or(ClawdVaultError::MathOverflow)?;
        
        let creator_fee = total_fee.checked_sub(protocol_fee)
            .ok_or(ClawdVaultError::MathOverflow)?;
        
        let sol_out_net = sol_out_gross.checked_sub(total_fee)
            .ok_or(ClawdVaultError::MathOverflow)?;
        
        require!(sol_out_net >= min_sol_out, ClawdVaultError::SlippageExceeded);
        
        // Transfer tokens from seller to vault
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.seller_token_account.to_account_info(),
                    to: ctx.accounts.token_vault.to_account_info(),
                    authority: ctx.accounts.seller.to_account_info(),
                },
            ),
            token_amount,
        )?;
        
        // Transfer SOL from vault to seller
        let mint_key = curve.mint;
        let vault_seeds = &[
            VAULT_SEED,
            mint_key.as_ref(),
            &[curve.sol_vault_bump],
        ];
        let vault_signer = &[&vault_seeds[..]];
        
        // Transfer net SOL to seller
        **ctx.accounts.sol_vault.to_account_info().try_borrow_mut_lamports()? -= sol_out_net;
        **ctx.accounts.seller.to_account_info().try_borrow_mut_lamports()? += sol_out_net;
        
        // Transfer protocol fee
        **ctx.accounts.sol_vault.to_account_info().try_borrow_mut_lamports()? -= protocol_fee;
        **ctx.accounts.fee_recipient.to_account_info().try_borrow_mut_lamports()? += protocol_fee;
        
        // Transfer creator fee
        **ctx.accounts.sol_vault.to_account_info().try_borrow_mut_lamports()? -= creator_fee;
        **ctx.accounts.creator.to_account_info().try_borrow_mut_lamports()? += creator_fee;
        
        // Update curve state
        curve.virtual_sol_reserves = new_virtual_sol;
        curve.virtual_token_reserves = new_virtual_tokens;
        curve.real_sol_reserves = curve.real_sol_reserves
            .checked_sub(sol_out_gross)
            .ok_or(ClawdVaultError::MathOverflow)?;
        curve.real_token_reserves = curve.real_token_reserves
            .checked_add(token_amount)
            .ok_or(ClawdVaultError::MathOverflow)?;
        
        msg!("🔴 SELL: {} tokens -> {} lamports", token_amount, sol_out_net);
        msg!("Fees: {} protocol, {} creator", protocol_fee, creator_fee);
        
        emit!(TradeEvent {
            mint: curve.mint,
            trader: ctx.accounts.seller.key(),
            is_buy: false,
            sol_amount: sol_out_net,
            token_amount,
            protocol_fee,
            creator_fee,
            virtual_sol_reserves: curve.virtual_sol_reserves,
            virtual_token_reserves: curve.virtual_token_reserves,
            timestamp: Clock::get()?.unix_timestamp,
        });
        
        Ok(())
    }

    /// Migrate graduated token to Raydium
    pub fn graduate(ctx: Context<Graduate>) -> Result<()> {
        let curve = &ctx.accounts.bonding_curve;
        
        require!(curve.graduated, ClawdVaultError::NotGraduated);
        
        // TODO: Implement Raydium migration
        // 1. Create Raydium pool
        // 2. Add liquidity (remaining SOL + remaining tokens)
        // 3. Burn LP tokens or send to creator
        
        msg!("🚀 Graduating to Raydium...");
        msg!("SOL in curve: {}", curve.real_sol_reserves);
        msg!("Tokens remaining: {}", curve.real_token_reserves);
        
        Ok(())
    }
}

// ============================================================================
// ACCOUNT STRUCTURES
// ============================================================================

/// Global protocol configuration
#[account]
pub struct Config {
    pub authority: Pubkey,
    pub fee_recipient: Pubkey,
    pub total_tokens_created: u64,
    pub total_volume_sol: u64,
    pub bump: u8,
}

impl Config {
    pub const LEN: usize = 8 + 32 + 32 + 8 + 8 + 1;
}

/// Bonding curve state for each token
#[account]
pub struct BondingCurve {
    pub creator: Pubkey,
    pub mint: Pubkey,
    pub virtual_sol_reserves: u64,
    pub virtual_token_reserves: u64,
    pub real_sol_reserves: u64,
    pub real_token_reserves: u64,
    pub token_total_supply: u64,
    pub graduated: bool,
    pub created_at: i64,
    pub bump: u8,
    pub sol_vault_bump: u8,
    pub token_vault_bump: u8,
}

impl BondingCurve {
    pub const LEN: usize = 8 + // discriminator
        32 + // creator
        32 + // mint
        8 + // virtual_sol_reserves
        8 + // virtual_token_reserves
        8 + // real_sol_reserves
        8 + // real_token_reserves
        8 + // token_total_supply
        1 + // graduated
        8 + // created_at
        1 + // bump
        1 + // sol_vault_bump
        1;  // token_vault_bump
}

// ============================================================================
// CONTEXT STRUCTURES  
// ============================================================================

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    
    /// CHECK: Fee recipient wallet
    pub fee_recipient: UncheckedAccount<'info>,
    
    #[account(
        init,
        payer = authority,
        space = Config::LEN,
        seeds = [b"config"],
        bump,
    )]
    pub config: Account<'info, Config>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(name: String, symbol: String, uri: String)]
pub struct CreateToken<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    
    #[account(
        mut,
        seeds = [b"config"],
        bump = config.bump,
    )]
    pub config: Account<'info, Config>,
    
    #[account(
        init,
        payer = creator,
        mint::decimals = 6,
        mint::authority = bonding_curve,
        mint::freeze_authority = bonding_curve,
    )]
    pub mint: Account<'info, Mint>,
    
    #[account(
        init,
        payer = creator,
        space = BondingCurve::LEN,
        seeds = [CURVE_SEED, mint.key().as_ref()],
        bump,
    )]
    pub bonding_curve: Account<'info, BondingCurve>,
    
    /// SOL vault PDA - holds curve's SOL reserves
    #[account(
        init,
        payer = creator,
        space = 0,
        seeds = [VAULT_SEED, mint.key().as_ref()],
        bump,
    )]
    /// CHECK: PDA for holding SOL
    pub sol_vault: UncheckedAccount<'info>,
    
    /// Token vault - holds curve's token reserves
    #[account(
        init,
        payer = creator,
        associated_token::mint = mint,
        associated_token::authority = bonding_curve,
    )]
    pub token_vault: Account<'info, TokenAccount>,
    
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct Buy<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,
    
    #[account(
        mut,
        seeds = [CURVE_SEED, bonding_curve.mint.as_ref()],
        bump = bonding_curve.bump,
    )]
    pub bonding_curve: Account<'info, BondingCurve>,
    
    #[account(
        seeds = [b"config"],
        bump = config.bump,
    )]
    pub config: Account<'info, Config>,
    
    pub mint: Account<'info, Mint>,
    
    /// SOL vault
    #[account(
        mut,
        seeds = [VAULT_SEED, mint.key().as_ref()],
        bump = bonding_curve.sol_vault_bump,
    )]
    /// CHECK: PDA for SOL
    pub sol_vault: UncheckedAccount<'info>,
    
    /// Token vault
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = bonding_curve,
    )]
    pub token_vault: Account<'info, TokenAccount>,
    
    /// Buyer's token account (created if needed)
    #[account(
        init_if_needed,
        payer = buyer,
        associated_token::mint = mint,
        associated_token::authority = buyer,
    )]
    pub buyer_token_account: Account<'info, TokenAccount>,
    
    /// Protocol fee recipient
    #[account(
        mut,
        address = config.fee_recipient,
    )]
    /// CHECK: Validated against config
    pub fee_recipient: UncheckedAccount<'info>,
    
    /// Token creator (receives creator fee)
    #[account(
        mut,
        address = bonding_curve.creator,
    )]
    /// CHECK: Validated against curve
    pub creator: UncheckedAccount<'info>,
    
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Sell<'info> {
    #[account(mut)]
    pub seller: Signer<'info>,
    
    #[account(
        mut,
        seeds = [CURVE_SEED, bonding_curve.mint.as_ref()],
        bump = bonding_curve.bump,
    )]
    pub bonding_curve: Account<'info, BondingCurve>,
    
    #[account(
        seeds = [b"config"],
        bump = config.bump,
    )]
    pub config: Account<'info, Config>,
    
    pub mint: Account<'info, Mint>,
    
    /// SOL vault
    #[account(
        mut,
        seeds = [VAULT_SEED, mint.key().as_ref()],
        bump = bonding_curve.sol_vault_bump,
    )]
    /// CHECK: PDA for SOL
    pub sol_vault: UncheckedAccount<'info>,
    
    /// Token vault
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = bonding_curve,
    )]
    pub token_vault: Account<'info, TokenAccount>,
    
    /// Seller's token account
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = seller,
    )]
    pub seller_token_account: Account<'info, TokenAccount>,
    
    /// Protocol fee recipient
    #[account(
        mut,
        address = config.fee_recipient,
    )]
    /// CHECK: Validated against config
    pub fee_recipient: UncheckedAccount<'info>,
    
    /// Token creator
    #[account(
        mut,
        address = bonding_curve.creator,
    )]
    /// CHECK: Validated against curve
    pub creator: UncheckedAccount<'info>,
    
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Graduate<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    
    #[account(
        mut,
        seeds = [CURVE_SEED, bonding_curve.mint.as_ref()],
        bump = bonding_curve.bump,
        constraint = bonding_curve.graduated @ ClawdVaultError::NotGraduated,
    )]
    pub bonding_curve: Account<'info, BondingCurve>,
    
    // TODO: Add Raydium accounts for migration
}

// ============================================================================
// EVENTS
// ============================================================================

#[event]
pub struct TradeEvent {
    pub mint: Pubkey,
    pub trader: Pubkey,
    pub is_buy: bool,
    pub sol_amount: u64,
    pub token_amount: u64,
    pub protocol_fee: u64,
    pub creator_fee: u64,
    pub virtual_sol_reserves: u64,
    pub virtual_token_reserves: u64,
    pub timestamp: i64,
}

#[event]
pub struct TokenCreatedEvent {
    pub mint: Pubkey,
    pub creator: Pubkey,
    pub name: String,
    pub symbol: String,
    pub uri: String,
    pub timestamp: i64,
}

#[event]
pub struct GraduationEvent {
    pub mint: Pubkey,
    pub sol_raised: u64,
    pub timestamp: i64,
}

// ============================================================================
// ERRORS
// ============================================================================

#[error_code]
pub enum ClawdVaultError {
    #[msg("Math overflow")]
    MathOverflow,
    
    #[msg("Slippage tolerance exceeded")]
    SlippageExceeded,
    
    #[msg("Token has already graduated to Raydium")]
    AlreadyGraduated,
    
    #[msg("Token has not graduated yet")]
    NotGraduated,
    
    #[msg("Insufficient liquidity in curve")]
    InsufficientLiquidity,
    
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    
    #[msg("Token name too long (max 32 chars)")]
    NameTooLong,
    
    #[msg("Token symbol too long (max 10 chars)")]
    SymbolTooLong,
    
    #[msg("Token URI too long (max 200 chars)")]
    UriTooLong,
    
    #[msg("Unauthorized")]
    Unauthorized,
}
