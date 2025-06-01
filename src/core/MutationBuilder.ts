import type { MutationOptions, Validator, Either } from "../types/index.js"
import type { DataManager } from "./DataManager.js"

/**
 * Fluent builder for mutation operations
 */
export class MutationBuilder<T> {
    private options: MutationOptions<T> = {}

    constructor(
        private key: string,
        private manager: DataManager
    ) {}

    /**
     * Set optimistic update data
     */
    optimistic( data: T ): this {
        this.options.optimisticUpdate = data
        return this
    }

    /**
     * Set cache patterns to invalidate after successful mutation
     */
    invalidates( ...patterns: string[] ): this {
        this.options.invalidates = patterns
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
     * Set TTL for mutation result
     */
    ttl( ms: number ): this {
        this.options.ttl = ms
        return this
    }

    /**
     * Add schema validation for mutation response
     */
    validate<S extends T>( schema: Validator<S> ): MutationBuilder<S> {
        this.options.schema = schema
        return this as any
    }

    /**
     * Skip automatic data sanitization for this mutation
     */
    skipSanitization(): this {
        this.options.sanitize = false
        return this
    }

    /**
     * Enable data sanitization for this mutation (default behavior)
     */
    sanitize(): this {
        this.options.sanitize = true
        return this
    }

    /**
     * Execute the mutation with the configured options
     */
    async execute( mutator: () => Promise<Either<any, T>> ): Promise<Either<any, T>> {
        return this.manager.executeMutation( this.key, mutator, this.options )
    }

    // ============================================================================
    // FUTURE METHODS (to be added in later phases)
    // ============================================================================

    // conflictStrategy(strategy: 'last-write-wins' | 'merge' | 'manual'): this { /* Phase 7 */ }
    // encrypt(): this { /* Phase 7 */ }
}