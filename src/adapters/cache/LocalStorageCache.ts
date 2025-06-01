import { ICacheAdapter, CacheError, Either, error, success } from "../../types"

/**
 * Configuration for localStorage cache
 */
export type LocalStorageCacheConfig = {
    /** Key prefix for localStorage entries */
    prefix?: string
    /** Default TTL in milliseconds */
    defaultTTL?: number
    /** Maximum number of entries */
    maxEntries?: number
    /** Enable compression for large values */
    enableCompression?: boolean
  }
  
  /**
   * localStorage cache entry
   */
  type LocalStorageEntry<T = any> = {
    value: T
    timestamp: number
    ttl?: number
    accessCount: number
    lastAccessed: number
  }
  
/**
   * Fallback cache adapter using localStorage
   */
export class LocalStorageCache implements ICacheAdapter {
    private readonly prefix: string
    private readonly defaultTTL?: number
    private readonly maxEntries: number
    private readonly enableCompression: boolean
    private readonly metaKey: string
  
    constructor( config: LocalStorageCacheConfig = {} ) {
        this.prefix = config.prefix ?? "dm_cache_"
        this.defaultTTL = config.defaultTTL
        this.maxEntries = config.maxEntries ?? 1000
        this.enableCompression = config.enableCompression ?? false
        this.metaKey = `${this.prefix}__meta__`
  
        // Check localStorage availability
        if ( typeof localStorage === "undefined" ) {
            throw new Error( "localStorage is not available in this environment" )
        }
    }
  
    async get<T>( key: string ): Promise<Either<CacheError, T | undefined>> {
        try {
            const storageKey = this.prefix + key
            const rawData = localStorage.getItem( storageKey )
        
            if ( !rawData ) {
                return success( undefined )
            }
  
            const entry: LocalStorageEntry<T> = JSON.parse( rawData )
        
            // Check if expired
            if ( this.isExpired( entry ) ) {
                localStorage.removeItem( storageKey )
                this.updateMetadata( key, "delete" )
                return success( undefined )
            }
  
            // Update access metadata
            entry.accessCount++
            entry.lastAccessed = Date.now()
            localStorage.setItem( storageKey, JSON.stringify( entry ) )
  
            return success( entry.value )
        } catch ( err ) {
            return error( new CacheError(
                `localStorage get failed: ${err instanceof Error ? err.message : "Unknown error"}`,
                { key, error: err }
            ) )
        }
    }
  
    async set<T>( key: string, value: T, ttl?: number ): Promise<Either<CacheError, void>> {
        try {
            const storageKey = this.prefix + key
            const now = Date.now()
            const effectiveTTL = ttl ?? this.defaultTTL
        
            const entry: LocalStorageEntry<T> = {
                value: this.addTimestamp( value ),
                timestamp: now,
                ttl: effectiveTTL,
                accessCount: 1,
                lastAccessed: now
            }
  
            // Check if we need to evict
            await this.evictIfNeeded()
  
            const serialized = JSON.stringify( entry )
            localStorage.setItem( storageKey, serialized )
            this.updateMetadata( key, "set" )
  
            return success( undefined )
        } catch ( err ) {
        // Handle quota exceeded error
            if ( err instanceof Error && err.name === "QuotaExceededError" ) {
                // Try to free up space and retry
                await this.cleanup()
                try {
                    const entry: LocalStorageEntry<T> = {
                        value: this.addTimestamp( value ),
                        timestamp: Date.now(),
                        ttl: ttl ?? this.defaultTTL,
                        accessCount: 1,
                        lastAccessed: Date.now()
                    }
                    localStorage.setItem( this.prefix + key, JSON.stringify( entry ) )
                    this.updateMetadata( key, "set" )
                    return success( undefined )
                } catch ( retryErr ) {
                    return error( new CacheError(
                        "localStorage quota exceeded and cleanup failed",
                        { key, error: retryErr }
                    ) )
                }
            }
  
            return error( new CacheError(
                `localStorage set failed: ${err instanceof Error ? err.message : "Unknown error"}`,
                { key, error: err }
            ) )
        }
    }
  
    async delete( key: string ): Promise<Either<CacheError, void>> {
        try {
            const storageKey = this.prefix + key
            localStorage.removeItem( storageKey )
            this.updateMetadata( key, "delete" )
            return success( undefined )
        } catch ( err ) {
            return error( new CacheError(
                `localStorage delete failed: ${err instanceof Error ? err.message : "Unknown error"}`,
                { key, error: err }
            ) )
        }
    }
  
    async clear(): Promise<Either<CacheError, void>> {
        try {
            const keysToRemove: string[] = []
        
            for ( let i = 0; i < localStorage.length; i++ ) {
                const key = localStorage.key( i )
                if ( key && key.startsWith( this.prefix ) ) {
                    keysToRemove.push( key )
                }
            }
  
            keysToRemove.forEach( key => localStorage.removeItem( key ) )
            localStorage.removeItem( this.metaKey )
        
            return success( undefined )
        } catch ( err ) {
            return error( new CacheError(
                `localStorage clear failed: ${err instanceof Error ? err.message : "Unknown error"}`,
                { error: err }
            ) )
        }
    }
  
