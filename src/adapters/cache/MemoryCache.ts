import type { ICacheAdapter, Either } from "../../types"
import { success, error, CacheError } from "../../types"

/**
 * Configuration options for MemoryCache
 */
export type MemoryCacheConfig = {
  /** Maximum number of entries to store */
  maxSize?: number
  /** Default TTL in milliseconds */
  defaultTTL?: number
  /** How often to run cleanup (in milliseconds) */
  cleanupInterval?: number
}

/**
 * Internal cache entry with metadata
 */
type InternalCacheEntry<T = any> = {
  value: T
  timestamp: number
  ttl?: number
  accessCount: number
  lastAccessed: number
}

/**
 * High-performance in-memory cache with LRU eviction and TTL support
 */
export class MemoryCache implements ICacheAdapter {
    private store = new Map<string, InternalCacheEntry>()
    private accessOrder: string[] = []
    private cleanupTimer?: NodeJS.Timeout
  
    private readonly maxSize: number
    private readonly defaultTTL?: number
    private readonly cleanupInterval: number

    constructor( config: MemoryCacheConfig = {} ) {
        this.maxSize = config.maxSize ?? 1000
        this.defaultTTL = config.defaultTTL
        this.cleanupInterval = config.cleanupInterval ?? 60000 // 1 minute
    
        // Start periodic cleanup
        this.startCleanup()
    }

    /**
   * Retrieve a value from cache
   */
    async get<T>( key: string ): Promise<Either<CacheError, T | undefined>> {
        try {
            const entry = this.store.get( key )
      
            if ( !entry ) {
                return success( undefined )
            }

            // Check if entry has expired
            if ( this.isExpired( entry ) ) {
                this.store.delete( key )
                this.removeFromAccessOrder( key )
                return success( undefined )
            }

            // Update access metadata
            entry.accessCount++
            entry.lastAccessed = Date.now()
            this.updateAccessOrder( key )

            return success( entry.value as T )
        } catch ( err ) {
            return error( new CacheError(
                `Failed to get cache entry: ${err instanceof Error ? err.message : "Unknown error"}`,
                { key, error: err }
            ) )
        }
    }

    /**
   * Store a value in cache with optional TTL
   */
    async set<T>( key: string, value: T, ttl?: number ): Promise<Either<CacheError, void>> {
        try {
            const now = Date.now()
            const effectiveTTL = ttl ?? this.defaultTTL
      
            const entry: InternalCacheEntry<T> = {
                value: this.addTimestamp( value ),
                timestamp: now,
                ttl: effectiveTTL,
                accessCount: 1,
                lastAccessed: now
            }

            // If we're at capacity and this is a new key, evict LRU
            if ( this.store.size >= this.maxSize && !this.store.has( key ) ) {
                this.evictLRU()
            }

            this.store.set( key, entry )
            this.updateAccessOrder( key )

            return success( undefined )
        } catch ( err ) {
            return error( new CacheError(
                `Failed to set cache entry: ${err instanceof Error ? err.message : "Unknown error"}`,
                { key, error: err }
            ) )
        }
    }

    /**
   * Remove a specific key from cache
   */
    async delete( key: string ): Promise<Either<CacheError, void>> {
        try {
            this.store.delete( key )
            this.removeFromAccessOrder( key )
            return success( undefined )
        } catch ( err ) {
            return error( new CacheError(
                `Failed to delete cache entry: ${err instanceof Error ? err.message : "Unknown error"}`,
                { key, error: err }
            ) )
        }
    }

    /**
   * Clear all cached data
   */
    async clear(): Promise<Either<CacheError, void>> {
        try {
            this.store.clear()
            this.accessOrder = []
            return success( undefined )
        } catch ( err ) {
            return error( new CacheError(
                `Failed to clear cache: ${err instanceof Error ? err.message : "Unknown error"}`,
                { error: err }
            ) )
        }
    }

