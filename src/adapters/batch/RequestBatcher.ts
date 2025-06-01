import {
    IRequestBatcher as IRequestBatcher,
    BatchConfig,
    BatchStats,
    BatchRequest,
    RequestBatch,
    BatchError,
    Either,
    success,
    error,
    ILogger
} from "../../types"

/**
 * Configuration for RequestBatcher
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export type RequestBatcherConfig<T = any, R = any> = BatchConfig & {
    /** Logger for debugging */
    logger?: ILogger
    /** Enable request deduplication */
    enableDeduplication?: boolean
    /** Cache results for duplicate requests */
    enableCaching?: boolean
    /** Cache TTL in milliseconds */
    cacheTTL?: number
}

/**
 * Default configuration values
 */
const DEFAULT_CONFIG: Required<Omit<RequestBatcherConfig<any, any>, "batchExecutor" | "logger">> = {
    maxBatchSize: 50,
    maxWaitTime: 10,
    maxConcurrency: 5,
    enableDeduplication: true,
    enableCaching: true,
    cacheTTL: 30000,
    batchKeyFn: () => "default"
}

/**
 * Cached result with expiration
 */
type CachedResult = {
    result: Either<any, any>
    expiresAt: number
}

/**
 * Advanced request batcher with DataLoader-style patterns
 */
export class RequestBatcher<T = any, R = any> implements IRequestBatcher<T, R> {
    private config: RequestBatcherConfig<T, R> & Required<Omit<RequestBatcherConfig<T, R>, "batchExecutor" | "logger">>
    private pendingBatches = new Map<string, RequestBatch<T>>()
    private activeBatches = new Set<string>()
    private requestCache = new Map<string, CachedResult>()
    private pendingRequests = new Map<string, BatchRequest<T>[]>() // For deduplication
    private timers = new Map<string, NodeJS.Timeout>()
    private stats: BatchStats = {
        totalRequests: 0,
        totalBatches: 0,
        averageBatchSize: 0,
        pendingRequests: 0,
        activeBatches: 0,
        averageWaitTime: 0,
        cacheHitRate: 0
    }
    private waitTimes: number[] = []
    private lastCleanup = Date.now()

    constructor( config: RequestBatcherConfig<T, R> ) {
        this.config = {
            ...DEFAULT_CONFIG,
            ...config
        }

        // Start periodic cleanup
        setInterval( () => this.cleanup(), 60000 ) // Cleanup every minute
    }

    /**
     * Add a request to the batch queue
     */
    async batchRequest( request: T ): Promise<Either<any, R>> {
        const startTime = Date.now()
        this.stats.totalRequests++

        try {
            // Generate batch key for grouping
            const batchKey = this.config.batchKeyFn!( request )
            
            // Check cache first
            if ( this.config.enableCaching ) {
                const cached = this.getCachedResult( request )
                if ( cached ) {
                    this.updateCacheHitRate( true )
                    this.log( "debug", "Cache hit for request", { batchKey } )
                    return cached
                }
                this.updateCacheHitRate( false )
            }

            // Check for duplicate requests (deduplication)
            if ( this.config.enableDeduplication ) {
                const requestKey = this.generateRequestKey( request )
                const existing = this.pendingRequests.get( requestKey )
                
                if ( existing ) {
                    this.log( "debug", "Deduplicating request", { requestKey, batchKey } )
                    
                    // Return promise that resolves when the original request completes
                    return new Promise( ( resolve, reject ) => {
                        existing.push( {
                            id: this.generateRequestId(),
                            data: request,
                            timestamp: new Date(),
                            resolve,
                            reject
                        } )
                    } )
                }
            }

            // Create new batch request
            const batchRequest: BatchRequest<T> = {
                id: this.generateRequestId(),
                data: request,
                timestamp: new Date(),
                resolve: () => {},
                reject: () => {}
            }

            // Create promise for the request
            const requestPromise = new Promise<Either<any, R>>( ( resolve, reject ) => {
                batchRequest.resolve = resolve
                batchRequest.reject = reject
            } )

            // Add to deduplication map
            if ( this.config.enableDeduplication ) {
                const requestKey = this.generateRequestKey( request )
                this.pendingRequests.set( requestKey, [ batchRequest ] )
            }

            // Add to batch or create new batch
            await this.addToBatch( batchKey, batchRequest )

            // Track wait time
            requestPromise.finally( () => {
                const waitTime = Date.now() - startTime
                this.waitTimes.push( waitTime )
                this.updateAverageWaitTime()
            } )

            return requestPromise
        } catch ( err ) {
            return error( new BatchError( "Failed to batch request", { request, error: err } ) )
        }
    }

