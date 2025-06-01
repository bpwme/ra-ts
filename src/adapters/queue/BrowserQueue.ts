// ============================================================================
// FILE: src/adapters/queue/BrowserQueue.ts
// ============================================================================

import type { IQueueAdapter, QueueJob, Either } from "../../types"
import { QueueError, success, error } from "../../types"

/**
 * Configuration for browser queue
 */
export type BrowserQueueConfig = {
  /** Database name for IndexedDB */
  dbName?: string
  /** Object store name */
  storeName?: string
  /** Database version */
  version?: number
  /** Maximum number of jobs to store */
  maxJobs?: number
  /** Process interval in milliseconds */
  processInterval?: number
  /** Maximum retry delay in milliseconds */
  maxRetryDelay?: number
  /** Base retry delay in milliseconds */
  baseRetryDelay?: number
}

/**
 * Job status enumeration
 */
export enum JobStatus {
  PENDING = "pending",
  PROCESSING = "processing", 
  COMPLETED = "completed",
  FAILED = "failed",
  RETRYING = "retrying"
}

/**
 * Extended job with processing metadata
 */
export type BrowserQueueJob<T = any> = QueueJob<T> & {
  status: JobStatus
  attempts: number
  lastAttempt?: number
  nextRetry?: number
  error?: string
  priority: number
}

/**
 * Queue processing statistics
 */
export type QueueStats = {
  totalJobs: number
  pendingJobs: number
  processingJobs: number
  completedJobs: number
  failedJobs: number
  retryingJobs: number
}

/**
 * Persistent offline queue using IndexedDB with retry logic and exponential backoff
 */
export class BrowserQueue implements IQueueAdapter {
    private db: IDBDatabase | null = null
    private dbPromise: Promise<IDBDatabase> | null = null
    private processTimer?: NodeJS.Timeout
    private handlers = new Map<string, ( job: BrowserQueueJob ) => Promise<Either<any, any>>>()
    private isProcessing = false
  
    private readonly dbName: string
    private readonly storeName: string
    private readonly version: number
    private readonly maxJobs: number
    private readonly processInterval: number
    private readonly maxRetryDelay: number
    private readonly baseRetryDelay: number

    constructor( config: BrowserQueueConfig = {} ) {
        this.dbName = config.dbName ?? "DataManagerQueue"
        this.storeName = config.storeName ?? "jobs"
        this.version = config.version ?? 1
        this.maxJobs = config.maxJobs ?? 1000
        this.processInterval = config.processInterval ?? 5000 // 5 seconds
        this.maxRetryDelay = config.maxRetryDelay ?? 300000 // 5 minutes
        this.baseRetryDelay = config.baseRetryDelay ?? 1000 // 1 second

        // Start processing when online
        this.startProcessing()
    
        // Listen for online/offline events
        if ( typeof window !== "undefined" ) {
            window.addEventListener( "online", () => this.startProcessing() )
            window.addEventListener( "offline", () => this.stopProcessing() )
        }
    }

    /**
   * Initialize IndexedDB connection
   */
    private async initDB(): Promise<IDBDatabase> {
        if ( this.db ) return this.db
        if ( this.dbPromise ) return this.dbPromise

        this.dbPromise = new Promise( ( resolve, reject ) => {
            if ( typeof indexedDB === "undefined" ) {
                reject( new Error( "IndexedDB not supported in this environment" ) )
                return
            }

            const request = indexedDB.open( this.dbName, this.version )

            request.onerror = () => {
                reject( new Error( `Failed to open queue database: ${request.error?.message}` ) )
            }

            request.onsuccess = () => {
                this.db = request.result
                resolve( this.db )
            }

            request.onupgradeneeded = ( event ) => {
                const db = ( event.target as IDBOpenDBRequest ).result
        
                if ( !db.objectStoreNames.contains( this.storeName ) ) {
                    const store = db.createObjectStore( this.storeName, { keyPath: "id" } )
                    store.createIndex( "status", "status", { unique: false } )
                    store.createIndex( "priority", "priority", { unique: false } )
                    store.createIndex( "nextRetry", "nextRetry", { unique: false } )
                    store.createIndex( "createdAt", "createdAt", { unique: false } )
                }
            }
        } )

        return this.dbPromise
    }

