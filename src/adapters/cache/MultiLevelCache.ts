import {
    AdvancedCacheAdapter,
    MultiLevelCacheConfig,
    CacheLevelConfig,
    CacheAnalytics,
    CacheError,
    Either,
    success,
    error,
    Logger
} from "../../types"

/**
 * Configuration for MultiLevelCache implementation
 */
export type MultiLevelCacheImplConfig = MultiLevelCacheConfig & {
    /** Logger for debugging */
    logger?: Logger
    /** Enable access pattern tracking */
    trackAccessPatterns?: boolean
    /** Promotion threshold (access count) */
    promotionThreshold?: number
    /** Demotion threshold (staleness in ms) */
    demotionThreshold?: number
}

/**
 * Access pattern tracking data
 */
type AccessPattern = {
    key: string
    accessCount: number
    lastAccessed: number
    level: number
    size: number
    promotionScore: number
}

/**
 * Multi-level cache with automatic promotion/demotion
 */
export class MultiLevelCache implements AdvancedCacheAdapter {
    private config: Required<Omit<MultiLevelCacheImplConfig, "consistencyHandler" | "logger">> & Pick<MultiLevelCacheImplConfig, "consistencyHandler" | "logger">
    private levels: CacheLevelConfig[]
    private accessPatterns = new Map<string, AccessPattern>()
    private optimizationTimer?: NodeJS.Timeout
    private analytics: CacheAnalytics = {
        hitCount: 0,
        missCount: 0,
        hitRate: 0,
        averageAccessTime: 0,
        totalSize: 0,
        entryCount: 0,
        evictionCount: 0,
        popularKeys: [],
        largestEntries: []
    }

    constructor( config: MultiLevelCacheImplConfig ) {
        this.config = {
            autoOptimize: true,
            optimizationInterval: 300000, // 5 minutes
            consistencyStrategy: "eventual",
            trackAccessPatterns: true,
            promotionThreshold: 3,
            demotionThreshold: 3600000, // 1 hour
            ...config
        }

        this.levels = config.levels.sort( ( a, b ) => a.level - b.level )
        
        if ( this.config.autoOptimize ) {
            this.startOptimization()
        }
    }

    /**
     * Get value from cache, checking levels in order
     */
    async get<T>( key: string ): Promise<Either<CacheError, T | undefined>> {
        const startTime = Date.now()
        
        try {
            // Check each level starting from fastest (L1)
            for ( let i = 0; i < this.levels.length; i++ ) {
                const level = this.levels[ i ]
                const result = await level.adapter.get<T>( key )
                
                if ( result.error ) {
                    this.log( "warn", `Level ${level.level} get error`, { key, error: result.error } )
                    continue
                }
                
                if ( result.data !== undefined ) {
                    this.analytics.hitCount++
                    this.updateAccessPattern( key, i, result.data )
                    
                    // Promote to higher levels if not already there
                    if ( i > 0 ) {
                        await this.promoteValue( key, result.data, i )
                    }
                    
                    this.updateAverageAccessTime( Date.now() - startTime )
                    this.log( "debug", `Cache hit at level ${level.level}`, { key, level: level.level } )
                    
                    return success( result.data )
                }
            }
            
            // Cache miss
            this.analytics.missCount++
            this.updateHitRate()
            this.log( "debug", "Cache miss", { key } )
            
            return success( undefined )
        } catch ( err ) {
            return error( new CacheError( "Multi-level get failed", { key, error: err } ) )
        }
    }

    /**
     * Set value in cache, storing at appropriate level
     */
    async set<T>( key: string, value: T, ttl?: number ): Promise<Either<CacheError, void>> {
        try {
            const valueSize = this.estimateSize( value )
            let targetLevel = 0
            
            // Determine appropriate level based on size and access patterns
            const pattern = this.accessPatterns.get( key )
            if ( pattern ) {
                targetLevel = this.calculateOptimalLevel( pattern, valueSize )
            } else {
                // New entries start at L1 (fastest)
                targetLevel = 0
            }
            
            const level = this.levels[ targetLevel ]
            const result = await level.adapter.set( key, value, ttl || level.defaultTTL )
            
            if ( result.error ) {
                this.log( "error", `Failed to set at level ${level.level}`, { key, error: result.error } )
                return result
            }
            
            // Update access pattern
            this.updateAccessPattern( key, targetLevel, value )
            
            // Update analytics
            this.analytics.entryCount++
            this.analytics.totalSize += valueSize
            
            this.log( "debug", `Stored at level ${level.level}`, { key, level: level.level, size: valueSize } )
            
            return success( undefined )
        } catch ( err ) {
            return error( new CacheError( "Multi-level set failed", { key, error: err } ) )
        }
    }

