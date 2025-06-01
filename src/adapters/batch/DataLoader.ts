import {
    Either,
    ILogger
} from "../../types"
import { RequestBatcher, RequestBatcherConfig } from "./RequestBatcher"

/**
 * Configuration for DataLoader
 */
export type DataLoaderConfig<K = any, V = any> = {
    /** Batch function that takes keys and returns values */
    batchLoadFn: ( keys: K[] ) => Promise<Either<any, V[]>>
    /** Maximum batch size */
    maxBatchSize?: number
    /** Maximum wait time before executing batch */
    batchDelay?: number
    /** Enable caching of results */
    cache?: boolean
    /** Cache TTL in milliseconds */
    cacheTTL?: number
    /** Logger for debugging */
    logger?: ILogger
}

/**
 * DataLoader for efficient batching and caching of requests
 * Compatible with Facebook's DataLoader pattern
 */
export class DataLoader<K = any, V = any> {
    private batcher: RequestBatcher<K, V>
    private config: DataLoaderConfig<K, V>

    constructor( config: DataLoaderConfig<K, V> ) {
        this.config = {
            maxBatchSize: 50,
            batchDelay: 10,
            cache: true,
            cacheTTL: 300000, // 5 minutes
            ...config
        }

        // Configure the underlying batcher
        const batcherConfig: RequestBatcherConfig<K, V> = {
            maxBatchSize: this.config.maxBatchSize!,
            maxWaitTime: this.config.batchDelay!,
            maxConcurrency: 10,
            enableDeduplication: true,
            enableCaching: this.config.cache!,
            cacheTTL: this.config.cacheTTL!,
            batchKeyFn: () => "dataloader", // All requests use same batch
            batchExecutor: this.config.batchLoadFn as <T, R>( requests: T[] ) => Promise<Either<any, R[]>>,
            logger: this.config.logger
        }

        this.batcher = new RequestBatcher<K, V>( batcherConfig )
    }

    /**
     * Load a single value by key
     */
    async load( key: K ): Promise<Either<any, V>> {
        return this.batcher.batchRequest( key )
    }

    /**
     * Load multiple values by keys
     */
    async loadMany( keys: K[] ): Promise<Either<any, V>[]> {
        const promises = keys.map( key => this.load( key ) )
        return Promise.all( promises )
    }

    /**
     * Clear the cache for a specific key
     */
    clear( key: K ): this {
        // Note: This is a simplified implementation
        // In a full implementation, we'd need to track individual keys in the cache
        this.log( "info", "Clear cache for key", { key } )
        return this
    }

    /**
     * Clear all cached values
     */
    clearAll(): this {
        this.batcher.clearPending()
        this.log( "info", "Cleared all cached values" )
        return this
    }

    /**
     * Prime the cache with a value for a key
     */
    prime( key: K, value: V ): this {
        // Note: This would require extending the batcher to support priming
        this.log( "info", "Prime cache", { key, value } )
        return this
    }

    /**
     * Get current statistics
     */
    getStats() {
        return this.batcher.getStats()
    }

    /**
     * Log messages with optional logger
     */
    private log( level: "debug" | "info" | "warn" | "error", message: string, data?: any ): void {
        if ( this.config.logger ) {
            this.config.logger[ level ]( `[DataLoader] ${message}`, data )
        }
    }
}
