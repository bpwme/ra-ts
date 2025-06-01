import type { QueryOptions, Validator, Either } from "../types/index.js"
import type { DataManager } from "./DataManager.js"

/**
 * Fluent builder for query operations
 */
export class QueryBuilder<T> {
    private options: QueryOptions<T> = {}

    constructor(
        private key: string,
        private manager: DataManager
    ) {}

    /**
     * Set stale time - how long cached data is considered fresh
     */
    staleTime( ms: number ): this {
        this.options.staleTime = ms
        return this
    }

    /**
     * Set TTL - how long to keep data in cache
     */
    ttl( ms: number ): this {
        this.options.ttl = ms
        return this
    }

    /**
     * Set maximum retry attempts
     */
    retries( count: number ): this {
        this.options.maxRetries = count
        return this
    }

    /**
     * Add schema validation
     */
    validate<S extends T>( schema: Validator<S> ): QueryBuilder<S> {
        this.options.schema = schema
        return this as any
    }

    /**
     * Skip automatic data sanitization for this query
     */
    skipSanitization(): this {
        this.options.sanitize = false
        return this
    }

    /**
     * Enable data sanitization for this query (default behavior)
     */
    sanitize(): this {
        this.options.sanitize = true
        return this
    }

    /**
     * Execute the query with the configured options
     */
    async fetch( fetcher: () => Promise<Either<any, T>> ): Promise<Either<any, T>> {
        return this.manager.executeQuery( this.key, fetcher, this.options )
    }

    // ============================================================================
    // FUTURE METHODS (to be added in later phases)
    // ============================================================================

    // stream(channel: string): this { /* Phase 6 */ }
    // poll(intervalMs: number): this { /* Phase 6 */ }
    // batch(batchKey: string): this { /* Phase 6 */ }
    // dependsOn(keys: string[]): this { /* Phase 6 */ }
}