    /**
     * Delete key from all levels
     */
    async delete( key: string ): Promise<Either<CacheError, void>> {
        const errors: any[] = []
        
        for ( const level of this.levels ) {
            const result = await level.adapter.delete( key )
            if ( result.error ) {
                errors.push( { level: level.level, error: result.error } )
            }
        }
        
        // Remove from access patterns
        this.accessPatterns.delete( key )
        
        if ( errors.length > 0 ) {
            this.log( "warn", "Partial delete failures", { key, errors } )
        }
        
        return success( undefined )
    }

    /**
     * Clear all levels
     */
    async clear(): Promise<Either<CacheError, void>> {
        const errors: any[] = []
        
        for ( const level of this.levels ) {
            const result = await level.adapter.clear()
            if ( result.error ) {
                errors.push( { level: level.level, error: result.error } )
            }
        }
        
        // Clear patterns and analytics
        this.accessPatterns.clear()
        this.resetAnalytics()
        
        if ( errors.length > 0 ) {
            this.log( "warn", "Partial clear failures", { errors } )
            return error( new CacheError( "Failed to clear all levels", { errors } ) )
        }
        
        return success( undefined )
    }

    /**
     * Invalidate pattern across all levels
     */
    async invalidate( pattern: string ): Promise<Either<CacheError, void>> {
        const errors: any[] = []
        
        for ( const level of this.levels ) {
            const result = await level.adapter.invalidate( pattern )
            if ( result.error ) {
                errors.push( { level: level.level, error: result.error } )
            }
        }
        
        // Remove matching patterns
        const regex = new RegExp( pattern.replace( /\*/g, ".*" ) )
        for ( const [ key ] of this.accessPatterns ) {
            if ( regex.test( key ) ) {
                this.accessPatterns.delete( key )
            }
        }
        
        if ( errors.length > 0 ) {
            this.log( "warn", "Partial invalidation failures", { pattern, errors } )
        }
        
        return success( undefined )
    }

    /**
     * Get cache analytics across all levels
     */
    async getAnalytics(): Promise<Either<CacheError, CacheAnalytics>> {
        try {
            // Aggregate analytics from all levels
            let totalSize = 0
            let entryCount = 0
            
            for ( const level of this.levels ) {
                if ( ( level.adapter as AdvancedCacheAdapter ).getAnalytics ) {
                    const result = await ( level.adapter as AdvancedCacheAdapter ).getAnalytics!()
                    if ( result.success ) {
                        totalSize += result.data.totalSize
                        entryCount += result.data.entryCount
                    }
                }
            }
            
            // Update current analytics
            this.analytics.totalSize = totalSize
            this.analytics.entryCount = entryCount
            this.analytics.popularKeys = this.getPopularKeys()
            this.analytics.largestEntries = this.getLargestEntries()
            
            return success( { ...this.analytics } )
        } catch ( err ) {
            return error( new CacheError( "Failed to get analytics", { error: err } ) )
        }
    }