    /**
   * Invalidate cache entries matching a pattern (supports wildcards)
   */
    async invalidate( pattern: string ): Promise<Either<CacheError, void>> {
        try {
            const regex = this.patternToRegex( pattern )
            const keysToDelete: string[] = []

            for ( const key of this.store.keys() ) {
                if ( regex.test( key ) ) {
                    keysToDelete.push( key )
                }
            }

            for ( const key of keysToDelete ) {
                this.store.delete( key )
                this.removeFromAccessOrder( key )
            }

            return success( undefined )
        } catch ( err ) {
            return error( new CacheError(
                `Failed to invalidate cache entries: ${err instanceof Error ? err.message : "Unknown error"}`,
                { pattern, error: err }
            ) )
        }
    }

    // ============================================================================
    // UTILITY METHODS
    // ============================================================================

    /**
   * Get cache statistics
   */
    getStats() {
        let expiredCount = 0
        let totalSize = 0

        for ( const [ key, entry ] of this.store.entries() ) {
            if ( this.isExpired( entry ) ) {
                expiredCount++
            }
            // Rough size estimation
            totalSize += this.estimateSize( key, entry.value )
        }

        return {
            size: this.store.size,
            maxSize: this.maxSize,
            expiredCount,
            estimatedSizeBytes: totalSize,
            oldestEntry: this.accessOrder[ 0 ],
            newestEntry: this.accessOrder[ this.accessOrder.length - 1 ]
        }
    }

    /**
   * Force cleanup of expired entries
   */
    cleanup(): number {
        let removedCount = 0
        const keysToDelete: string[] = []

        for ( const [ key, entry ] of this.store.entries() ) {
            if ( this.isExpired( entry ) ) {
                keysToDelete.push( key )
            }
        }

        for ( const key of keysToDelete ) {
            this.store.delete( key )
            this.removeFromAccessOrder( key )
            removedCount++
        }

        return removedCount
    }

    /**
   * Destroy the cache and stop cleanup timer
   */
    destroy(): void {
        if ( this.cleanupTimer ) {
            clearInterval( this.cleanupTimer )
            this.cleanupTimer = undefined
        }
        this.store.clear()
        this.accessOrder = []
    }

    // ============================================================================
    // PRIVATE METHODS
    // ============================================================================

    private isExpired( entry: InternalCacheEntry ): boolean {
        if ( !entry.ttl ) return false
        return Date.now() - entry.timestamp > entry.ttl
    }

    private evictLRU(): void {
        if ( this.accessOrder.length === 0 ) return
    
        const lruKey = this.accessOrder[ 0 ]
        this.store.delete( lruKey )
        this.accessOrder.shift()
    }

    private updateAccessOrder( key: string ): void {
    // Remove from current position
        this.removeFromAccessOrder( key )
        // Add to end (most recently used)
        this.accessOrder.push( key )
    }

    private removeFromAccessOrder( key: string ): void {
        const index = this.accessOrder.indexOf( key )
        if ( index !== -1 ) {
            this.accessOrder.splice( index, 1 )
        }
    }

    private patternToRegex( pattern: string ): RegExp {
    // Escape special regex characters except *
        const escaped = pattern.replace( /[.+?^${}()|[\]\\]/g, "\\$&" )
        // Convert * to .*
        const regexPattern = escaped.replace( /\*/g, ".*" )
        return new RegExp( `^${regexPattern}$` )
    }

    private estimateSize( key: string, value: any ): number {
    // Rough estimation in bytes
        const keySize = key.length * 2 // Assuming UTF-16
        let valueSize = 0

        if ( typeof value === "string" ) {
            valueSize = value.length * 2
        } else if ( typeof value === "number" ) {
            valueSize = 8
        } else if ( typeof value === "boolean" ) {
            valueSize = 4
        } else {
            // For objects, use JSON string length as approximation
            try {
                valueSize = JSON.stringify( value ).length * 2
            } catch {
                valueSize = 100 // Fallback estimate
            }
        }

        return keySize + valueSize + 64 // Add overhead for metadata
    }

    private startCleanup(): void {
        this.cleanupTimer = setInterval( () => {
            this.cleanup()
        }, this.cleanupInterval )

        // Don't keep the process alive just for cleanup
        if ( this.cleanupTimer.unref ) {
            this.cleanupTimer.unref()
        }
    }

    private addTimestamp<T>( value: T ): T {
        if ( value && typeof value === "object" && !Array.isArray( value ) ) {
            return {
                ...value as any,
                _timestamp: Date.now()
            }
        }
        return value
    }
}
