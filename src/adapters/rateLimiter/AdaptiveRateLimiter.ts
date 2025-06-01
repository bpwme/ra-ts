import { RateLimiter } from "../../types"
import { TokenBucketLimiter } from "./TokenBucketLimiter"

/**
 * Configuration for adaptive rate limiter
 */
export type AdaptiveRateLimiterConfig = {
    /** Initial rate limit (requests per second) */
    initialRate?: number
    /** Minimum rate limit */
    minRate?: number
    /** Maximum rate limit */
    maxRate?: number
    /** Response time threshold for rate adjustment (ms) */
    responseTimeThreshold?: number
    /** How aggressively to adjust rates (0-1) */
    adjustmentFactor?: number
    /** Sample size for calculating average response time */
    sampleSize?: number
  }
  
/**
   * Adaptive rate limiter that adjusts based on response times
   */
export class AdaptiveRateLimiter implements RateLimiter {
    private tokenBucket: TokenBucketLimiter
    private responseTimes: number[] = []
    private readonly config: Required<AdaptiveRateLimiterConfig>
    private lastAdjustment: number = Date.now()
    private adjustmentInterval: number = 10000 // 10 seconds
  
    constructor( config: AdaptiveRateLimiterConfig = {} ) {
        this.config = {
            initialRate: config.initialRate ?? 5,
            minRate: config.minRate ?? 1,
            maxRate: config.maxRate ?? 20,
            responseTimeThreshold: config.responseTimeThreshold ?? 1000,
            adjustmentFactor: config.adjustmentFactor ?? 0.1,
            sampleSize: config.sampleSize ?? 20
        }
  
        this.tokenBucket = new TokenBucketLimiter( {
            capacity: this.config.initialRate * 2,
            refillRate: this.config.initialRate
        } )
    }
    canExecute(): boolean {
        throw new Error( "Method not implemented." )
    }
  
    /**
     * Execute a function with adaptive rate limiting
     */
    async execute<T>( fn: () => Promise<T> ): Promise<T> {
        const startTime = Date.now()
      
        const result = await this.tokenBucket.execute( async () => {
            return await fn()
        } )
      
        const responseTime = Date.now() - startTime
        this.recordResponseTime( responseTime )
        this.maybeAdjustRate()
      
        return result
    }
  
    /**
     * Get adaptive rate limiter statistics
     */
    getStats() {
        const tokenStats = this.tokenBucket.getStats()
        const avgResponseTime = this.getAverageResponseTime()
      
        return {
            ...tokenStats,
            currentRate: tokenStats.refillRate,
            averageResponseTime: avgResponseTime,
            responseTimeSamples: this.responseTimes.length,
            lastAdjustment: this.lastAdjustment,
            isAdaptingUp: avgResponseTime < this.config.responseTimeThreshold,
            isAdaptingDown: avgResponseTime > this.config.responseTimeThreshold
        }
    }
  
    /**
     * Reset the adaptive rate limiter
     */
    reset(): void {
        this.tokenBucket.reset()
        this.responseTimes = []
        this.lastAdjustment = Date.now()
    }
  
    // ============================================================================
    // PRIVATE METHODS
    // ============================================================================
  
    private recordResponseTime( responseTime: number ): void {
        this.responseTimes.push( responseTime )
      
        // Keep only the most recent samples
        if ( this.responseTimes.length > this.config.sampleSize ) {
            this.responseTimes.shift()
        }
    }
  
    private getAverageResponseTime(): number {
        if ( this.responseTimes.length === 0 ) return 0
      
        const sum = this.responseTimes.reduce( ( acc, time ) => acc + time, 0 )
        return sum / this.responseTimes.length
    }
  
    private maybeAdjustRate(): void {
        const now = Date.now()
      
        // Only adjust every interval and if we have enough samples
        if (
            now - this.lastAdjustment < this.adjustmentInterval ||
        this.responseTimes.length < Math.min( 5, this.config.sampleSize / 2 )
        ) {
            return
        }
  
        const avgResponseTime = this.getAverageResponseTime()
        const currentRate = this.tokenBucket.getStats().refillRate
        let newRate = currentRate
  
        if ( avgResponseTime > this.config.responseTimeThreshold ) {
        // Response times are too slow, decrease rate
            newRate = Math.max(
                this.config.minRate,
                currentRate * ( 1 - this.config.adjustmentFactor )
            )
        } else if ( avgResponseTime < this.config.responseTimeThreshold * 0.7 ) {
        // Response times are good, try increasing rate
            newRate = Math.min(
                this.config.maxRate,
                currentRate * ( 1 + this.config.adjustmentFactor )
            )
        }
  
        if ( Math.abs( newRate - currentRate ) > 0.1 ) {
            this.tokenBucket = new TokenBucketLimiter( {
                capacity: newRate * 2,
                refillRate: newRate,
                initialTokens: Math.min( newRate, this.tokenBucket.getAvailableTokens() )
            } )
        
            this.lastAdjustment = now
            console.debug( `Adaptive rate limiter: adjusted rate from ${currentRate.toFixed( 2 )} to ${newRate.toFixed( 2 )} req/s` )
        }
    }
}