    /**
     * Optimize cache by promoting/demoting entries
     */
    async optimize(): Promise<Either<CacheError, void>> {
        try {
            this.log( "info", "Starting cache optimization" )
            
            const now = Date.now()
            const promotions: Array<{ key: string; fromLevel: number; toLevel: number }> = []
            const demotions: Array<{ key: string; fromLevel: number; toLevel: number }> = []
            
            // Analyze access patterns for optimization opportunities
            for ( const [ key, pattern ] of this.accessPatterns ) {
                const shouldPromote = this.shouldPromote( pattern, now )
                const shouldDemote = this.shouldDemote( pattern, now )
                
                if ( shouldPromote && pattern.level > 0 ) {
                    promotions.push( { key, fromLevel: pattern.level, toLevel: pattern.level - 1 } )
                } else if ( shouldDemote && pattern.level < this.levels.length - 1 ) {
                    demotions.push( { key, fromLevel: pattern.level, toLevel: pattern.level + 1 } )
                }
            }
            
            // Execute promotions
            for ( const promotion of promotions ) {
                await this.moveEntry( promotion.key, promotion.fromLevel, promotion.toLevel )
            }
            
            // Execute demotions
            for ( const demotion of demotions ) {
                await this.moveEntry( demotion.key, demotion.fromLevel, demotion.toLevel )
            }
            
            this.log( "info", "Cache optimization completed", { 
                promotions: promotions.length, 
                demotions: demotions.length 
            } )
            
            return success( undefined )
        } catch ( err ) {
            return error( new CacheError( "Cache optimization failed", { error: err } ) )
        }
    }

    /**
     * Get cache size across all levels
     */
    async getSize(): Promise<Either<CacheError, number>> {
        try {
            let totalSize = 0
            
            for ( const level of this.levels ) {
                if ( ( level.adapter as AdvancedCacheAdapter ).getSize ) {
                    const result = await ( level.adapter as AdvancedCacheAdapter ).getSize!()
                    if ( result.success ) {
                        totalSize += result.data
                    }
                }
            }
            
            return success( totalSize )
        } catch ( err ) {
            return error( new CacheError( "Failed to get cache size", { error: err } ) )
        }
    }

    /**
     * Start automatic optimization
     */
    private startOptimization(): void {
        if ( this.optimizationTimer ) {
            clearInterval( this.optimizationTimer )
        }
        
        this.optimizationTimer = setInterval( async () => {
            const result = await this.optimize()
            if ( result.error ) {
                this.log( "error", "Scheduled optimization failed", { error: result.error } )
            }
        }, this.config.optimizationInterval )
    }

    /**
     * Stop automatic optimization
     */
    private stopOptimization(): void {
        if ( this.optimizationTimer ) {
            clearInterval( this.optimizationTimer )
            this.optimizationTimer = undefined
        }
    }

    /**
     * Promote value to higher cache levels
     */
    private async promoteValue<T>( key: string, value: T, currentLevel: number ): Promise<void> {
        // Promote to all higher levels
        for ( let i = currentLevel - 1; i >= 0; i-- ) {
            const level = this.levels[ i ]
            await level.adapter.set( key, value, level.defaultTTL )
        }
    }

    /**
     * Move entry between levels
     */
    private async moveEntry( key: string, fromLevel: number, toLevel: number ): Promise<void> {
        try {
            const sourceLevel = this.levels[ fromLevel ]
            const targetLevel = this.levels[ toLevel ]
            
            // Get value from source level
            const getResult = await sourceLevel.adapter.get( key )
            if ( getResult.error || getResult.data === undefined ) {
                return
            }
            
            // Set in target level
            const setResult = await targetLevel.adapter.set( key, getResult.data, targetLevel.defaultTTL )
            if ( setResult.error ) {
                this.log( "warn", "Failed to move entry to target level", { key, fromLevel, toLevel } )
                return
            }
            
            // Remove from source level
            await sourceLevel.adapter.delete( key )
            
            // Update access pattern
            const pattern = this.accessPatterns.get( key )
            if ( pattern ) {
                pattern.level = toLevel
            }
            
            this.log( "debug", "Moved entry between levels", { key, fromLevel, toLevel } )
        } catch ( err ) {
            this.log( "error", "Failed to move entry", { key, fromLevel, toLevel, error: err } )
        }
    }

    /**
     * Update access pattern for a key
     */
    private updateAccessPattern<T>( key: string, level: number, value: T ): void {
        if ( !this.config.trackAccessPatterns ) return
        
        const now = Date.now()
        const pattern = this.accessPatterns.get( key ) || {
            key,
            accessCount: 0,
            lastAccessed: now,
            level,
            size: this.estimateSize( value ),
            promotionScore: 0
        }
        
        pattern.accessCount++
        pattern.lastAccessed = now
        pattern.level = level
        pattern.promotionScore = this.calculatePromotionScore( pattern )
        
        this.accessPatterns.set( key, pattern )
    }