    /**
   * Add a job to the queue
   */
    async add<T>( job: QueueJob<T> ): Promise<Either<QueueError, void>> {
        try {
            const db = await this.initDB()
            const transaction = db.transaction( [ this.storeName ], "readwrite" )
            const store = transaction.objectStore( this.storeName )

            // Check queue size and evict if needed
            await this.evictIfNeeded( store )

            const browserJob: BrowserQueueJob<T> = {
                ...job,
                status: JobStatus.PENDING,
                attempts: 0,
                priority: 0, // Default priority
                createdAt: job.createdAt || new Date()
            }

            return new Promise( ( resolve ) => {
                const request = store.add( browserJob )
        
                request.onsuccess = () => {
                    resolve( success( undefined ) )
                    // Trigger immediate processing if online
                    if ( navigator.onLine !== false ) {
                        this.processJobs()
                    }
                }

                request.onerror = () => {
                    resolve( error( new QueueError(
                        `Failed to add job to queue: ${request.error?.message}`,
                        { jobId: job.id, error: request.error }
                    ) ) )
                }
            } )
        } catch ( err ) {
            return error( new QueueError(
                `Queue add operation failed: ${err instanceof Error ? err.message : "Unknown error"}`,
                { jobId: job.id, error: err }
            ) )
        }
    }

    /**
   * Process jobs with a handler function
   */
    process<T>( handler: ( job: QueueJob<T> ) => Promise<Either<any, T>> ): void {
        this.handlers.set( "default", handler as any )
        this.startProcessing()
    }

    /**
   * Process jobs for a specific type
   */
    processType<T>(
        type: string, 
        handler: ( job: QueueJob<T> ) => Promise<Either<any, T>>
    ): void {
        this.handlers.set( type, handler as any )
        this.startProcessing()
    }

    /**
   * Retry a failed job
   */
    async retry<T>( job: QueueJob<T> ): Promise<Either<QueueError, void>> {
        try {
            const db = await this.initDB()
            const transaction = db.transaction( [ this.storeName ], "readwrite" )
            const store = transaction.objectStore( this.storeName )

            return new Promise( ( resolve ) => {
                const getRequest = store.get( job.id )
        
                getRequest.onsuccess = () => {
                    const existingJob: BrowserQueueJob = getRequest.result
          
                    if ( !existingJob ) {
                        resolve( error( new QueueError(
                            "Job not found for retry",
                            { jobId: job.id }
                        ) ) )
                        return
                    }

                    // Update job for retry
                    existingJob.status = JobStatus.PENDING
                    existingJob.attempts = 0
                    existingJob.lastAttempt = undefined
                    existingJob.nextRetry = undefined
                    existingJob.error = undefined

                    const putRequest = store.put( existingJob )
          
                    putRequest.onsuccess = () => {
                        resolve( success( undefined ) )
                        this.processJobs()
                    }

                    putRequest.onerror = () => {
                        resolve( error( new QueueError(
                            `Failed to retry job: ${putRequest.error?.message}`,
                            { jobId: job.id, error: putRequest.error }
                        ) ) )
                    }
                }

                getRequest.onerror = () => {
                    resolve( error( new QueueError(
                        `Failed to find job for retry: ${getRequest.error?.message}`,
                        { jobId: job.id, error: getRequest.error }
                    ) ) )
                }
            } )
        } catch ( err ) {
            return error( new QueueError(
                `Queue retry operation failed: ${err instanceof Error ? err.message : "Unknown error"}`,
                { jobId: job.id, error: err }
            ) )
        }
    }

