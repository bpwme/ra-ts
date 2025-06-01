/**
 * Cache adapter interface for storing and retrieving data
 */
export type CacheAdapter = {
    /**
     * Retrieve a value from cache
     */
    get<T>( key: string ): Promise<Either<CacheError, T | undefined>>
    
    /**
     * Store a value in cache with optional TTL
     */
    set<T>( key: string, value: T, ttl?: number ): Promise<Either<CacheError, void>>
    
    /**
     * Remove a specific key from cache
     */
    delete( key: string ): Promise<Either<CacheError, void>>
    
    /**
     * Clear all cached data
     */
    clear(): Promise<Either<CacheError, void>>
    
    /**
     * Invalidate cache entries matching a pattern (supports wildcards)
     */
    invalidate( pattern: string ): Promise<Either<CacheError, void>>
}

/**
 * Queue adapter interface for managing offline operations
 */
export type QueueAdapter = {
    /**
     * Add a job to the queue
     */
    add<T>( job: QueueJob<T> ): Promise<Either<QueueError, void>>
    
    /**
     * Process jobs with a handler function
     */
    process<T>( handler: ( job: QueueJob<T> ) => Promise<Either<any, T>> ): void
    
    /**
     * Retry a failed job
     */
    retry<T>( job: QueueJob<T> ): Promise<Either<QueueError, void>>
}

/**
 * Rate limiter interface for controlling request frequency
 */
export type RateLimiter = {
    /**
     * Execute a function with rate limiting applied
     */
    execute<T>( fn: () => Promise<T> ): Promise<T>
}

/**
 * Logger interface for debugging and monitoring
 */
export type Logger = {
    debug( message: string, data?: any ): void
    info( message: string, data?: any ): void
    warn( message: string, data?: any ): void
    error( message: string, data?: any ): void
}

/**
 * Schema validator interface for data validation
 */
export type Validator<T = any> = {
    /**
     * Parse and validate data, returning Either result
     */
    parse( data: unknown ): Either<ValidationError, T>
    
    /**
     * Safely parse data (alias for parse for consistency)
     */
    safeParse( data: unknown ): Either<ValidationError, T>
    
    /**
     * Validate data and return sanitized version
     */
    validate?( data: unknown ): Promise<Either<ValidationError, T>>
}

/**
 * WebSocket connection states
 */
export enum WebSocketState {
    CONNECTING = "connecting",
    CONNECTED = "connected",
    DISCONNECTING = "disconnecting",
    DISCONNECTED = "disconnected",
    ERROR = "error"
}

/**
 * Stream statistics for monitoring WebSocket performance
 */
export type StreamStats = {
    connectionCount: number
    reconnectionCount: number
    messagesReceived: number
    messagesSent: number
    subscriptionCount: number
    lastConnectedAt?: Date
    lastDisconnectedAt?: Date
    averageLatency?: number
}

/**
 * WebSocket message structure
 */
export type StreamMessage = {
    channel: string
    type: string
    data: any
    timestamp: Date
    messageId?: string
}

/**
 * Stream subscription handler
 */
export type StreamHandler = ( message: StreamMessage ) => void | Promise<void>

/**
 * Stream adapter interface for real-time data synchronization
 */
export type StreamAdapter = {
    /**
     * Establish WebSocket connection
     */
    connect(): Promise<Either<StreamError, void>>
    
    /**
     * Close WebSocket connection
     */
    disconnect(): Promise<Either<StreamError, void>>
    
    /**
     * Subscribe to a channel with message handler
     */
    subscribe( channel: string, handler: StreamHandler ): Promise<Either<StreamError, void>>
    
    /**
     * Unsubscribe from a channel
     */
    unsubscribe( channel: string, handler?: StreamHandler ): Promise<Either<StreamError, void>>
    
    /**
     * Send message through WebSocket
     */
    sendMessage?( message: StreamMessage ): Promise<Either<StreamError, void>>
    
    /**
     * Get current connection state
     */
    getState?(): WebSocketState
    
    /**
     * Get connection and usage statistics
     */
    getStats?(): StreamStats
}

/**
 * Batch request configuration for timing and sizing
 */
export type BatchConfig = {
    /** Maximum number of requests per batch */
    maxBatchSize: number
    /** Maximum time to wait before executing a batch (ms) */
    maxWaitTime: number
    /** Maximum number of concurrent batches */
    maxConcurrency?: number
    /** Function to generate batch keys for grouping requests */
    batchKeyFn?: ( request: any ) => string
    /** Custom batch executor function */
    batchExecutor?: <T, R>( requests: T[] ) => Promise<Either<any, R[]>>
}

