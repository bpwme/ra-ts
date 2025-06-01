import type { CacheAdapter, Either } from "../../types"
import { CacheError, success, error } from "../../types"

/**
 * Configuration for IndexedDB cache
 */
export type IndexedDBCacheConfig = {
  /** Database name */
  dbName?: string
  /** Object store name */
  storeName?: string
  /** Database version */
  version?: number
  /** Default TTL in milliseconds */
  defaultTTL?: number
  /** Maximum number of entries */
  maxEntries?: number
}

/**
 * IndexedDB cache entry with metadata
 */
type IndexedDBEntry<T = any> = {
  key: string
  value: T
  timestamp: number
  ttl?: number
  accessCount: number
  lastAccessed: number
}

/**
 * High-performance IndexedDB cache adapter for persistent storage
 */
export class IndexedDBCache implements CacheAdapter {
    private db: IDBDatabase | null = null
    private dbPromise: Promise<IDBDatabase> | null = null
  
    private readonly dbName: string
    private readonly storeName: string
    private readonly version: number
    private readonly defaultTTL?: number
    private readonly maxEntries: number

    constructor( config: IndexedDBCacheConfig = {} ) {
        this.dbName = config.dbName ?? "DataManagerCache"
        this.storeName = config.storeName ?? "cache"
        this.version = config.version ?? 1
        this.defaultTTL = config.defaultTTL
        this.maxEntries = config.maxEntries ?? 10000
    }

    /**
   * Initialize the IndexedDB connection
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
                reject( new Error( `Failed to open IndexedDB: ${request.error?.message}` ) )
            }

            request.onsuccess = () => {
                this.db = request.result
                resolve( this.db )
            }

            request.onupgradeneeded = ( event ) => {
                const db = ( event.target as IDBOpenDBRequest ).result
        
                // Create object store if it doesn't exist
                if ( !db.objectStoreNames.contains( this.storeName ) ) {
                    const store = db.createObjectStore( this.storeName, { keyPath: "key" } )
                    store.createIndex( "timestamp", "timestamp", { unique: false } )
                    store.createIndex( "lastAccessed", "lastAccessed", { unique: false } )
                }
            }
        } )

        return this.dbPromise
    }

    /**
   * Retrieve a value from cache
   */
    async get<T>( key: string ): Promise<Either<CacheError, T | undefined>> {
        try {
            const db = await this.initDB()
            const transaction = db.transaction( [ this.storeName ], "readwrite" )
            const store = transaction.objectStore( this.storeName )
      
            return new Promise( ( resolve ) => {
                const request = store.get( key )
        
                request.onsuccess = () => {
                    const entry: IndexedDBEntry<T> | undefined = request.result
          
                    if ( !entry ) {
                        resolve( success( undefined ) )
                        return
                    }

                    // Check if entry has expired
                    if ( this.isExpired( entry ) ) {
                        // Delete expired entry
                        store.delete( key )
                        resolve( success( undefined ) )
                        return
                    }

                    // Update access metadata
                    entry.accessCount++
                    entry.lastAccessed = Date.now()
                    store.put( entry )

                    resolve( success( entry.value ) )
                }

                request.onerror = () => {
                    resolve( error( new CacheError(
                        `Failed to get cache entry: ${request.error?.message}`,
                        { key, error: request.error }
                    ) ) )
                }
            } )
        } catch ( err ) {
            return error( new CacheError(
                `IndexedDB get operation failed: ${err instanceof Error ? err.message : "Unknown error"}`,
                { key, error: err }
            ) )
        }
    }

    /**
   * Store a value in cache with optional TTL
   */
    async set<T>( key: string, value: T, ttl?: number ): Promise<Either<CacheError, void>> {
        try {
            const db = await this.initDB()
            const transaction = db.transaction( [ this.storeName ], "readwrite" )
            const store = transaction.objectStore( this.storeName )
      
            const now = Date.now()
            const effectiveTTL = ttl ?? this.defaultTTL
      
            const entry: IndexedDBEntry<T> = {
                key,
                value: this.addTimestamp( value ),
                timestamp: now,
                ttl: effectiveTTL,
                accessCount: 1,
                lastAccessed: now
            }

            return new Promise( async ( resolve ) => {
                // Check if we need to evict entries
                await this.evictIfNeeded( store )

                const request = store.put( entry )
        
                request.onsuccess = () => {
                    resolve( success( undefined ) )
                }

                request.onerror = () => {
                    resolve( error( new CacheError(
                        `Failed to set cache entry: ${request.error?.message}`,
                        { key, error: request.error }
                    ) ) )
                }
            } )
        } catch ( err ) {
            return error( new CacheError(
                `IndexedDB set operation failed: ${err instanceof Error ? err.message : "Unknown error"}`,
                { key, error: err }
            ) )
        }
    }