    /**
     * Get current batch statistics
     */
    getStats(): BatchStats {
        this.stats.pendingRequests = this.getTotalPendingRequests()
        this.stats.activeBatches = this.activeBatches.size
        return { ...this.stats }
    }

    /**
     * Clear all pending requests
     */
    clearPending(): void {
        this.log( "info", "Clearing all pending requests" )

        // Reject all pending requests
        for ( const batch of this.pendingBatches.values() ) {
            for ( const request of batch.requests ) {
                request.reject( new BatchError( "Request cancelled" ) )
            }
        }

        // Clear timers
        for ( const timer of this.timers.values() ) {
            clearTimeout( timer )
        }

        // Reset state
        this.pendingBatches.clear()
        this.pendingRequests.clear()
        this.timers.clear()
        this.stats.pendingRequests = 0
    }

    /**
     * Flush all pending batches immediately
     */
    async flush(): Promise<void> {
        this.log( "info", "Flushing all pending batches" )

        const batchPromises: Promise<void>[] = []

        for ( const [ batchKey, batch ] of this.pendingBatches ) {
            batchPromises.push( this.executeBatch( batchKey, batch ) )
        }

        await Promise.all( batchPromises )
    }

    /**
     * Check if batcher is active
     */
    isActive(): boolean {
        return this.pendingBatches.size > 0 || this.activeBatches.size > 0
    }

    /**
     * Add request to existing batch or create new batch
     */
    private async addToBatch( batchKey: string, request: BatchRequest<T> ): Promise<void> {
        let batch = this.pendingBatches.get( batchKey )

        if ( !batch ) {
            // Create new batch
            batch = {
                id: this.generateBatchId(),
                key: batchKey,
                requests: [],
                createdAt: new Date(),
                size: 0
            }
            this.pendingBatches.set( batchKey, batch )
        }

        // Add request to batch
        batch.requests.push( request )
        batch.size = batch.requests.length

        this.log( "debug", "Added request to batch", { 
            batchKey, 
            batchSize: batch.size, 
            requestId: request.id 
        } )

        // Check if batch should be executed
        const shouldExecute = batch.size >= this.config.maxBatchSize ||
                             this.shouldExecuteDueToConcurrency()

        if ( shouldExecute ) {
            await this.scheduleBatchExecution( batchKey, batch )
        } else if ( !this.timers.has( batchKey ) ) {
            // Set timer for batch execution
            const timer = setTimeout( () => {
                const currentBatch = this.pendingBatches.get( batchKey )
                if ( currentBatch ) {
                    this.executeBatch( batchKey, currentBatch )
                }
            }, this.config.maxWaitTime )

            this.timers.set( batchKey, timer )
        }
    }

    /**
     * Schedule batch execution with concurrency control
     */
    private async scheduleBatchExecution( batchKey: string, batch: RequestBatch<T> ): Promise<void> {
        // Check concurrency limits
        if ( this.config.maxConcurrency && this.activeBatches.size >= this.config.maxConcurrency ) {
            this.log( "debug", "Concurrency limit reached, batch will wait", { batchKey } )
            return
        }

        await this.executeBatch( batchKey, batch )
    }

