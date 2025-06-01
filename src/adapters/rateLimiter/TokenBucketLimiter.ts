import type { RateLimiter } from "../../types"

/**
 * Configuration for token bucket rate limiter
 */
export type TokenBucketConfig = {
  /** Maximum number of tokens in the bucket */
  capacity?: number
  /** Rate at which tokens are refilled (tokens per second) */
  refillRate?: number
  /** Initial number of tokens */
  initialTokens?: number
  /** Whether to allow bursts up to capacity */
  allowBurst?: boolean
}

/**
 * Token bucket rate limiter implementation
 * Allows bursts up to capacity, then enforces steady rate
 */
export class TokenBucketLimiter implements RateLimiter {
    private tokens: number
    private lastRefill: number
    private readonly capacity: number
    private readonly refillRate: number
    private readonly allowBurst: boolean

    constructor( config: TokenBucketConfig = {} ) {
        this.capacity = config.capacity ?? 10
        this.refillRate = config.refillRate ?? 1 // 1 token per second
        this.allowBurst = config.allowBurst ?? true
        this.tokens = config.initialTokens ?? this.capacity
        this.lastRefill = Date.now()
    }
    canExecute(): boolean {
        throw new Error( "Method not implemented." )
    }

    /**
   * Execute a function with rate limiting
   */
    async execute<T>( fn: () => Promise<T> ): Promise<T> {
        await this.acquire()
        return fn()
    }

    /**
   * Acquire a token (wait if necessary)
   */
    async acquire( tokens: number = 1 ): Promise<void> {
        if ( tokens > this.capacity ) {
            throw new Error( `Requested tokens (${tokens}) exceeds bucket capacity (${this.capacity})` )
        }

        this.refillTokens()

        if ( this.tokens >= tokens ) {
            this.tokens -= tokens
            return
        }

        // Not enough tokens, calculate wait time
        const tokensNeeded = tokens - this.tokens
        const waitTime = ( tokensNeeded / this.refillRate ) * 1000 // Convert to milliseconds

        await new Promise( resolve => setTimeout( resolve, waitTime ) )
    
        // Refill again after waiting
        this.refillTokens()
        this.tokens -= tokens
    }

    /**
   * Try to acquire tokens without waiting
   */
    tryAcquire( tokens: number = 1 ): boolean {
        if ( tokens > this.capacity ) {
            return false
        }

        this.refillTokens()

        if ( this.tokens >= tokens ) {
            this.tokens -= tokens
            return true
        }

        return false
    }

    /**
   * Get current token count
   */
    getAvailableTokens(): number {
        this.refillTokens()
        return this.tokens
    }

    /**
   * Get rate limiter statistics
   */
    getStats() {
        this.refillTokens()
        return {
            availableTokens: this.tokens,
            capacity: this.capacity,
            refillRate: this.refillRate,
            utilizationPercent: ( ( this.capacity - this.tokens ) / this.capacity ) * 100,
            nextRefillIn: this.tokens < this.capacity ? ( 1000 / this.refillRate ) : 0
        }
    }

    /**
   * Reset the bucket to full capacity
   */
    reset(): void {
        this.tokens = this.capacity
        this.lastRefill = Date.now()
    }

    // ============================================================================
    // PRIVATE METHODS
    // ============================================================================

    private refillTokens(): void {
        const now = Date.now()
        const timePassed = now - this.lastRefill
        const tokensToAdd = ( timePassed / 1000 ) * this.refillRate

        if ( tokensToAdd > 0 ) {
            this.tokens = Math.min( this.capacity, this.tokens + tokensToAdd )
            this.lastRefill = now
        }
    }
}