    /**
   * Remove a specific key from cache
   */
    async delete( key: string ): Promise<Either<CacheError, void>> {
        try {
            const db = await this.initDB()
            const transaction = db.transaction( [ this.storeName ], "readwrite" )
            const store = transaction.objectStore( this.storeName )
      
            return new Promise( ( resolve ) => {
                const request = store.delete( key )
        
                request.onsuccess = () => {
                    resolve( success( undefined ) )
                }

                request.onerror = () => {
                    resolve( error( new CacheError(
                        `Failed to delete cache entry: ${request.error?.message}`,
                        { key, error: request.error }
                    ) ) )
                }
            } )
        } catch ( err ) {
            return error( new CacheError(
                `IndexedDB delete operation failed: ${err instanceof Error ? err.message : "Unknown error"}`,
                { key, error: err }
            ) )
        }
    }

    /**
   * Clear all cached data
   */
    async clear(): Promise<Either<CacheError, void>> {
        try {
            const db = await this.initDB()
            const transaction = db.transaction( [ this.storeName ], "readwrite" )
            const store = transaction.objectStore( this.storeName )
      
            return new Promise( ( resolve ) => {
                const request = store.clear()
        
                request.onsuccess = () => {
                    resolve( success( undefined ) )
                }

                request.onerror = () => {
                    resolve( error( new CacheError(
                        `Failed to clear cache: ${request.error?.message}`,
                        { error: request.error }
                    ) ) )
                }
            } )
        } catch ( err ) {
            return error( new CacheError(
                `IndexedDB clear operation failed: ${err instanceof Error ? err.message : "Unknown error"}`,
                { error: err }
            ) )
        }
    }

    /**
   * Invalidate cache entries matching a pattern
   */
    async invalidate( pattern: string ): Promise<Either<CacheError, void>> {
        try {
            const db = await this.initDB()
            const transaction = db.transaction( [ this.storeName ], "readwrite" )
            const store = transaction.objectStore( this.storeName )
      
            const regex = this.patternToRegex( pattern )
            const keysToDelete: string[] = []

            return new Promise( ( resolve ) => {
                const request = store.openCursor()
        
                request.onsuccess = ( event ) => {
                    const cursor = ( event.target as IDBRequest ).result
          
                    if ( cursor ) {
                        const entry: IndexedDBEntry = cursor.value
                        if ( regex.test( entry.key ) ) {
                            keysToDelete.push( entry.key )
                        }
                        cursor.continue()
                    } else {
                        // Delete all matching keys
                        let deleteCount = 0
                        let hasError = false

                        if ( keysToDelete.length === 0 ) {
                            resolve( success( undefined ) )
                            return
                        }

                        keysToDelete.forEach( key => {
                            const deleteRequest = store.delete( key )
              
                            deleteRequest.onsuccess = () => {
                                deleteCount++
                                if ( deleteCount === keysToDelete.length && !hasError ) {
                                    resolve( success( undefined ) )
                                }
                            }

                            deleteRequest.onerror = () => {
                                if ( !hasError ) {
                                    hasError = true
                                    resolve( error( new CacheError(
                                        `Failed to delete key during invalidation: ${deleteRequest.error?.message}`,
                                        { pattern, key, error: deleteRequest.error }
                                    ) ) )
                                }
                            }
                        } )
                    }
                }

                request.onerror = () => {
                    resolve( error( new CacheError(
                        `Failed to iterate cache for invalidation: ${request.error?.message}`,
                        { pattern, error: request.error }
                    ) ) )
                }
            } )
        } catch ( err ) {
            return error( new CacheError(
                `IndexedDB invalidate operation failed: ${err instanceof Error ? err.message : "Unknown error"}`,
                { pattern, error: err }
            ) )
        }
    }