    /**
     * Execute a batch of requests
     */
    private async executeBatch( batchKey: string, batch: RequestBatch<T> ): Promise<void> {
        if ( batch.requests.length === 0 ) return

        this.log( "info", "Executing batch", { 
            batchKey, 
            batchId: batch.id, 
            requestCount: batch.requests.length 
        } )

        // Move batch to active
        this.pendingBatches.delete( batchKey )
        this.activeBatches.add( batch.id )
        
        // Clear timer
        const timer = this.timers.get( batchKey )
        if ( timer ) {
            clearTimeout( timer )
            this.timers.delete( batchKey )
        }

        try {
            // Update stats
            this.stats.totalBatches++
            this.stats.lastBatchAt = new Date()
            this.updateAverageBatchSize( batch.requests.length )

            // Execute batch using custom executor or default implementation
            const results = await this.executeBatchRequests( batch.requests.map( r => r.data ) )

            // Handle results
            if ( results.success && Array.isArray( results.data ) ) {
                this.handleBatchSuccess( batch, results.data )
            } else {
                this.handleBatchError( batch, results.error || new BatchError( "Batch execution failed" ) )
            }

        } catch ( err ) {
            this.log( "error", "Batch execution error", { batchKey, batchId: batch.id, error: err } )
            this.handleBatchError( batch, err )
        } finally {
            this.activeBatches.delete( batch.id )
            
            // Process next batches if waiting due to concurrency
            this.processWaitingBatches()
        }
    }

    /**
     * Execute batch requests using custom executor or default implementation
     */
    private async executeBatchRequests( requests: T[] ): Promise<Either<any, R[]>> {
        if ( this.config.batchExecutor ) {
            return this.config.batchExecutor( requests )
        }

        // Default implementation - execute requests individually
        // This should be overridden with a custom batch executor for real batching
        this.log( "warn", "Using default batch executor - consider providing custom batchExecutor" )
        
        try {
            const results = await Promise.allSettled(
                requests.map( async ( request ) => {
                    // This is a placeholder - real implementation would batch the actual API calls
                    return success( request as unknown as R )
                } )
            )

            const successResults: R[] = []
            for ( const result of results ) {
                if ( result.status === "fulfilled" ) {
                    if ( result.value && result.value.data != null ) {
                        successResults.push( result.value.data )
                    } else {
                        return error( new BatchError( "Request returned null result in batch" ) )
                    }
                } else {
                    return error( new BatchError( "Request failed in batch" ) )
                }
            }

            return success( successResults )
        } catch ( err ) {
            return error( new BatchError( "Batch execution failed", { error: err } ) )
        }
    }

    /**
     * Handle successful batch execution
     */
    private handleBatchSuccess( batch: RequestBatch<T>, results: R[] ): void {
        if ( results.length !== batch.requests.length ) {
            this.log( "error", "Result count mismatch", {
                expected: batch.requests.length,
                actual: results.length
            } )
            this.handleBatchError( batch, new BatchError( "Result count mismatch" ) )
            return
        }

        batch.requests.forEach( ( request, index ) => {
            const result = success( results[ index ] )
            
            // Cache result if enabled
            if ( this.config.enableCaching ) {
                this.cacheResult( request.data, result )
            }

            // Resolve request
            request.resolve( result )

            // Resolve deduplicated requests
            if ( this.config.enableDeduplication ) {
                const requestKey = this.generateRequestKey( request.data )
                const duplicates = this.pendingRequests.get( requestKey )
                if ( duplicates ) {
                    duplicates.forEach( duplicate => duplicate.resolve( result ) )
                    this.pendingRequests.delete( requestKey )
                }
            }
        } )

        this.log( "debug", "Batch completed successfully", { 
            batchId: batch.id, 
            requestCount: batch.requests.length 
        } )
    }

    /**
     * Handle batch execution error
     */
    private handleBatchError( batch: RequestBatch<T>, error: any ): void {
        const batchError = error instanceof BatchError ? error : new BatchError( "Batch failed", { error } )

        batch.requests.forEach( ( request ) => {
            request.reject( batchError )

            // Reject deduplicated requests
            if ( this.config.enableDeduplication ) {
                const requestKey = this.generateRequestKey( request.data )
                const duplicates = this.pendingRequests.get( requestKey )
                if ( duplicates ) {
                    duplicates.forEach( duplicate => duplicate.reject( batchError ) )
                    this.pendingRequests.delete( requestKey )
                }
            }
        } )

        this.log( "error", "Batch failed", { batchId: batch.id, error: batchError } )
    }

    /**
     * Process waiting batches when concurrency allows
     */
    private processWaitingBatches(): void {
        if ( !this.config.maxConcurrency || this.activeBatches.size >= this.config.maxConcurrency ) {
            return
        }

        for ( const [ batchKey, batch ] of this.pendingBatches ) {
            if ( batch.size >= this.config.maxBatchSize ) {
                this.executeBatch( batchKey, batch )
                break // Process one at a time to respect concurrency
            }
        }
    }

