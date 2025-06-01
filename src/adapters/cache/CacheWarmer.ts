import {
    ICacheWarmer as ICacheWarmer,
    CacheWarmingConfig,
    ICacheAdapter,
    CacheError,
    Either,
    success,
    error,
    ILogger
} from "../../types"

/**
 * Cache warming implementation configuration
 */
export type CacheWarmerConfig = CacheWarmingConfig & {
    /** Cache adapter to warm */
    cache: ICacheAdapter
    /** Logger for debugging */
    logger?: ILogger
    /** Maximum warmup duration in ms */
    maxWarmupDuration?: number
    /** Warmup batch size */
    batchSize?: number
}

/**
 * Warmup task definition
 */
type WarmupTask = {
    id: string
    pattern: string
    priority: "low" | "medium" | "high"
    fetcher: () => Promise<Array<{ key: string; value: any; ttl?: number }>>
    lastExecuted?: Date
    attempts: number
    maxAttempts: number
}

/**
 * Warmup statistics
 */
type WarmupStats = {
    isRunning: boolean
    lastWarmup?: Date
    totalWarmed: number
    failedWarmups: number
    averageWarmupTime: number
    tasksCompleted: number
    tasksFailed: number
}

/**
 * Background cache warming manager
 */
export class CacheWarmer implements ICacheWarmer {
    private config: Required<Omit<CacheWarmerConfig, "warmupFunction" | "logger" | "warmupPatterns">> & Pick<CacheWarmerConfig, "warmupFunction" | "logger" | "warmupPatterns">
    private isActive = false
    private warmupTimer?: NodeJS.Timeout
    private currentWarmup?: Promise<void>
    private tasks = new Map<string, WarmupTask>()
    private stats: WarmupStats = {
        isRunning: false,
        totalWarmed: 0,
        failedWarmups: 0,
        averageWarmupTime: 0,
        tasksCompleted: 0,
        tasksFailed: 0
    }
    private warmupTimes: number[] = []

    constructor( config: CacheWarmerConfig ) {
        this.config = {
            warmupInterval: 300000, // 5 minutes
            maxConcurrency: 3,
            priority: "medium",
            maxWarmupDuration: 30000, // 30 seconds
            batchSize: 10,
            ...config
        }

        // Initialize warmup patterns as tasks
        if ( this.config.warmupPatterns ) {
            this.initializePatternTasks()
        }
    }

    /**
     * Start cache warming
     */
    async start(): Promise<Either<CacheError, void>> {
        if ( this.isActive ) {
            return success( undefined )
        }

        if ( !this.config.enabled ) {
            this.log( "info", "Cache warming is disabled" )
            return success( undefined )
        }

        try {
            this.isActive = true
            this.stats.isRunning = true
            
            this.log( "info", "Starting cache warming", {
                interval: this.config.warmupInterval,
                maxConcurrency: this.config.maxConcurrency
            } )

            // Schedule periodic warmup
            this.scheduleNextWarmup()

            // Execute initial warmup
            await this.executeWarmup()

            return success( undefined )
        } catch ( err ) {
            this.isActive = false
            this.stats.isRunning = false
            return error( new CacheError( "Failed to start cache warming", { error: err } ) )
        }
    }

    /**
     * Stop cache warming
     */
    async stop(): Promise<Either<CacheError, void>> {
        if ( !this.isActive ) {
            return success( undefined )
        }

        try {
            this.log( "info", "Stopping cache warming" )
            
            this.isActive = false
            this.stats.isRunning = false

            // Clear timer
            if ( this.warmupTimer ) {
                clearTimeout( this.warmupTimer )
                this.warmupTimer = undefined
            }

            // Wait for current warmup to complete
            if ( this.currentWarmup ) {
                await this.currentWarmup
            }

            this.log( "info", "Cache warming stopped" )
            return success( undefined )
        } catch ( err ) {
            return error( new CacheError( "Failed to stop cache warming", { error: err } ) )
        }
    }

    /**
     * Warm specific patterns
     */
    async warmPattern( pattern: string ): Promise<Either<CacheError, void>> {
        try {
            this.log( "info", "Warming specific pattern", { pattern } )
            
            const task = this.tasks.get( pattern )
            if ( !task ) {
                return error( new CacheError( "Pattern not found", { pattern } ) )
            }

            await this.executeTask( task )
            return success( undefined )
        } catch ( err ) {
            return error( new CacheError( "Failed to warm pattern", { pattern, error: err } ) )
        }
    }

