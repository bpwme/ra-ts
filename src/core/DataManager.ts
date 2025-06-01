import type { 
    DataManagerConfig, 
    CacheAdapter, 
    QueueAdapter, 
    RateLimiter, 
    Logger, 
    Monitor,
    Validator,
    Either,
    QueryOptions,
    MutationOptions,
} from "../types"
import { ValidationError, NetworkError } from "../types"
import { success, error, isSuccess, isError } from "../types"
import { QueryBuilder } from "./QueryBuilder"
import { MutationBuilder } from "./MutationBuilder"
import { NoOpLogger } from "../adapters/defaults/NoOpLogger"
import { NoOpRateLimiter } from "../adapters/defaults/NoOpRateLimiter"
import { NoOpMonitor } from "../adapters/defaults/NoOpMonitor"

/**
 * Main DataManager class - coordinates all data operations
 */
export class DataManager {
    private cache?: CacheAdapter
    private queue?: QueueAdapter
    private rateLimiter: RateLimiter
    private logger: Logger
    private monitor?: Monitor
    private securityValidator?: Validator
    
    // Internal state for deduplication and optimistic updates
    private deduplicationMap = new Map<string, Promise<Either<any, any>>>()
    private optimisticStore = new Map<string, any>()
    
    // Configuration
    private defaultTTL?: number
    private enableOptimisticUpdates: boolean
    private enableSanitization: boolean

    constructor( config: DataManagerConfig = {} ) {
        // Set up adapters with defaults
        this.cache = config.cache
        this.queue = config.queue
        this.rateLimiter = config.rateLimiter || new NoOpRateLimiter()
        this.logger = config.logger || new NoOpLogger()
        this.monitor = config.monitor || new NoOpMonitor()
        this.securityValidator = config.securityValidator
        
        // Store configuration
        this.defaultTTL = config.defaultTTL
        this.enableOptimisticUpdates = config.enableOptimisticUpdates ?? true
        this.enableSanitization = config.enableSanitization ?? true
        
        this.logger.debug( "DataManager initialized", { 
            hasCache: !!this.cache,
            hasQueue: !!this.queue,
            hasMonitor: !!this.monitor,
            hasSecurity: !!this.securityValidator,
            hasRateLimiter: !!this.rateLimiter,
            hasLogger: !!this.logger,
            hasSecurityValidator: !!this.securityValidator,
            hasDefaultTTL: !!this.defaultTTL,
            hasOptimisticUpdates: !!this.enableOptimisticUpdates,
            hasSanitization: !!this.enableSanitization,
        } )
    }

    /**
     * Create a new query builder for the given key
     */
    query<T>( key: string ): QueryBuilder<T> {
        this.logger.debug( `Creating query builder for key: ${key}` )
        return new QueryBuilder<T>( key, this )
    }

    /**
     * Create a new mutation builder for the given key
     */
    mutate<T>( key: string ): MutationBuilder<T> {
        this.logger.debug( `Creating mutation builder for key: ${key}` )
        return new MutationBuilder<T>( key, this )
    }

    // ============================================================================
    // QUERY EXECUTION IMPLEMENTATION
    // ============================================================================

    /**
     * Execute a query with full caching, deduplication, and validation support
     */
    async executeQuery<T>(
        key: string,
        fetcher: () => Promise<Either<any, T>>,
        options: QueryOptions<T> = {}
    ): Promise<Either<any, T>> {
        const timer = this.monitor?.startTimer( `query.${key}` )
        
        try {
            this.logger.debug( `Starting query execution: ${key}`, options )
            
            // Check optimistic updates first (highest priority)
            if ( this.optimisticStore.has( key ) ) {
                this.logger.debug( `Using optimistic data for: ${key}` )
                const optimisticData = this.optimisticStore.get( key )
                return success( optimisticData )
            }

            // Check cache if available
            if ( this.cache ) {
                const cacheResult = await this.cache.get<T>( key )
                
                if ( isSuccess( cacheResult ) && cacheResult.data !== undefined ) {
                    // Check if cached data is stale
                    if ( !this.isStale( cacheResult.data, options.staleTime ) ) {
                        this.logger.debug( `Cache hit for: ${key}` )
                        this.monitor?.track( "cache.hit", { key } )
                        
                        // Validate cached data if schema provided
                        if ( options.schema ) {
                            const validationResult = options.schema.safeParse( cacheResult.data )
                            if ( isSuccess( validationResult ) ) {
                                return success( validationResult.data )
                            } else {
                                this.logger.warn( `Cached data validation failed for ${key}, refetching`, validationResult.error )
                                await this.cache.delete( key )
                            }
                        } else {
                            return success( cacheResult.data )
                        }
                    } else {
                        this.logger.debug( `Cache hit but data is stale for: ${key}` )
                        this.monitor?.track( "cache.stale", { key } )
                    }
                } else if ( isError( cacheResult ) ) {
                    this.logger.warn( `Cache error for ${key}:`, cacheResult.error )
                }
            }

            // Check for request deduplication
            if ( this.deduplicationMap.has( key ) ) {
                this.logger.debug( `Request deduplicated for: ${key}` )
                this.monitor?.track( "request.deduplicated", { key } )
                return this.deduplicationMap.get( key )!
            }

            // Execute the actual request with rate limiting
            const requestPromise = this.executeWithRateLimit( key, fetcher, options )
            
            // Store in deduplication map
            this.deduplicationMap.set( key, requestPromise )
            
            // Execute and handle result
            const result = await requestPromise
            
            // Clean up deduplication map
            this.deduplicationMap.delete( key )
            
            return result
            
        } catch ( err ) {
            this.logger.error( `Unexpected error in query execution for ${key}:`, err )
            this.monitor?.track( "query.error", { key, error: err } )
            return error( new NetworkError(
                `Query execution failed: ${err instanceof Error ? err.message : "Unknown error"}`,
                { key, error: err }
            ) )
        } finally {
            timer?.()
        }
    }