    /**
     * Check if batch should execute due to concurrency considerations
     */
    private shouldExecuteDueToConcurrency(): boolean {
        return this.config.maxConcurrency ? this.activeBatches.size < this.config.maxConcurrency : true
    }

    /**
     * Generate unique request ID
     */
    private generateRequestId(): string {
        return `req_${Date.now()}_${Math.random().toString( 36 ).substr( 2, 9 )}`
    }

    /**
     * Generate unique batch ID
     */
    private generateBatchId(): string {
        return `batch_${Date.now()}_${Math.random().toString( 36 ).substr( 2, 9 )}`
    }

    /**
     * Generate request key for deduplication
     */
    private generateRequestKey( request: T ): string {
        try {
            return JSON.stringify( request )
        } catch {
            return String( request )
        }
    }

    /**
     * Get cached result if available and not expired
     */
    private getCachedResult( request: T ): Either<any, R> | null {
        const key = this.generateRequestKey( request )
        const cached = this.requestCache.get( key )

        if ( cached && cached.expiresAt > Date.now() ) {
            return cached.result
        }

        if ( cached ) {
            this.requestCache.delete( key )
        }

        return null
    }

    /**
     * Cache a result with TTL
     */
    private cacheResult( request: T, result: Either<any, R> ): void {
        const key = this.generateRequestKey( request )
        this.requestCache.set( key, {
            result,
            expiresAt: Date.now() + this.config.cacheTTL
        } )
    }

    /**
     * Update cache hit rate statistics
     */
    private updateCacheHitRate( hit: boolean ): void {
        const currentRate = this.stats.cacheHitRate || 0
        const totalRequests = this.stats.totalRequests
        
        if ( totalRequests === 1 ) {
            this.stats.cacheHitRate = hit ? 1 : 0
        } else {
            const newRate = ( ( currentRate * ( totalRequests - 1 ) ) + ( hit ? 1 : 0 ) ) / totalRequests
            this.stats.cacheHitRate = newRate
        }
    }

    /**
     * Update average batch size
     */
    private updateAverageBatchSize( size: number ): void {
        const currentAvg = this.stats.averageBatchSize
        const totalBatches = this.stats.totalBatches
        
        if ( totalBatches === 1 ) {
            this.stats.averageBatchSize = size
        } else {
            this.stats.averageBatchSize = ( ( currentAvg * ( totalBatches - 1 ) ) + size ) / totalBatches
        }
    }

    /**
     * Update average wait time
     */
    private updateAverageWaitTime(): void {
        if ( this.waitTimes.length === 0 ) return

        const sum = this.waitTimes.reduce( ( a, b ) => a + b, 0 )
        this.stats.averageWaitTime = sum / this.waitTimes.length

        // Keep only recent wait times
        if ( this.waitTimes.length > 1000 ) {
            this.waitTimes = this.waitTimes.slice( -500 )
        }
    }

    /**
     * Get total pending requests across all batches
     */
    private getTotalPendingRequests(): number {
        return Array.from( this.pendingBatches.values() )
            .reduce( ( total, batch ) => total + batch.requests.length, 0 )
    }

    /**
     * Periodic cleanup of expired cache entries
     */
    private cleanup(): void {
        const now = Date.now()
        
        // Skip if cleanup was recent
        if ( now - this.lastCleanup < 30000 ) return
        
        this.lastCleanup = now
        
        // Clean expired cache entries
        let cleanedCount = 0
        for ( const [ key, cached ] of this.requestCache ) {
            if ( cached.expiresAt <= now ) {
                this.requestCache.delete( key )
                cleanedCount++
            }
        }

        if ( cleanedCount > 0 ) {
            this.log( "debug", "Cleaned up expired cache entries", { cleanedCount } )
        }
    }

    /**
     * Log messages with optional logger
     */
    private log( level: "debug" | "info" | "warn" | "error", message: string, data?: any ): void {
        if ( this.config.logger ) {
            this.config.logger[ level ]( `[RequestBatcher] ${message}`, data )
        }
    }
} 