    /**
     * Get warming statistics
     */
    getStats() {
        return { ...this.stats }
    }

    /**
     * Add warmup task
     */
    addTask(
        pattern: string,
        fetcher: () => Promise<Array<{ key: string; value: any; ttl?: number }>>,
        options: {
            priority?: "low" | "medium" | "high"
            maxAttempts?: number
        } = {}
    ): void {
        const task: WarmupTask = {
            id: this.generateTaskId(),
            pattern,
            priority: options.priority || "medium",
            fetcher,
            attempts: 0,
            maxAttempts: options.maxAttempts || 3
        }

        this.tasks.set( pattern, task )
        this.log( "debug", "Added warmup task", { pattern, priority: task.priority } )
    }

    /**
     * Remove warmup task
     */
    removeTask( pattern: string ): void {
        if ( this.tasks.delete( pattern ) ) {
            this.log( "debug", "Removed warmup task", { pattern } )
        }
    }

    /**
     * Initialize pattern tasks from config
     */
    private initializePatternTasks(): void {
        if ( !this.config.warmupPatterns ) return

        for ( const pattern of this.config.warmupPatterns ) {
            // Create default fetcher that uses custom warmup function or empty
            const fetcher = async () => {
                if ( this.config.warmupFunction ) {
                    const result = await this.config.warmupFunction()
                    if ( result.error ) {
                        throw result.error
                    }
                }
                return [] // Default empty warmup
            }

            this.addTask( pattern, fetcher, { priority: this.config.priority } )
        }
    }

    /**
     * Schedule next warmup execution
     */
    private scheduleNextWarmup(): void {
        if ( !this.isActive ) return

        this.warmupTimer = setTimeout( async () => {
            if ( this.isActive ) {
                await this.executeWarmup()
                this.scheduleNextWarmup()
            }
        }, this.config.warmupInterval )
    }

    /**
     * Execute warmup cycle
     */
    private async executeWarmup(): Promise<void> {
        if ( this.currentWarmup ) {
            this.log( "debug", "Warmup already in progress, skipping" )
            return
        }

        this.currentWarmup = this.performWarmup()
        
        try {
            await this.currentWarmup
        } finally {
            this.currentWarmup = undefined
        }
    }

    /**
     * Perform actual warmup
     */
    private async performWarmup(): Promise<void> {
        const startTime = Date.now()
        this.log( "info", "Starting warmup cycle", { taskCount: this.tasks.size } )

        try {
            // Get tasks sorted by priority
            const sortedTasks = this.getSortedTasks()
            
            // Execute tasks with concurrency control
            const concurrencyLimit = this.config.maxConcurrency
            const executingTasks: Promise<void>[] = []

            for ( const task of sortedTasks ) {
                // Wait if we've reached concurrency limit
                if ( executingTasks.length >= concurrencyLimit ) {
                    await Promise.race( executingTasks )
                    // Remove completed tasks
                    for ( let i = executingTasks.length - 1; i >= 0; i-- ) {
                        if ( await Promise.race( [ executingTasks[ i ], Promise.resolve( "pending" ) ] ) !== "pending" ) {
                            executingTasks.splice( i, 1 )
                        }
                    }
                }

                // Start task execution
                const taskPromise = this.executeTaskWithTimeout( task )
                executingTasks.push( taskPromise )
            }

            // Wait for all remaining tasks
            await Promise.allSettled( executingTasks )

            // Update statistics
            const duration = Date.now() - startTime
            this.updateWarmupStats( duration )
            this.stats.lastWarmup = new Date()

            this.log( "info", "Warmup cycle completed", { 
                duration, 
                tasks: sortedTasks.length,
                successful: this.stats.tasksCompleted,
                failed: this.stats.tasksFailed
            } )
        } catch ( err ) {
            this.log( "error", "Warmup cycle failed", { error: err } )
            this.stats.failedWarmups++
        }
    }

    /**
     * Execute a single task with timeout
     */
    private async executeTaskWithTimeout( task: WarmupTask ): Promise<void> {
        return new Promise( ( resolve ) => {
            const timeout = setTimeout( () => {
                this.log( "warn", "Task execution timeout", { pattern: task.pattern } )
                this.stats.tasksFailed++
                resolve()
            }, this.config.maxWarmupDuration )

            this.executeTask( task )
                .then( () => {
                    clearTimeout( timeout )
                    this.stats.tasksCompleted++
                    resolve()
                } )
                .catch( ( err ) => {
                    clearTimeout( timeout )
                    this.log( "error", "Task execution failed", { pattern: task.pattern, error: err } )
                    this.stats.tasksFailed++
                    resolve()
                } )
        } )
    }

