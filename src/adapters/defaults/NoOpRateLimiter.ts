import type { IRateLimiter } from "../../types/index"

/**
 * Default rate limiter that doesn't limit anything
 */
export class NoOpRateLimiter implements IRateLimiter {
    async execute<T>( fn: () => Promise<T> ): Promise<T> {
        return fn()
    }

    canExecute(): boolean {
        return true
    }
}