    /**
   * Get queue statistics
   */
    async getStats(): Promise<QueueStats> {
        try {
            const db = await this.initDB()
            const transaction = db.transaction( [ this.storeName ], "readonly" )
            const store = transaction.objectStore( this.storeName )

            return new Promise( ( resolve ) => {
                const stats: QueueStats = {
                    totalJobs: 0,
                    pendingJobs: 0,
                    processingJobs: 0,
                    completedJobs: 0,
                    failedJobs: 0,
                    retryingJobs: 0
                }

                const request = store.openCursor()
        
                request.onsuccess = ( event ) => {
                    const cursor = ( event.target as IDBRequest ).result
          
                    if ( cursor ) {
                        const job: BrowserQueueJob = cursor.value
                        stats.totalJobs++
            
                        switch ( job.status ) {
                        case JobStatus.PENDING:
                            stats.pendingJobs++
                            break
                        case JobStatus.PROCESSING:
                            stats.processingJobs++
                            break
                        case JobStatus.COMPLETED:
                            stats.completedJobs++
                            break
                        case JobStatus.FAILED:
                            stats.failedJobs++
                            break
                        case JobStatus.RETRYING:
                            stats.retryingJobs++
                            break
                        }
            
                        cursor.continue()
                    } else {
                        resolve( stats )
                    }
                }

                request.onerror = () => resolve( stats )
            } )
        } catch {
            return {
                totalJobs: 0,
                pendingJobs: 0,
                processingJobs: 0,
                completedJobs: 0,
                failedJobs: 0,
                retryingJobs: 0
            }
        }
    }

    /**
   * Clear completed jobs from the queue
   */
    async clearCompleted(): Promise<number> {
        try {
            const db = await this.initDB()
            const transaction = db.transaction( [ this.storeName ], "readwrite" )
            const store = transaction.objectStore( this.storeName )
            const index = store.index( "status" )

            return new Promise( ( resolve ) => {
                let deletedCount = 0
                const request = index.openCursor( IDBKeyRange.only( JobStatus.COMPLETED ) )
        
                request.onsuccess = ( event ) => {
                    const cursor = ( event.target as IDBRequest ).result
          
                    if ( cursor ) {
                        cursor.delete()
                        deletedCount++
                        cursor.continue()
                    } else {
                        resolve( deletedCount )
                    }
                }

                request.onerror = () => resolve( 0 )
            } )
        } catch {
            return 0
        }
    }

    /**
   * Start automatic job processing
   */
    startProcessing(): void {
        if ( !this.processTimer ) {
            this.processTimer = setInterval( () => {
                this.processJobs()
            }, this.processInterval )

            // Don't keep process alive just for queue processing
            if ( this.processTimer.unref ) {
                this.processTimer.unref()
            }
        }
    }

    /**
   * Stop automatic job processing
   */
    stopProcessing(): void {
        if ( this.processTimer ) {
            clearInterval( this.processTimer )
            this.processTimer = undefined
        }
    }

    /**
   * Destroy the queue and close connections
   */
    async destroy(): Promise<void> {
        this.stopProcessing()
    
        if ( this.db ) {
            this.db.close()
            this.db = null
            this.dbPromise = null
        }

        this.handlers.clear()
    }

    // ============================================================================
    // PRIVATE METHODS
    // ============================================================================

    /**
   * Process pending jobs
   */
    private async processJobs(): Promise<void> {
        if ( this.isProcessing || navigator.onLine === false ) {
            return
        }

        this.isProcessing = true

        try {
            const db = await this.initDB()
            const transaction = db.transaction( [ this.storeName ], "readwrite" )
            const store = transaction.objectStore( this.storeName )

            // Get pending jobs and jobs ready for retry
            const pendingJobs = await this.getPendingJobs( store )
            const retryJobs = await this.getRetryReadyJobs( store )
      
            const jobsToProcess = [ ...pendingJobs, ...retryJobs ]
                .sort( ( a, b ) => b.priority - a.priority ) // Higher priority first

            for ( const job of jobsToProcess.slice( 0, 5 ) ) { // Process max 5 at a time
                await this.processJob( job, store )
            }
        } catch ( err ) {
            console.error( "Error processing jobs:", err )
        } finally {
            this.isProcessing = false
        }
    }

