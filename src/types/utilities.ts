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