    /**
     * Execute a single warmup task
     */
    private async executeTask( task: WarmupTask ): Promise<void> {
        try {
            this.log( "debug", "Executing warmup task", { pattern: task.pattern, priority: task.priority } )
            
            task.attempts++
            
            // Fetch data for warming
            const entries = await task.fetcher()
            
            if ( entries.length === 0 ) {
                this.log( "debug", "No entries to warm for pattern", { pattern: task.pattern } )
                return
            }

            // Warm cache in batches
            const batches = this.createBatches( entries, this.config.batchSize )
            
            for ( const batch of batches ) {
                await this.warmBatch( batch )
            }

            task.lastExecuted = new Date()
            task.attempts = 0 // Reset attempts on success
            this.stats.totalWarmed += entries.length

            this.log( "debug", "Task completed successfully", { 
                pattern: task.pattern, 
                entriesWarmed: entries.length 
            } )
        } catch ( err ) {
            if ( task.attempts >= task.maxAttempts ) {
                this.log( "error", "Task failed after max attempts", { 
                    pattern: task.pattern, 
                    attempts: task.attempts,
                    error: err 
                } )
                // Don't retry failed tasks for this cycle
            } else {
                this.log( "warn", "Task failed, will retry", { 
                    pattern: task.pattern, 
                    attempts: task.attempts,
                    error: err 
                } )
            }
            throw err
        }
    }

    /**
     * Warm a batch of cache entries
     */
    private async warmBatch( batch: Array<{ key: string; value: any; ttl?: number }> ): Promise<void> {
        const promises = batch.map( async ( { key, value, ttl } ) => {
            try {
                const result = await this.config.cache.set( key, value, ttl )
                if ( result.error ) {
                    this.log( "warn", "Failed to warm cache entry", { key, error: result.error } )
                }
            } catch ( err ) {
                this.log( "warn", "Exception warming cache entry", { key, error: err } )
            }
        } )

        await Promise.allSettled( promises )
    }

    /**
     * Create batches from array
     */
    private createBatches<T>( items: T[], batchSize: number ): T[][] {
        const batches: T[][] = []
        for ( let i = 0; i < items.length; i += batchSize ) {
            batches.push( items.slice( i, i + batchSize ) )
        }
        return batches
    }

    /**
     * Get tasks sorted by priority and last execution
     */
    private getSortedTasks(): WarmupTask[] {
        const priorityOrder = { high: 0, medium: 1, low: 2 }
        
        return Array.from( this.tasks.values() ).sort( ( a, b ) => {
            // Sort by priority first
            const priorityDiff = priorityOrder[ a.priority ] - priorityOrder[ b.priority ]
            if ( priorityDiff !== 0 ) return priorityDiff
            
            // Then by last execution (least recent first)
            const aTime = a.lastExecuted?.getTime() || 0
            const bTime = b.lastExecuted?.getTime() || 0
            return aTime - bTime
        } )
    }

    /**
     * Update warmup statistics
     */
    private updateWarmupStats( duration: number ): void {
        this.warmupTimes.push( duration )
        
        // Keep only recent times for average calculation
        if ( this.warmupTimes.length > 100 ) {
            this.warmupTimes = this.warmupTimes.slice( -50 )
        }
        
        // Calculate average
        const sum = this.warmupTimes.reduce( ( a, b ) => a + b, 0 )
        this.stats.averageWarmupTime = sum / this.warmupTimes.length
    }

    /**
     * Generate unique task ID
     */
    private generateTaskId(): string {
        return `task_${Date.now()}_${Math.random().toString( 36 ).substr( 2, 9 )}`
    }

    /**
     * Log messages with optional logger
     */
    private log( level: "debug" | "info" | "warn" | "error", message: string, data?: any ): void {
        if ( this.config.logger ) {
            this.config.logger[ level ]( `[CacheWarmer] ${message}`, data )
        }
    }

    /**
     * Cleanup resources
     */
    destroy(): void {
        this.stop()
        this.tasks.clear()
        this.warmupTimes = []
    }
} 