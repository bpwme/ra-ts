import type { Either } from "./core"
import type { ICacheAdapter, IQueueAdapter, IRateLimiter, IStreamAdapter, ILogger, IMonitor, IValidator } from "./adapters"
import type { CacheError } from "./errors"

/**
 * Configuration options for DataManager
 */
export type DataManagerConfig = {
    // Core adapters
    cache?: ICacheAdapter
    queue?: IQueueAdapter
    rateLimiter?: IRateLimiter
    stream?: IStreamAdapter
    
    // Extensions
    logger?: ILogger
    monitor?: IMonitor
    
    // Global options
    defaultTTL?: number
    enableOptimisticUpdates?: boolean
    
    // Security options
    securityValidator?: IValidator
    enableSanitization?: boolean
}

/**
 * Options for query operations
 */
export type QueryOptions<T = any> = {
    /**
     * Time in ms after which cached data is considered stale
     */
    staleTime?: number
    
    /**
     * Time in ms to keep data in cache (TTL)
     */
    ttl?: number
    
    /**
     * Maximum number of retry attempts
     */
    maxRetries?: number
    
    /**
     * Schema validator for response data
     */
    schema?: IValidator<T>

    /**
     * Whether to sanitize the response data
     */
    sanitize?: boolean
}

/**
 * Options for mutation operations
 */
export type MutationOptions<T = any> = {
    /**
     * Data to show optimistically while mutation is pending
     */
    optimisticUpdate?: T
    
    /**
     * Cache patterns to invalidate after successful mutation
     */
    invalidates?: string[]
    
    /**
     * Maximum number of retry attempts
     */
    maxRetries?: number
    
    /**
     * Time in ms to keep mutation result in cache
     */
    ttl?: number
    
    /**
     * Schema validator for mutation response
     */
    schema?: IValidator<T>

    /**
     * Whether to sanitize the response data
     */
    sanitize?: boolean
}

/**
 * Cache warming strategy configuration
 */
export type CacheWarmingConfig = {
    /** Enable background cache warming */
    enabled: boolean
    /** Patterns to warm on startup */
    warmupPatterns?: string[]
    /** Custom warming function */
    warmupFunction?: () => Promise<Either<CacheError, void>>
    /** Warming interval in ms */
    warmupInterval?: number
    /** Maximum warming concurrency */
    maxConcurrency?: number
    /** Warming priority levels */
    priority?: "low" | "medium" | "high"
}

/**
 * Cache partition configuration for multi-tenancy
 */
export type CachePartitionConfig = {
    /** Enable cache partitioning */
    enabled: boolean
    /** Default partition key */
    defaultPartition?: string
    /** Partition key generator function */
    partitionKeyFn?: ( key: string, context?: any ) => string
    /** Isolation level */
    isolationLevel?: "strict" | "soft"
    /** Cross-partition access rules */
    crossPartitionAccess?: boolean
}

/**
 * Cache compression configuration
 */
export type CacheCompressionConfig = {
    /** Enable compression */
    enabled: boolean
    /** Compression threshold in bytes */
    threshold: number
    /** Compression algorithm */
    algorithm?: "gzip" | "deflate" | "brotli"
    /** Compression level (1-9) */
    level?: number
}

/**
 * Cache level configuration for multi-level hierarchies
 */
export type CacheLevelConfig = {
    /** Level identifier */
    level: number
    /** Level name */
    name: string
    /** Cache adapter for this level */
    adapter: ICacheAdapter
    /** Maximum size for this level */
    maxSize?: number
    /** Default TTL for this level */
    defaultTTL?: number
    /** Promotion criteria */
    promotionCriteria?: {
        accessCount?: number
        accessFrequency?: number
        size?: number
    }
    /** Demotion criteria */
    demotionCriteria?: {
        staleness?: number
        size?: number
        accessPattern?: string
    }
}

/**
 * Cache synchronization configuration across tabs
 */
export type CacheSyncConfig = {
    /** Enable cross-tab synchronization */
    enabled: boolean
    /** Synchronization channel */
    channel?: string
    /** Sync strategy */
    strategy?: "broadcast" | "leader-follower" | "peer-to-peer"
    /** Conflict resolution */
    conflictResolution?: "last-write-wins" | "merge" | "custom"
    /** Custom conflict resolver */
    conflictResolver?: ( local: any, remote: any ) => any
}

/**
 * Multi-level cache manager configuration
 */
export type MultiLevelCacheConfig = {
    /** Cache levels (L1, L2, etc.) */
    levels: CacheLevelConfig[]
    /** Automatic promotion/demotion */
    autoOptimize?: boolean
    /** Optimization interval in ms */
    optimizationInterval?: number
    /** Cross-level consistency strategy */
    consistencyStrategy?: "eventual" | "strict" | "custom"
    /** Custom consistency handler */
    consistencyHandler?: ( levels: CacheLevelConfig[] ) => Promise<void>
} 