/**
 * Batch statistics for monitoring performance
 */
export type BatchStats = {
    totalRequests: number
    totalBatches: number
    averageBatchSize: number
    pendingRequests: number
    activeBatches: number
    averageWaitTime: number
    cacheHitRate?: number
    lastBatchAt?: Date
}

/**
 * Individual request in a batch
 */
export type BatchRequest<T = any> = {
    id: string
    data: T
    timestamp: Date
    resolve: ( result: Either<any, any> ) => void
    reject: ( error: any ) => void
}

/**
 * Batch of requests ready for execution
 */
export type RequestBatch<T = any> = {
    id: string
    key: string
    requests: BatchRequest<T>[]
    createdAt: Date
    size: number
}

/**
 * Request batcher interface for optimizing API calls
 */
export type RequestBatcher<T = any, R = any> = {
    /**
     * Add a request to the batch queue
     */
    batchRequest( request: T ): Promise<Either<any, R>>
    
    /**
     * Get current batch statistics
     */
    getStats(): BatchStats
    
    /**
     * Clear all pending requests
     */
    clearPending(): void
    
    /**
     * Flush all pending batches immediately
     */
    flush?(): Promise<void>
    
    /**
     * Check if batcher is active
     */
    isActive?(): boolean
}

/**
 * Optional monitor interface for metrics and observability
 */
export type Monitor = {
    /**
     * Track an event with optional data
     */
    track( event: string, data?: any ): void
    
    /**
     * Start a timer, returns function to stop and record duration
     */
    startTimer( name: string ): () => void
    
    /**
     * Record a metric value
     */
    recordMetric( name: string, value: number ): void
}

// ============================================================================
// CORE TYPES
// ============================================================================

/**
 * Either type system for explicit error handling
 */
export type Either<E, T> =
    | {
        error: E
        data: null
        success: false
    }
    | {
        error: null
        data: T
        success: true
    }

export function success<T>( data: T ): Either<never, T> {
    return {
        error: null,
        data,
        success: true,
    }
}

export function error<E>( error: E ): Either<E, never> {
    return {
        error,
        data: null,
        success: false,
    }
}

// Utilities
export function isSuccess<E, T>( either: Either<E, T> ): either is {
    error: null
    data: T
    success: true
} {
    return either.success === true
}

export function isError<E, T>( either: Either<E, T> ): either is {
    error: E
    data: null
    success: false
} {
    return either.success === false
}

export function map<E, T, U>( either: Either<E, T>, fn: ( value: T ) => U ): Either<E, U> {
    if ( isSuccess( either ) ) {
        return success( fn( either.data ) )
    }
    return either
}

export function flatMap<E, T, U>( either: Either<E, T>, fn: ( value: T ) => Either<E, U> ): Either<E, U> {
    if ( isSuccess( either ) ) {
        return fn( either.data )
    }
    return either
}

/**
 * Job definition for queue operations
 */
export type QueueJob<T = any> = {
    id: string
    type: string
    payload: T
    retries: number
    maxRetries: number
    createdAt: Date
}

/**
 * Configuration options for DataManager
 */
export type DataManagerConfig = {
    // Core adapters
    cache?: CacheAdapter
    queue?: QueueAdapter
    rateLimiter?: RateLimiter
    stream?: StreamAdapter
    
    // Extensions
    logger?: Logger
    monitor?: Monitor
    
    // Global options
    defaultTTL?: number
    enableOptimisticUpdates?: boolean
    
    // Security options
    securityValidator?: Validator
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
    schema?: Validator<T>

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
    schema?: Validator<T>

    /**
     * Whether to sanitize the response data
     */
    sanitize?: boolean
}

// ============================================================================
// ERROR TYPES
// ============================================================================

/**
 * Base error class for DataManager operations
 */
export class DataManagerError extends Error {
    constructor(
        message: string,
        public readonly code: string,
        public readonly context?: any
    ) {
        super( message )
        this.name = "DataManagerError"
    }
}

/**
 * Error thrown when validation fails
 */
export class ValidationError extends DataManagerError {
    constructor( message: string, context?: any ) {
        super( message, "VALIDATION_ERROR", context )
        this.name = "ValidationError"
    }
}

/**
 * Error thrown when network operations fail
 */