    /**
   * Get cache statistics
   */
    async getStats() {
        try {
            const db = await this.initDB()
            const transaction = db.transaction( [ this.storeName ], "readonly" )
            const store = transaction.objectStore( this.storeName )
      
            return new Promise<{
        totalEntries: number
        expiredEntries: number
        oldestEntry?: string
        newestEntry?: string
        estimatedSize: number
      }>( ( resolve ) => {
          let totalEntries = 0
          let expiredEntries = 0
          let oldestTimestamp = Infinity
          let newestTimestamp = 0
          let oldestEntry: string | undefined
          let newestEntry: string | undefined
          let estimatedSize = 0

          const request = store.openCursor()
        
          request.onsuccess = ( event ) => {
              const cursor = ( event.target as IDBRequest ).result
          
              if ( cursor ) {
                  const entry: IndexedDBEntry = cursor.value
                  totalEntries++
            
                  if ( this.isExpired( entry ) ) {
                      expiredEntries++
                  }

                  if ( entry.timestamp < oldestTimestamp ) {
                      oldestTimestamp = entry.timestamp
                      oldestEntry = entry.key
                  }

                  if ( entry.timestamp > newestTimestamp ) {
                      newestTimestamp = entry.timestamp
                      newestEntry = entry.key
                  }

                  // Rough size estimation
                  estimatedSize += JSON.stringify( entry ).length * 2 // UTF-16

                  cursor.continue()
              } else {
                  resolve( {
                      totalEntries,
                      expiredEntries,
                      oldestEntry,
                      newestEntry,
                      estimatedSize
                  } )
              }
          }

          request.onerror = () => {
              resolve( {
                  totalEntries: 0,
                  expiredEntries: 0,
                  estimatedSize: 0
              } )
          }
      } )
        } catch {
            return {
                totalEntries: 0,
                expiredEntries: 0,
                estimatedSize: 0
            }
        }
    }

    /**
   * Cleanup expired entries
   */
    async cleanup(): Promise<number> {
        try {
            const db = await this.initDB()
            const transaction = db.transaction( [ this.storeName ], "readwrite" )
            const store = transaction.objectStore( this.storeName )
      
            const expiredKeys: string[] = []

            return new Promise( ( resolve ) => {
                const request = store.openCursor()
        
                request.onsuccess = ( event ) => {
                    const cursor = ( event.target as IDBRequest ).result
          
                    if ( cursor ) {
                        const entry: IndexedDBEntry = cursor.value
                        if ( this.isExpired( entry ) ) {
                            expiredKeys.push( entry.key )
                        }
                        cursor.continue()
                    } else {
                        // Delete expired entries
                        let deleteCount = 0

                        if ( expiredKeys.length === 0 ) {
                            resolve( 0 )
                            return
                        }

                        expiredKeys.forEach( key => {
                            const deleteRequest = store.delete( key )
                            deleteRequest.onsuccess = () => {
                                deleteCount++
                                if ( deleteCount === expiredKeys.length ) {
                                    resolve( expiredKeys.length )
                                }
                            }
                        } )
                    }
                }

                request.onerror = () => resolve( 0 )
            } )
        } catch {
            return 0
        }
    }

    /**
   * Close the database connection
   */
    async close(): Promise<void> {
        if ( this.db ) {
            this.db.close()
            this.db = null
            this.dbPromise = null
        }
    }

    // ============================================================================
    // PRIVATE METHODS
    // ============================================================================

    private isExpired( entry: IndexedDBEntry ): boolean {
        if ( !entry.ttl ) return false
        return Date.now() - entry.timestamp > entry.ttl
    }

    private async evictIfNeeded( store: IDBObjectStore ): Promise<void> {
        return new Promise( ( resolve ) => {
            const countRequest = store.count()
      
            countRequest.onsuccess = () => {
                const count = countRequest.result
        
                if ( count >= this.maxEntries ) {
                    // Evict oldest entries
                    const index = store.index( "lastAccessed" )
                    const cursorRequest = index.openCursor()
                    let evictCount = 0
                    const toEvict = Math.max( 1, Math.floor( this.maxEntries * 0.1 ) ) // Evict 10%
          
                    cursorRequest.onsuccess = ( event ) => {
                        const cursor = ( event.target as IDBRequest ).result
            
                        if ( cursor && evictCount < toEvict ) {
                            store.delete( cursor.primaryKey )
                            evictCount++
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

    private patternToRegex( pattern: string ): RegExp {
        const escaped = pattern.replace( /[.+?^${}()|[\]\\]/g, "\\$&" )
        const regexPattern = escaped.replace( /\*/g, ".*" )
        return new RegExp( `^${regexPattern}$` )
    }

    private addTimestamp<T>( value: T ): T {
        if ( value && typeof value === "object" && !Array.isArray( value ) ) {
            return {
                ...value as any,
                _timestamp: Date.now()
            }
        }
        return value
    }
}