    /**
     * Execute mutation with optimistic updates and cache invalidation
     */
    async executeMutation<T>(
        key: string,
        mutator: () => Promise<Either<any, T>>,
        options: MutationOptions<T> = {}
    ): Promise<Either<any, T>> {
        const timer = this.monitor?.startTimer( `mutation.${key}` )
        
        try {
            this.logger.debug( `Starting mutation execution: ${key}`, options )
            
            // Apply optimistic update if provided and enabled
            if ( options.optimisticUpdate && this.enableOptimisticUpdates ) {
                this.optimisticStore.set( key, options.optimisticUpdate )
                this.logger.debug( `Applied optimistic update for: ${key}` )
                this.monitor?.track( "optimistic.applied", { key } )
            }

            // Execute the mutation with rate limiting
            const result = await this.rateLimiter.execute( async () => {
                this.logger.debug( `Executing mutation: ${key}` )
                this.monitor?.track( "mutation.start", { key } )
                
                const mutationResult = await mutator()
                
                if ( isSuccess( mutationResult ) ) {
                    let finalData = mutationResult.data

                    // Apply security validation/sanitization
                    if (
                        options.sanitize !== false && 
                        this.enableSanitization && 
                        this.securityValidator?.validate
                    ) {
                        const sanitizedResult = await this.securityValidator.validate( finalData )
                        if ( isError( sanitizedResult ) ) {
                            this.logger.warn( `Mutation data sanitization failed for ${key}:`, sanitizedResult.error.message )
                            
                            if ( sanitizedResult.error.message.includes( "Prototype pollution" ) ) {
                                this.monitor?.track( "security.blocked", { key, type: "mutation", reason: "prototype_pollution" } )
                                return sanitizedResult
                            }
                            
                            this.monitor?.track( "security.warning", { key, type: "mutation" } )
                        } else {
                            finalData = sanitizedResult.data
                            this.monitor?.track( "security.sanitized", { key, type: "mutation" } )
                        }
                    }

                    // Validate response if schema provided
                    if ( options.schema ) {
                        const validationResult = options.schema.safeParse( finalData )
                        if ( isError( validationResult ) ) {
                            this.logger.error( `Mutation response validation failed for ${key}`, validationResult.error )
                            return error( new ValidationError(
                                `Invalid mutation response: ${validationResult.error}`,
                                { key, validationError: validationResult.error }
                            ) )
                        }
                        finalData = validationResult.data
                    }
                    
                    return success( finalData )
                } else {
                    return mutationResult
                }
            } )

            if ( isSuccess( result ) ) {
                // Clear optimistic update
                this.optimisticStore.delete( key )
                
                // Update cache with new data
                if ( this.cache ) {
                    const ttl = options.ttl ?? this.defaultTTL
                    const cacheResult = await this.cache.set( key, result.data, ttl )
                    if ( isError( cacheResult ) ) {
                        this.logger.warn( `Failed to cache mutation result for ${key}:`, cacheResult.error )
                    }
                }
                
                // Invalidate related cache entries
                if ( options.invalidates && this.cache ) {
                    for ( const pattern of options.invalidates ) {
                        const invalidationResult = await this.cache.invalidate( pattern )
                        if ( isSuccess( invalidationResult ) ) {
                            this.logger.debug( `Invalidated cache pattern: ${pattern}` )
                            this.monitor?.track( "cache.invalidated", { pattern } )
                        } else {
                            this.logger.warn( `Failed to invalidate pattern ${pattern}:`, invalidationResult.error )
                        }
                    }
                }

                this.logger.debug( `Mutation successful: ${key}` )
                this.monitor?.track( "mutation.success", { key } )
                return result
            } else {
                // Revert optimistic update on failure
                this.optimisticStore.delete( key )
                this.logger.debug( `Reverted optimistic update for: ${key}` )
                this.monitor?.track( "optimistic.reverted", { key } )
                
                this.logger.error( `Mutation failed: ${key}`, result.error )
                this.monitor?.track( "mutation.error", { key, error: result.error } )
                return result
            }
            
        } catch ( err ) {
            // Revert optimistic update on unexpected error
            this.optimisticStore.delete( key )
            this.logger.error( `Unexpected error in mutation execution for ${key}:`, err )
            this.monitor?.track( "mutation.error", { key, error: err } )
            return error( new NetworkError(
                `Mutation execution failed: ${err instanceof Error ? err.message : "Unknown error"}`,
                { key, error: err }
            ) )
        } finally {
            timer?.()
        }
    }