    /**
     * Calculate optimal level for a value
     */
    private calculateOptimalLevel( pattern: AccessPattern, size: number ): number {
        // Frequently accessed, small items go to L1
        if ( pattern.accessCount >= this.config.promotionThreshold && size < 1024 ) {
            return 0
        }
        
        // Medium frequency items go to L2
        if ( pattern.accessCount >= 2 ) {
            return Math.min( 1, this.levels.length - 1 )
        }
        
        // Large or infrequently accessed items go to lowest level
        return this.levels.length - 1
    }

    /**
     * Calculate promotion score for an access pattern
     */
    private calculatePromotionScore( pattern: AccessPattern ): number {
        const recency = Date.now() - pattern.lastAccessed
        const frequency = pattern.accessCount
        const sizeScore = Math.max( 0, 1000 - pattern.size ) / 1000 // Smaller is better
        
        return ( frequency * 0.5 ) + ( sizeScore * 0.3 ) + ( Math.max( 0, 1 - recency / 3600000 ) * 0.2 )
    }

    /**
     * Check if entry should be promoted
     */
    private shouldPromote( pattern: AccessPattern, now: number ): boolean {
        return pattern.accessCount >= this.config.promotionThreshold &&
               pattern.promotionScore > 0.7 &&
               ( now - pattern.lastAccessed ) < 300000 // Accessed within 5 minutes
    }

    /**
     * Check if entry should be demoted
     */
    private shouldDemote( pattern: AccessPattern, now: number ): boolean {
        return ( now - pattern.lastAccessed ) > this.config.demotionThreshold ||
               pattern.promotionScore < 0.3
    }

    /**
     * Estimate size of a value in bytes
     */
    private estimateSize( value: any ): number {
        try {
            return JSON.stringify( value ).length * 2 // Rough estimate (UTF-16)
        } catch {
            return 1000 // Default estimate for non-serializable values
        }
    }

    /**
     * Get popular keys for analytics
     */
    private getPopularKeys(): Array<{ key: string; accessCount: number }> {
        return Array.from( this.accessPatterns.values() )
            .sort( ( a, b ) => b.accessCount - a.accessCount )
            .slice( 0, 10 )
            .map( p => ( { key: p.key, accessCount: p.accessCount } ) )
    }

    /**
     * Get largest entries for analytics
     */
    private getLargestEntries(): Array<{ key: string; size: number }> {
        return Array.from( this.accessPatterns.values() )
            .sort( ( a, b ) => b.size - a.size )
            .slice( 0, 10 )
            .map( p => ( { key: p.key, size: p.size } ) )
    }

    /**
     * Update hit rate calculation
     */
    private updateHitRate(): void {
        const total = this.analytics.hitCount + this.analytics.missCount
        this.analytics.hitRate = total > 0 ? this.analytics.hitCount / total : 0
    }

    /**
     * Update average access time
     */
    private updateAverageAccessTime( time: number ): void {
        const currentAvg = this.analytics.averageAccessTime
        const total = this.analytics.hitCount + this.analytics.missCount
        
        this.analytics.averageAccessTime = total > 1 
            ? ( currentAvg * ( total - 1 ) + time ) / total 
            : time
    }

    /**
     * Reset analytics
     */
    private resetAnalytics(): void {
        this.analytics = {
            hitCount: 0,
            missCount: 0,
            hitRate: 0,
            averageAccessTime: 0,
            totalSize: 0,
            entryCount: 0,
            evictionCount: 0,
            popularKeys: [],
            largestEntries: []
        }
    }

    /**
     * Log messages with optional logger
     */
    private log( level: "debug" | "info" | "warn" | "error", message: string, data?: any ): void {
        if ( this.config.logger ) {
            this.config.logger[ level ]( `[MultiLevelCache] ${message}`, data )
        }
    }

    /**
     * Cleanup resources
     */
    destroy(): void {
        this.stopOptimization()
        this.accessPatterns.clear()
        this.resetAnalytics()
    }
} 