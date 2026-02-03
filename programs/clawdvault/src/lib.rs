use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer, MintTo};
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::metadata::{
    create_metadata_accounts_v3,
    mpl_token_metadata::types::DataV2,
    CreateMetadataAccountsV3,
    Metadata,
};

#[cfg(not(feature = "no-entrypoint"))]
use solana_security_txt::security_txt;

#[cfg(not(feature = "no-entrypoint"))]
security_txt! {
    name: "ClawdVault",
    project_url: "https://clawdvault.com",
    contacts: "email:security@clawdvault.com,twitter:@shadowclawai",
    policy: "https://clawdvault.com/security",
    preferred_languages: "en",
    source_code: "https://github.com/shadowclawai/clawdvault",
    auditors: "N/A"
}

declare_id!("GUyF2TVe32Cid4iGVt2F6wPYDhLSVmTUZBj2974outYM");

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

    /// Create a new token with bonding curve, metadata, and optional initial buy
    pub fn create_token(
        ctx: Context<CreateToken>,
        name: String,
        symbol: String,
        uri: String,
        initial_buy_lamports: u64,  // 0 for no initial buy
    ) -> Result<()> {
        require!(name.len() <= 32, ClawdVaultError::NameTooLong);
        require!(symbol.len() <= 10, ClawdVaultError::SymbolTooLong);
        require!(uri.len() <= 200, ClawdVaultError::UriTooLong);

        // Capture values before mutable borrow
        let bump = ctx.bumps.bonding_curve;
        let sol_vault_bump = ctx.bumps.sol_vault;
        let mint_key = ctx.accounts.mint.key();
        let creator_key = ctx.accounts.creator.key();
        
        // Build signer seeds for bonding curve PDA
        let seeds = &[
            CURVE_SEED,
            mint_key.as_ref(),
            &[bump],
        ];
        let signer_seeds = &[&seeds[..]];
        
        // Mint total supply to token vault (needs bonding_curve as signer)
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
        
        // Create Metaplex metadata for the token
        create_metadata_accounts_v3(
            CpiContext::new_with_signer(
                ctx.accounts.metadata_program.to_account_info(),
                CreateMetadataAccountsV3 {
                    metadata: ctx.accounts.metadata.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    mint_authority: ctx.accounts.bonding_curve.to_account_info(),
                    payer: ctx.accounts.creator.to_account_info(),
                    update_authority: ctx.accounts.bonding_curve.to_account_info(),
                    system_program: ctx.accounts.system_program.to_account_info(),
                    rent: ctx.accounts.rent.to_account_info(),
                },
                signer_seeds,
            ),
            DataV2 {
                name: name.clone(),
                symbol: symbol.clone(),
                uri,
                seller_fee_basis_points: 0,
                creators: None,
                collection: None,
                uses: None,
            },
            true,  // is_mutable
            true,  // update_authority_is_signer
            None,  // collection_details
        )?;
        
        // Get account infos for transfers BEFORE mutable borrow of curve
        let bonding_curve_info = ctx.accounts.bonding_curve.to_account_info();
        let token_program_info = ctx.accounts.token_program.to_account_info();
        let token_vault_info = ctx.accounts.token_vault.to_account_info();
        let creator_token_info = ctx.accounts.creator_token_account.to_account_info();
        let system_program_info = ctx.accounts.system_program.to_account_info();
        let creator_info = ctx.accounts.creator.to_account_info();
        let sol_vault_info = ctx.accounts.sol_vault.to_account_info();
        
        // Initialize bonding curve state
        let curve = &mut ctx.accounts.bonding_curve;
        curve.creator = creator_key;
        curve.mint = mint_key;
        curve.virtual_sol_reserves = INITIAL_VIRTUAL_SOL;
        curve.virtual_token_reserves = INITIAL_VIRTUAL_TOKENS;
        curve.real_sol_reserves = 0;
        curve.real_token_reserves = TOTAL_SUPPLY;
        curve.token_total_supply = TOTAL_SUPPLY;
        curve.graduated = false;
        curve.migrated_to_raydium = false;
        curve.created_at = Clock::get()?.unix_timestamp;
        curve.bump = bump;
        curve.sol_vault_bump = sol_vault_bump;
        
        // Update protocol stats
        let config = &mut ctx.accounts.config;
        config.total_tokens_created = config.total_tokens_created.checked_add(1)
            .ok_or(ClawdVaultError::MathOverflow)?;
        
        msg!("🐺 Token created: {} ({})", name, symbol);
        msg!("Mint: {}", mint_key);
        msg!("Creator: {}", creator_key);
        
        // Handle initial buy if specified (do transfers before curve borrow ends)
        if initial_buy_lamports > 0 {
            // Calculate tokens out using bonding curve math
            let sol_after_fee = initial_buy_lamports
                .checked_mul(BPS_DENOMINATOR - TOTAL_FEE_BPS)
                .ok_or(ClawdVaultError::MathOverflow)?
                .checked_div(BPS_DENOMINATOR)
                .ok_or(ClawdVaultError::MathOverflow)?;
            
            let new_virtual_sol = INITIAL_VIRTUAL_SOL
                .checked_add(sol_after_fee)
                .ok_or(ClawdVaultError::MathOverflow)?;
            
            let invariant = (INITIAL_VIRTUAL_SOL as u128)
                .checked_mul(INITIAL_VIRTUAL_TOKENS as u128)
                .ok_or(ClawdVaultError::MathOverflow)?;
            
            let new_virtual_tokens = invariant
                .checked_div(new_virtual_sol as u128)
                .ok_or(ClawdVaultError::MathOverflow)? as u64;
            
            let tokens_out = INITIAL_VIRTUAL_TOKENS
                .checked_sub(new_virtual_tokens)
                .ok_or(ClawdVaultError::MathOverflow)?;
            
            // Transfer SOL from creator to sol_vault
            system_program::transfer(
                CpiContext::new(
                    system_program_info.clone(),
                    system_program::Transfer {
                        from: creator_info.clone(),
                        to: sol_vault_info.clone(),
                    },
                ),
                initial_buy_lamports,
            )?;
            
            // Transfer tokens from vault to creator's token account
            token::transfer(
                CpiContext::new_with_signer(
                    token_program_info.clone(),
                    Transfer {
                        from: token_vault_info.clone(),
                        to: creator_token_info.clone(),
                        authority: bonding_curve_info.clone(),
                    },
                    signer_seeds,
                ),
                tokens_out,
            )?;
            
            // Update curve state
            curve.virtual_sol_reserves = new_virtual_sol;
            curve.virtual_token_reserves = new_virtual_tokens;
            curve.real_sol_reserves = initial_buy_lamports;
            curve.real_token_reserves = TOTAL_SUPPLY
                .checked_sub(tokens_out)
                .ok_or(ClawdVaultError::MathOverflow)?;
            
            // Calculate fees (for logging)
            let total_fee = initial_buy_lamports
                .checked_mul(TOTAL_FEE_BPS)
                .ok_or(ClawdVaultError::MathOverflow)?
                .checked_div(BPS_DENOMINATOR)
                .ok_or(ClawdVaultError::MathOverflow)?;
            
            msg!("🎯 Initial buy: {} lamports -> {} tokens (fee: {} lamports)", 
                initial_buy_lamports, tokens_out, total_fee);
        }
        
        msg!("Initial price: {} lamports/token", 
            curve.virtual_sol_reserves / (curve.virtual_token_reserves / 1_000_000));
        
        Ok(())
    }

    /// Buy tokens from bonding curve
    pub fn buy(ctx: Context<Buy>, sol_amount: u64, min_tokens_out: u64) -> Result<()> {
        require!(sol_amount > 0, ClawdVaultError::ZeroAmount);
        
        // Read curve state (immutable first)
        let curve = &ctx.accounts.bonding_curve;
        require!(!curve.graduated, ClawdVaultError::AlreadyGraduated);
        
        // Capture values we need before any borrows
        let mint_key = curve.mint;
        let curve_bump = curve.bump;
        let old_virtual_sol = curve.virtual_sol_reserves;
        let old_virtual_tokens = curve.virtual_token_reserves;
        let old_real_tokens = curve.real_token_reserves;
        
        // Calculate tokens out using constant product formula
        let new_virtual_sol = old_virtual_sol
            .checked_add(sol_amount)
            .ok_or(ClawdVaultError::MathOverflow)?;
        
        let invariant = (old_virtual_sol as u128)
            .checked_mul(old_virtual_tokens as u128)
            .ok_or(ClawdVaultError::MathOverflow)?;
        
        let new_virtual_tokens = invariant
            .checked_div(new_virtual_sol as u128)
            .ok_or(ClawdVaultError::MathOverflow)? as u64;
        
        let tokens_out = old_virtual_tokens
            .checked_sub(new_virtual_tokens)
            .ok_or(ClawdVaultError::MathOverflow)?;
        
        require!(tokens_out >= min_tokens_out, ClawdVaultError::SlippageExceeded);
        require!(tokens_out <= old_real_tokens, ClawdVaultError::InsufficientLiquidity);
        
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
        let seeds = &[
            CURVE_SEED,
            mint_key.as_ref(),
            &[curve_bump],
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
        
        // Now update curve state (mutable borrow after CPIs)
        let curve = &mut ctx.accounts.bonding_curve;
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
        let invariant = (curve.virtual_sol_reserves as u128)
            .checked_mul(curve.virtual_token_reserves as u128)
            .ok_or(ClawdVaultError::MathOverflow)?;
        
        let new_virtual_tokens = curve.virtual_token_reserves
            .checked_add(token_amount)
            .ok_or(ClawdVaultError::MathOverflow)?;
        
        let new_virtual_sol = invariant
            .checked_div(new_virtual_tokens as u128)
            .ok_or(ClawdVaultError::MathOverflow)? as u64;
        
        let sol_out_requested = curve.virtual_sol_reserves
            .checked_sub(new_virtual_sol)
            .ok_or(ClawdVaultError::MathOverflow)?;
        
        // Cap at available liquidity and recalculate tokens if needed
        let (sol_out_gross, actual_token_amount) = if sol_out_requested > curve.real_sol_reserves {
            // Cap SOL output at real reserves
            let capped_sol = curve.real_sol_reserves;
            // Back-calculate max tokens: tokens = k / (virtual_sol - capped_sol) - virtual_tokens
            let target_virtual_sol = curve.virtual_sol_reserves
                .checked_sub(capped_sol)
                .ok_or(ClawdVaultError::MathOverflow)?;
            require!(target_virtual_sol > 0, ClawdVaultError::InsufficientLiquidity);
            let max_virtual_tokens = invariant
                .checked_div(target_virtual_sol as u128)
                .ok_or(ClawdVaultError::MathOverflow)?;
            let max_tokens = (max_virtual_tokens as u64)
                .checked_sub(curve.virtual_token_reserves)
                .ok_or(ClawdVaultError::MathOverflow)?;
            (capped_sol, max_tokens)
        } else {
            (sol_out_requested, token_amount)
        };
        
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
        
        // Transfer tokens from seller to vault (use actual_token_amount which may be capped)
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.seller_token_account.to_account_info(),
                    to: ctx.accounts.token_vault.to_account_info(),
                    authority: ctx.accounts.seller.to_account_info(),
                },
            ),
            actual_token_amount,
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
        
        // Update curve state (recalculate based on actual_token_amount)
        let final_virtual_tokens = curve.virtual_token_reserves
            .checked_add(actual_token_amount)
            .ok_or(ClawdVaultError::MathOverflow)?;
        let final_virtual_sol = invariant
            .checked_div(final_virtual_tokens as u128)
            .ok_or(ClawdVaultError::MathOverflow)? as u64;
        
        curve.virtual_sol_reserves = final_virtual_sol;
        curve.virtual_token_reserves = final_virtual_tokens;
        curve.real_sol_reserves = curve.real_sol_reserves
            .checked_sub(sol_out_gross)
            .ok_or(ClawdVaultError::MathOverflow)?;
        curve.real_token_reserves = curve.real_token_reserves
            .checked_add(actual_token_amount)
            .ok_or(ClawdVaultError::MathOverflow)?;
        
        msg!("🔴 SELL: {} tokens -> {} lamports (requested: {})", actual_token_amount, sol_out_net, token_amount);
        msg!("Fees: {} protocol, {} creator", protocol_fee, creator_fee);
        
        emit!(TradeEvent {
            mint: curve.mint,
            trader: ctx.accounts.seller.key(),
            is_buy: false,
            sol_amount: sol_out_net,
            token_amount: actual_token_amount,
            protocol_fee,
            creator_fee,
            virtual_sol_reserves: curve.virtual_sol_reserves,
            virtual_token_reserves: curve.virtual_token_reserves,
            timestamp: Clock::get()?.unix_timestamp,
        });
        
        Ok(())
    }

    /// Release graduated token's assets to migration wallet for Raydium pool creation
    /// Only callable by protocol authority after graduation threshold is hit
    pub fn release_for_migration(ctx: Context<ReleaseForMigration>) -> Result<()> {
        let curve = &ctx.accounts.bonding_curve;
        let mint_key = curve.mint;
        let bump = curve.bump;
        let sol_vault_bump = curve.sol_vault_bump;
        
        require!(curve.graduated, ClawdVaultError::NotGraduated);
        require!(!curve.migrated_to_raydium, ClawdVaultError::AlreadyMigrated);
        
        let sol_amount = curve.real_sol_reserves;
        let token_amount = curve.real_token_reserves;
        
        msg!("🚀 Releasing assets for Raydium migration...");
        msg!("SOL to transfer: {} lamports", sol_amount);
        msg!("Tokens to transfer: {}", token_amount);
        
        // Build signer seeds for bonding curve PDA
        let curve_seeds = &[
            CURVE_SEED,
            mint_key.as_ref(),
            &[bump],
        ];
        let curve_signer = &[&curve_seeds[..]];
        
        // Build signer seeds for SOL vault PDA
        let vault_seeds = &[
            VAULT_SEED,
            mint_key.as_ref(),
            &[sol_vault_bump],
        ];
        let vault_signer = &[&vault_seeds[..]];
        
        // Transfer SOL from vault to migration wallet
        if sol_amount > 0 {
            let sol_vault_info = ctx.accounts.sol_vault.to_account_info();
            let migration_wallet_info = ctx.accounts.migration_wallet.to_account_info();
            
            **sol_vault_info.try_borrow_mut_lamports()? -= sol_amount;
            **migration_wallet_info.try_borrow_mut_lamports()? += sol_amount;
            
            msg!("✅ Transferred {} SOL to migration wallet", sol_amount);
        }
        
        // Transfer tokens from vault to migration wallet's token account
        if token_amount > 0 {
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.token_vault.to_account_info(),
                        to: ctx.accounts.migration_token_account.to_account_info(),
                        authority: ctx.accounts.bonding_curve.to_account_info(),
                    },
                    curve_signer,
                ),
                token_amount,
            )?;
            
            msg!("✅ Transferred {} tokens to migration wallet", token_amount);
        }
        
        // Mark as migrated
        let curve_mut = &mut ctx.accounts.bonding_curve;
        curve_mut.migrated_to_raydium = true;
        curve_mut.real_sol_reserves = 0;
        curve_mut.real_token_reserves = 0;
        
        // Emit event
        emit!(MigrationReleasedEvent {
            mint: mint_key,
            sol_amount,
            token_amount,
            migration_wallet: ctx.accounts.migration_wallet.key(),
            timestamp: Clock::get()?.unix_timestamp,
        });
        
        msg!("🎓 Assets released for Raydium migration!");
        
        Ok(())
    }

    /// Force graduate a token (ADMIN ONLY - FOR TESTING)
    /// TODO: Remove this before production deployment
    pub fn force_graduate(ctx: Context<ForceGraduate>) -> Result<()> {
        let curve = &mut ctx.accounts.bonding_curve;
        
        require!(!curve.graduated, ClawdVaultError::AlreadyGraduated);
        
        msg!("⚠️ ADMIN: Force graduating token (testing only)");
        msg!("Mint: {}", curve.mint);
        msg!("Current SOL reserves: {}", curve.real_sol_reserves);
        
        // Set graduated flag
        curve.graduated = true;
        
        // Emit graduation event
        emit!(GraduationEvent {
            mint: curve.mint,
            sol_raised: curve.real_sol_reserves,
            timestamp: Clock::get()?.unix_timestamp,
        });
        
        msg!("✅ Token force graduated!");
        
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
    pub migrated_to_raydium: bool,
    pub created_at: i64,
    pub bump: u8,
    pub sol_vault_bump: u8,
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
        1 + // migrated_to_raydium
        8 + // created_at
        1 + // bump
        1;  // sol_vault_bump
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
        // No freeze authority - removes the scary wallet warning
    )]
    pub mint: Account<'info, Mint>,
    
    /// CHECK: Metadata account created via CPI to Metaplex
    #[account(
        mut,
        seeds = [b"metadata", metadata_program.key().as_ref(), mint.key().as_ref()],
        bump,
        seeds::program = metadata_program.key(),
    )]
    pub metadata: UncheckedAccount<'info>,
    
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
    
    /// Creator's token account for initial buy (optional, created if needed)
    #[account(
        init_if_needed,
        payer = creator,
        associated_token::mint = mint,
        associated_token::authority = creator,
    )]
    pub creator_token_account: Account<'info, TokenAccount>,
    
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub metadata_program: Program<'info, Metadata>,
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
pub struct ReleaseForMigration<'info> {
    /// Protocol authority (only authority can trigger migration)
    #[account(
        mut,
        constraint = authority.key() == config.authority @ ClawdVaultError::Unauthorized,
    )]
    pub authority: Signer<'info>,
    
    /// Protocol config
    #[account(
        seeds = [b"config"],
        bump = config.bump,
    )]
    pub config: Account<'info, Config>,
    
    /// Bonding curve being migrated
    #[account(
        mut,
        seeds = [CURVE_SEED, bonding_curve.mint.as_ref()],
        bump = bonding_curve.bump,
        constraint = bonding_curve.graduated @ ClawdVaultError::NotGraduated,
        constraint = !bonding_curve.migrated_to_raydium @ ClawdVaultError::AlreadyMigrated,
    )]
    pub bonding_curve: Account<'info, BondingCurve>,
    
    /// SOL vault holding the curve's SOL (owned by program, not system)
    /// CHECK: PDA verified by seeds, lamports transferred manually
    #[account(
        mut,
        seeds = [VAULT_SEED, bonding_curve.mint.as_ref()],
        bump = bonding_curve.sol_vault_bump,
    )]
    pub sol_vault: UncheckedAccount<'info>,
    
    /// Token vault holding remaining tokens (ATA owned by bonding_curve)
    #[account(
        mut,
        associated_token::mint = token_mint,
        associated_token::authority = bonding_curve,
    )]
    pub token_vault: Account<'info, TokenAccount>,
    
    /// The token mint
    pub token_mint: Account<'info, Mint>,
    
    /// Migration wallet that will receive assets for Raydium pool creation
    /// CHECK: Any wallet can be the migration target, validated by authority
    #[account(mut)]
    pub migration_wallet: UncheckedAccount<'info>,
    
    /// Migration wallet's token account for the token
    #[account(
        mut,
        token::mint = token_mint,
        token::authority = migration_wallet,
    )]
    pub migration_token_account: Account<'info, TokenAccount>,
    
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

/// Force graduate a token (ADMIN ONLY - FOR TESTING)
/// TODO: Remove before production
#[derive(Accounts)]
pub struct ForceGraduate<'info> {
    /// Protocol authority (only authority can force graduate)
    #[account(
        constraint = authority.key() == config.authority @ ClawdVaultError::Unauthorized,
    )]
    pub authority: Signer<'info>,
    
    /// Protocol config
    #[account(
        seeds = [b"config"],
        bump = config.bump,
    )]
    pub config: Account<'info, Config>,
    
    /// Bonding curve to graduate
    #[account(
        mut,
        seeds = [CURVE_SEED, bonding_curve.mint.as_ref()],
        bump = bonding_curve.bump,
    )]
    pub bonding_curve: Account<'info, BondingCurve>,
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

#[event]
pub struct MigrationReleasedEvent {
    pub mint: Pubkey,
    pub sol_amount: u64,
    pub token_amount: u64,
    pub migration_wallet: Pubkey,
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
    
    #[msg("Token has already been migrated to Raydium pool")]
    AlreadyMigrated,
    
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