    // ============================================================================
    // PRIVATE HELPER METHODS
    // ============================================================================

    /**
     * Execute request with rate limiting and error handling
     */
    private async executeWithRateLimit<T>(
        key: string,
        fetcher: () => Promise<Either<any, T>>,
        options: QueryOptions<T>
    ): Promise<Either<any, T>> {
        return this.rateLimiter.execute( async () => {
            this.logger.debug( `Fetching data for: ${key}` )
            this.monitor?.track( "request.start", { key } )
            
            try {
                const result = await fetcher()
                
                if ( isSuccess( result ) ) {
                    let finalData = result.data

                    // Apply security validation/sanitization
                    if (
                        options.sanitize !== false && 
                        this.enableSanitization && 
                        this.securityValidator?.validate
                    ) {
                        const sanitizedResult = await this.securityValidator.validate( finalData )
                        if ( isError( sanitizedResult ) ) {
                            this.logger.warn( `Data sanitization failed for ${key}:`, sanitizedResult.error.message )
                            
                            if ( sanitizedResult.error.message.includes( "Prototype pollution" ) ) {
                                this.monitor?.track( "security.blocked", { key, reason: "prototype_pollution" } )
                                return sanitizedResult
                            }
                            
                            this.monitor?.track( "security.warning", { key } )
                        } else {
                            finalData = sanitizedResult.data
                            this.monitor?.track( "security.sanitized", { key } )
                        }
                    }

                    // Validate response if schema provided
                    if ( options.schema ) {
                        const validationResult = options.schema.safeParse( finalData )
                        if ( isError( validationResult ) ) {
                            this.logger.error( `Response validation failed for ${key}`, validationResult.error )
                            return error( new ValidationError(
                                `Invalid response data: ${validationResult.error}`,
                                { key, validationError: validationResult.error }
                            ) )
                        }
                        finalData = validationResult.data
                    }
                    
                    // Cache the result
                    await this.cacheResult( key, finalData, options.ttl )
                    this.logger.debug( `Query successful: ${key}` )
                    this.monitor?.track( "request.success", { key } )
                    return success( finalData )
                } else {
                    this.logger.error( `Fetcher returned error for ${key}:`, result.error )
                    this.monitor?.track( "request.error", { key, error: result.error } )
                    return result
                }
            } catch ( err ) {
                const networkError = new NetworkError(
                    `Network request failed: ${err instanceof Error ? err.message : "Unknown error"}`,
                    { key, error: err }
                )
                this.logger.error( `Network error for ${key}:`, err )
                this.monitor?.track( "request.error", { key, error: networkError } )
                return error( networkError )
            }
        } )
    }

    /**
     * Cache the result if cache is available
     */
    private async cacheResult<T>( key: string, data: T, ttl?: number ): Promise<void> {
        if ( !this.cache ) return
        
        const effectiveTTL = ttl ?? this.defaultTTL
        const cacheResult = await this.cache.set( key, data, effectiveTTL )
        
        if ( isError( cacheResult ) ) {
            this.logger.warn( `Failed to cache result for ${key}:`, cacheResult.error )
        } else {
            this.logger.debug( `Cached result for ${key}${effectiveTTL ? ` (TTL: ${effectiveTTL}ms)` : ""}` )
        }
    }

    /**
     * Check if cached data is stale based on timestamp and stale time
     */
    private isStale( cachedData: any, staleTime?: number ): boolean {
        if ( !staleTime ) return false
        if ( !cachedData || typeof cachedData !== "object" ) return false
        
        const timestamp = cachedData._timestamp
        if ( typeof timestamp !== "number" ) return false
        
        return Date.now() - timestamp > staleTime
    }

    // ============================================================================
    // GETTERS FOR INTERNAL ACCESS
    // ============================================================================

    /** @internal */
    get _cache() { return this.cache }
    
    /** @internal */
    get _queue() { return this.queue }
    
    /** @internal */
    get _rateLimiter() { return this.rateLimiter }
    
    /** @internal */
    get _logger() { return this.logger }
    
    /** @internal */
    get _monitor() { return this.monitor }
    
    /** @internal */
    get _defaultTTL() { return this.defaultTTL }
}