    async invalidate( pattern: string ): Promise<Either<CacheError, void>> {
        try {
            const regex = this.patternToRegex( pattern )
            const keysToRemove: string[] = []
        
            for ( let i = 0; i < localStorage.length; i++ ) {
                const storageKey = localStorage.key( i )
                if ( storageKey && storageKey.startsWith( this.prefix ) ) {
                    const key = storageKey.substring( this.prefix.length )
                    if ( regex.test( key ) ) {
                        keysToRemove.push( storageKey )
                    }
                }
            }
  
            keysToRemove.forEach( storageKey => {
                localStorage.removeItem( storageKey )
                const key = storageKey.substring( this.prefix.length )
                this.updateMetadata( key, "delete" )
            } )
        
            return success( undefined )
        } catch ( err ) {
            return error( new CacheError(
                `localStorage invalidate failed: ${err instanceof Error ? err.message : "Unknown error"}`,
                { pattern, error: err }
            ) )
        }
    }
  
    // ============================================================================
    // UTILITY METHODS
    // ============================================================================
  
    getStats() {
        let totalEntries = 0
        let expiredEntries = 0
        let estimatedSize = 0
  
        for ( let i = 0; i < localStorage.length; i++ ) {
            const key = localStorage.key( i )
            if ( key && key.startsWith( this.prefix ) && key !== this.metaKey ) {
                totalEntries++
                const data = localStorage.getItem( key )
                if ( data ) {
                    estimatedSize += data.length * 2 // UTF-16
                    try {
                        const entry: LocalStorageEntry = JSON.parse( data )
                        if ( this.isExpired( entry ) ) {
                            expiredEntries++
                        }
                    } catch {
                        // Ignore malformed entries
                    }
                }
            }
        }
  
        return {
            totalEntries,
            expiredEntries,
            estimatedSize,
            available: this.isAvailable()
        }
    }
  
    async cleanup(): Promise<number> {
        let cleanedCount = 0
        const keysToRemove: string[] = []
  
        for ( let i = 0; i < localStorage.length; i++ ) {
            const key = localStorage.key( i )
            if ( key && key.startsWith( this.prefix ) && key !== this.metaKey ) {
                const data = localStorage.getItem( key )
                if ( data ) {
                    try {
                        const entry: LocalStorageEntry = JSON.parse( data )
                        if ( this.isExpired( entry ) ) {
                            keysToRemove.push( key )
                        }
                    } catch {
                        // Remove malformed entries
                        keysToRemove.push( key )
                    }
                }
            }
        }
  
        keysToRemove.forEach( key => {
            localStorage.removeItem( key )
            cleanedCount++
        } )
  
        return cleanedCount
    }
  
    isAvailable(): boolean {
        try {
            const test = "__test__"
            localStorage.setItem( test, test )
            localStorage.removeItem( test )
            return true
        } catch {
            return false
        }
    }
  
    // ============================================================================
    // PRIVATE METHODS
    // ============================================================================
  
    private isExpired( entry: LocalStorageEntry ): boolean {
        if ( !entry.ttl ) return false
        return Date.now() - entry.timestamp > entry.ttl
    }
  
    private async evictIfNeeded(): Promise<void> {
        const stats = this.getStats()
        if ( stats.totalEntries >= this.maxEntries ) {
        // Simple LRU eviction: remove oldest accessed entries
            const entries: Array<{ key: string; lastAccessed: number }> = []
        
            for ( let i = 0; i < localStorage.length; i++ ) {
                const storageKey = localStorage.key( i )
                if ( storageKey && storageKey.startsWith( this.prefix ) && storageKey !== this.metaKey ) {
                    const data = localStorage.getItem( storageKey )
                    if ( data ) {
                        try {
                            const entry: LocalStorageEntry = JSON.parse( data )
                            entries.push( {
                                key: storageKey,
                                lastAccessed: entry.lastAccessed
                            } )
                        } catch {
                            // Remove malformed entries
                            localStorage.removeItem( storageKey )
                        }
                    }
                }
            }
  
            // Sort by last accessed and remove oldest 10%
            entries.sort( ( a, b ) => a.lastAccessed - b.lastAccessed )
            const toRemove = Math.max( 1, Math.floor( entries.length * 0.1 ) )
        
            for ( let i = 0; i < toRemove; i++ ) {
                localStorage.removeItem( entries[ i ].key )
            }
        }
    }
  
    private updateMetadata( key: string, operation: "set" | "delete" ): void {
        try {
            const metadata = this.getMetadata()
        
            if ( operation === "set" ) {
                metadata.keys.add( key )
            } else {
                metadata.keys.delete( key )
            }
        
            metadata.lastUpdated = Date.now()
        
            localStorage.setItem( this.metaKey, JSON.stringify( {
                keys: Array.from( metadata.keys ),
                lastUpdated: metadata.lastUpdated
            } ) )
        } catch {
        // Ignore metadata errors
        }
    }
  
    private getMetadata(): { keys: Set<string>; lastUpdated: number } {
        try {
            const data = localStorage.getItem( this.metaKey )
            if ( data ) {
                const parsed = JSON.parse( data )
                return {
                    keys: new Set( parsed.keys || [] ),
                    lastUpdated: parsed.lastUpdated || 0
                }
            }
        } catch {
        // Ignore errors
        }
      
        return {
            keys: new Set(),
            lastUpdated: Date.now()
        }
    }
  
    private patternToRegex( pattern: string ): RegExp {
        const escaped = pattern.replace( /[.+?^${}()|[\]\\]/g, "\\$&" )
        const regexPattern = escaped.replace( /\*/g, ".*" )
        return new RegExp( `^${regexPattern}$` )
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