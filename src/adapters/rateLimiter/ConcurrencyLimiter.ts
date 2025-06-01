import { IRateLimiter } from "../../types"

/**
 * Configuration for concurrency limiter
 */
export type ConcurrencyLimiterConfig = {
    /** Maximum number of concurrent operations */
    maxConcurrency?: number
    /** Timeout for waiting in queue (milliseconds) */
    queueTimeout?: number
    /** Maximum queue size (reject if exceeded) */
    maxQueueSize?: number
  }
  
/**
   * Concurrency limiter to control parallel request execution
   */
export class ConcurrencyLimiter implements IRateLimiter {
    private running: number = 0
    private queue: Array<{
      resolve: () => void
      reject: ( error: Error ) => void
      timestamp: number
    }> = []
    
    private readonly maxConcurrency: number
    private readonly queueTimeout: number
    private readonly maxQueueSize: number
  
    constructor( config: ConcurrencyLimiterConfig = {} ) {
        this.maxConcurrency = config.maxConcurrency ?? 5
        this.queueTimeout = config.queueTimeout ?? 30000 // 30 seconds
        this.maxQueueSize = config.maxQueueSize ?? 100
    }
    canExecute(): boolean {
        throw new Error( "Method not implemented." )
    }
  
    /**
     * Execute a function with concurrency limiting
     */
    async execute<T>( fn: () => Promise<T> ): Promise<T> {
        await this.acquire()
      
        try {
            return await fn()
        } finally {
            this.release()
        }
    }
  
    /**
     * Acquire a concurrency slot
     */
    private async acquire(): Promise<void> {
        if ( this.running < this.maxConcurrency ) {
            this.running++
            return
        }
  
        // Check queue size
        if ( this.queue.length >= this.maxQueueSize ) {
            throw new Error( `Queue size exceeded (${this.maxQueueSize})` )
        }
  
        // Wait in queue
        return new Promise( ( resolve, reject ) => {
            const timestamp = Date.now()
            this.queue.push( { resolve, reject, timestamp } )
  
            // Set timeout
            setTimeout( () => {
                const index = this.queue.findIndex( item => item.timestamp === timestamp )
                if ( index !== -1 ) {
                    this.queue.splice( index, 1 )
                    reject( new Error( `Queue timeout after ${this.queueTimeout}ms` ) )
                }
            }, this.queueTimeout )
        } )
    }
  
    /**
     * Release a concurrency slot
     */
    private release(): void {
        this.running--
      
        // Process next item in queue
        const next = this.queue.shift()
        if ( next ) {
            this.running++
            next.resolve()
        }
    }
  
    /**
     * Get concurrency statistics
     */
    getStats() {
        return {
            running: this.running,
            queued: this.queue.length,
            maxConcurrency: this.maxConcurrency,
            utilizationPercent: ( this.running / this.maxConcurrency ) * 100,
            queueUtilizationPercent: ( this.queue.length / this.maxQueueSize ) * 100
        }
    }
  
    /**
     * Clear the queue and reset
     */
    reset(): void {
        // Reject all queued items
        this.queue.forEach( item => {
            item.reject( new Error( "Rate limiter reset" ) )
        } )
        this.queue = []
        this.running = 0
    }
}