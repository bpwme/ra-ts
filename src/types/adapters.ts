import type { Either, QueueJob, StreamMessage, StreamHandler, WebSocketState } from "./core"
import type { CacheError, QueueError, ValidationError, StreamError } from "./errors"

/**
 * Cache adapter interface for storing and retrieving data
 */
export interface ICacheAdapter {
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
export interface IQueueAdapter {
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
export interface IRateLimiter {
    /**
     * Execute a function with rate limiting applied
     */
    execute<T>( fn: () => Promise<T> ): Promise<T>
}

/**
 * Logger interface for debugging and monitoring
 */
export interface ILogger {
    debug( message: string, data?: any ): void
    info( message: string, data?: any ): void
    warn( message: string, data?: any ): void
    error( message: string, data?: any ): void
}

/**
 * Schema validator interface for data validation
 */
export interface IValidator<T = any> {
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
 * Stream adapter interface for real-time data synchronization
 */
export interface IStreamAdapter {
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
export interface IRequestBatcher<T = any, R = any> {
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
export interface IMonitor {
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
 * Advanced cache adapter interface with sophisticated features
 */
export interface IAdvancedCacheAdapter extends ICacheAdapter {
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
 * Cache warming manager interface
 */
export interface ICacheWarmer {
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