    /**
   * Process a single job
   */
    private async processJob( job: BrowserQueueJob, store: IDBObjectStore ): Promise<void> {
        const handler = this.handlers.get( job.type ) || this.handlers.get( "default" )
    
        if ( !handler ) {
            console.warn( `No handler found for job type: ${job.type}` )
            return
        }

        // Mark job as processing
        job.status = JobStatus.PROCESSING
        job.attempts++
        job.lastAttempt = Date.now()
        store.put( job )

        try {
            const result = await handler( job )

            if ( result.success ) {
                // Job succeeded
                job.status = JobStatus.COMPLETED
                job.error = undefined
                store.put( job )
            } else {
                // Job failed
                await this.handleJobFailure( job, result.error, store )
            }
        } catch ( err ) {
            // Unexpected error
            await this.handleJobFailure( job, err, store )
        }
    }

    /**
   * Handle job failure with retry logic
   */
    private async handleJobFailure(
        job: BrowserQueueJob, 
        jobError: any, 
        store: IDBObjectStore
    ): Promise<void> {
        job.error = jobError instanceof Error ? jobError.message : String( jobError )

        if ( job.attempts >= job.maxRetries ) {
            // Max retries exceeded
            job.status = JobStatus.FAILED
            store.put( job )
        } else {
            // Schedule retry with exponential backoff
            job.status = JobStatus.RETRYING
            const delay = Math.min(
                this.baseRetryDelay * Math.pow( 2, job.attempts - 1 ),
                this.maxRetryDelay
            )
            job.nextRetry = Date.now() + delay
            store.put( job )
        }
    }

    /**
   * Get pending jobs from store
   */
    private async getPendingJobs( store: IDBObjectStore ): Promise<BrowserQueueJob[]> {
        return new Promise( ( resolve ) => {
            const jobs: BrowserQueueJob[] = []
            const index = store.index( "status" )
            const request = index.openCursor( IDBKeyRange.only( JobStatus.PENDING ) )
      
            request.onsuccess = ( event ) => {
                const cursor = ( event.target as IDBRequest ).result
        
                if ( cursor ) {
                    jobs.push( cursor.value )
                    cursor.continue()
                } else {
                    resolve( jobs )
                }
            }

            request.onerror = () => resolve( [] )
        } )
    }

    /**
   * Get jobs ready for retry
   */
    private async getRetryReadyJobs( store: IDBObjectStore ): Promise<BrowserQueueJob[]> {
        return new Promise( ( resolve ) => {
            const jobs: BrowserQueueJob[] = []
            const index = store.index( "status" )
            const request = index.openCursor( IDBKeyRange.only( JobStatus.RETRYING ) )
      
            request.onsuccess = ( event ) => {
                const cursor = ( event.target as IDBRequest ).result
        
                if ( cursor ) {
                    const job: BrowserQueueJob = cursor.value
          
                    // Check if retry time has passed
                    if ( job.nextRetry && Date.now() >= job.nextRetry ) {
                        job.status = JobStatus.PENDING
                        job.nextRetry = undefined
                        jobs.push( job )
                    }
          
                    cursor.continue()
                } else {
                    resolve( jobs )
                }
            }

            request.onerror = () => resolve( [] )
        } )
    }

    /**
   * Evict old jobs if queue is at capacity
   */
    private async evictIfNeeded( store: IDBObjectStore ): Promise<void> {
        return new Promise( ( resolve ) => {
            const countRequest = store.count()
      
            countRequest.onsuccess = () => {
                if ( countRequest.result >= this.maxJobs ) {
                    // Remove oldest completed jobs first
                    const index = store.index( "createdAt" )
                    const cursorRequest = index.openCursor()
                    let evictCount = 0
                    const toEvict = Math.floor( this.maxJobs * 0.1 ) // Evict 10%
          
                    cursorRequest.onsuccess = ( event ) => {
                        const cursor = ( event.target as IDBRequest ).result
            
                        if ( cursor && evictCount < toEvict ) {
                            const job: BrowserQueueJob = cursor.value
              
                            if ( job.status === JobStatus.COMPLETED || job.status === JobStatus.FAILED ) {
                                cursor.delete()
                                evictCount++
                            }
              
                            cursor.continue()
                        } else {
                            resolve()
                        }
                    }

                    cursorRequest.onerror = () => resolve()
                } else {
                    resolve()
                }
            }

            countRequest.onerror = () => resolve()
        } )
    }
}