export class NetworkError extends DataManagerError {
    constructor( message: string, context?: any ) {
        super( message, "NETWORK_ERROR", context )
        this.name = "NetworkError"
    }
}

/**
 * Error thrown when cache operations fail
 */
export class CacheError extends DataManagerError {
    constructor( message: string, context?: any ) {
        super( message, "CACHE_ERROR", context )
        this.name = "CacheError"
    }
}

/**
 * Error thrown when rate limiting is exceeded
 */
export class RateLimitError extends DataManagerError {
    constructor( message: string, context?: any ) {
        super( message, "RATE_LIMIT_ERROR", context )
        this.name = "RateLimitError"
    }
}

/**
 * Error thrown when queue operations fail
 */
export class QueueError extends DataManagerError {
    constructor( message: string, context?: any ) {
        super( message, "QUEUE_ERROR", context )
        this.name = "QueueError"
    }
}

/**
 * Error thrown when WebSocket/stream operations fail
 */
export class StreamError extends DataManagerError {
    constructor( message: string, context?: any ) {
        super( message, "STREAM_ERROR", context )
        this.name = "StreamError"
    }
}

/**
 * Error thrown when batch operations fail
 */
export class BatchError extends DataManagerError {
    constructor( message: string, context?: any ) {
        super( message, "BATCH_ERROR", context )
        this.name = "BatchError"
    }
}

// ============================================================================
// UTILITY TYPES
// ============================================================================

/**
 * Extract the return type of a fetcher function
 */
export type FetcherReturnType<T extends ( ...args: any[] ) => any> = 
    T extends ( ...args: any[] ) => Promise<infer R> ? R : 
    T extends ( ...args: any[] ) => infer R ? R : 
    never

/**
 * Make certain properties required
 */
export type RequireFields<T, K extends keyof T> = T & Required<Pick<T, K>>

/**
 * Cache entry with metadata
 */
export type CacheEntry<T = any> = {
    value: T
    timestamp: number
    ttl?: number
    tags?: string[]
}

/**
 * Cache dependency tracking for invalidation chains
 */
export type CacheDependency = {
    key: string
    pattern?: string
    tags?: string[]
    timestamp: number
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
 * Cache analytics data
 */
export type CacheAnalytics = {
    hitCount: number
    missCount: number
    hitRate: number
    averageAccessTime: number
    totalSize: number
    entryCount: number
    evictionCount: number
    compressionRatio?: number
    lastAccessTime?: Date
    popularKeys: Array<{ key: string; accessCount: number }>
    largestEntries: Array<{ key: string; size: number }>
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
    adapter: CacheAdapter
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
 * Advanced cache adapter interface with sophisticated features
 */
export type AdvancedCacheAdapter = CacheAdapter & {
    /**
     * Track cache dependencies
     */
    trackDependency?: ( key: string, dependency: CacheDependency ) => Promise<Either<CacheError, void>>
    
    /**
     * Invalidate by dependency
     */
    invalidateByDependency?: ( dependency: string ) => Promise<Either<CacheError, string[]>>
    
    /**
     * Warm cache with data
     */
    warm?: ( entries: Array<{ key: string; value: any; ttl?: number }> ) => Promise<Either<CacheError, void>>
    
    /**
     * Get cache analytics
     */
    getAnalytics?: () => Promise<Either<CacheError, CacheAnalytics>>
    
    /**
     * Compress cache entry
     */
    compress?: ( data: any ) => Promise<Either<CacheError, any>>
    
    /**
     * Decompress cache entry
     */
    decompress?: ( data: any ) => Promise<Either<CacheError, any>>
    
    /**
     * Get cache size in bytes
     */
    getSize?: () => Promise<Either<CacheError, number>>
    
    /**
     * Optimize cache (cleanup, defragment, etc.)
     */
    optimize?: () => Promise<Either<CacheError, void>>
    
    /**
     * Sync with other cache instances
     */
    sync?: ( data: any ) => Promise<Either<CacheError, void>>
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

/**
 * Cache warming manager interface
 */
export type CacheWarmer = {
    /**
     * Start cache warming
     */
    start(): Promise<Either<CacheError, void>>
    
    /**
     * Stop cache warming
     */
    stop(): Promise<Either<CacheError, void>>
    
    /**
     * Warm specific patterns
     */
    warmPattern( pattern: string ): Promise<Either<CacheError, void>>
    
    /**
     * Get warming statistics
     */
    getStats(): {
        isRunning: boolean
        lastWarmup?: Date
        totalWarmed: number
        failedWarmups: number
    }
}