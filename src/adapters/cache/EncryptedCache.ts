import type { ICacheAdapter, Either } from "../../types"
import { success, error, CacheError } from "../../types"

// Import your encryption utilities
let SecureStorage: any
let encryption: any

try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const encryptionModule = require( "../../utils/encryption" )
    SecureStorage = encryptionModule.SecureStorage
    encryption = encryptionModule.encryption
} catch {
    // Encryption utilities not available
}

/**
 * Configuration for encrypted cache
 */
export type EncryptedCacheConfig = {
  /** Underlying cache adapter to wrap */
  baseCache: ICacheAdapter
  /** Encryption password (for password-based encryption) */
  password?: string
  /** Storage key for the encrypted cache */
  storageKey?: string
  /** Whether to use session storage for keys (more secure) */
  useSessionStorage?: boolean
  /** Whether to fail if encryption is not available */
  requireEncryption?: boolean
}

/**
 * Cache adapter that encrypts data before storing in the base cache
 */
export class EncryptedCache implements ICacheAdapter {
    private secureStorage: any
    private baseCache: ICacheAdapter
    private readonly config: Required<Omit<EncryptedCacheConfig, "password">> & { password?: string }
    private readonly hasEncryption: boolean
    private isInitialized: boolean = false

    constructor( config: EncryptedCacheConfig ) {
        this.baseCache = config.baseCache
        this.config = {
            baseCache: config.baseCache,
            password: config.password,
            storageKey: config.storageKey ?? "encrypted_cache",
            useSessionStorage: config.useSessionStorage ?? true,
            requireEncryption: config.requireEncryption ?? true
        }

        this.hasEncryption = !!( SecureStorage && encryption )

        if ( this.config.requireEncryption && !this.hasEncryption ) {
            throw new Error( "EncryptedCache: Encryption utilities not available. Please install the encryption module." )
        }

        if ( !this.hasEncryption ) {
            console.warn( "EncryptedCache: Encryption not available, falling back to base cache without encryption" )
        }
    }

    /**
   * Initialize the encrypted cache
   */
    private async initialize(): Promise<void> {
        if ( this.isInitialized || !this.hasEncryption ) {
            return
        }

        this.secureStorage = new SecureStorage( this.config.storageKey )

        if ( this.config.password ) {
            // Try to initialize with existing password first
            const existingInitialized = await this.secureStorage.initWithExistingPassword( this.config.password )
      
            if ( !existingInitialized ) {
                // Initialize with new password
                await this.secureStorage.initWithPassword( this.config.password )
            }
        } else {
            // Try to load existing key
            const keyLoaded = await this.secureStorage.loadExistingKey()
      
            if ( !keyLoaded ) {
                // Generate new key
                await this.secureStorage.generateNewKey()
            }
        }

        this.isInitialized = true
    }

    /**
   * Get encrypted data from cache
   */
    async get<T>( key: string ): Promise<Either<CacheError, T | undefined>> {
        try {
            if ( !this.hasEncryption ) {
                return this.baseCache.get<T>( key )
            }

            await this.initialize()

            // Get encrypted data from base cache
            const baseResult = await this.baseCache.get<any>( `enc_${key}` )
      
            if ( !baseResult.success ) {
                return baseResult
            }

            if ( baseResult.data === undefined ) {
                return success( undefined )
            }

            // Decrypt the data
            try {
                const decryptedData = await this.secureStorage.getItem()
        
                // The encrypted cache stores all data in one encrypted blob
                // We need to get the specific key from that blob
                if ( decryptedData && typeof decryptedData === "object" && decryptedData[ key ] !== undefined ) {
                    return success( decryptedData[ key ] as T )
                } else {
                    return success( undefined )
                }
            } catch ( decryptError ) {
                return error( new CacheError(
                    `Failed to decrypt cache data: ${decryptError instanceof Error ? decryptError.message : "Unknown error"}`,
                    { key, error: decryptError }
                ) )
            }
        } catch ( err ) {
            return error( new CacheError(
                `EncryptedCache get failed: ${err instanceof Error ? err.message : "Unknown error"}`,
                { key, error: err }
            ) )
        }
    }

    /**
   * Set encrypted data in cache
   */
    async set<T>( key: string, value: T, ttl?: number ): Promise<Either<CacheError, void>> {
        try {
            if ( !this.hasEncryption ) {
                return this.baseCache.set( key, value, ttl )
            }

            await this.initialize()

            // Get existing encrypted data
            let existingData: Record<string, any> = {}
            try {
                const existing = await this.secureStorage.getItem()
                if ( existing && typeof existing === "object" ) {
                    existingData = existing
                }
            } catch {
                // Ignore errors when getting existing data (might be first write)
            }

            // Add new data
            existingData[ key ] = {
                value,
                timestamp: Date.now(),
                ttl
            }

            // Encrypt and store
            await this.secureStorage.setItem( existingData )

            // Store a marker in the base cache so we know this key exists
            return this.baseCache.set( `enc_${key}`, true, ttl )
        } catch ( err ) {
            return error( new CacheError(
                `EncryptedCache set failed: ${err instanceof Error ? err.message : "Unknown error"}`,
                { key, error: err }
            ) )
        }
    }

    /**
   * Delete encrypted data from cache
   */
    async delete( key: string ): Promise<Either<CacheError, void>> {
        try {
            if ( !this.hasEncryption ) {
                return this.baseCache.delete( key )
            }

            await this.initialize()

            // Get existing encrypted data
            try {
                const existingData = await this.secureStorage.getItem()
                if ( existingData && typeof existingData === "object" ) {
                    delete existingData[ key ]
                    await this.secureStorage.setItem( existingData )
                }
            } catch {
                // Ignore errors when updating encrypted data
            }

            // Delete marker from base cache
            return this.baseCache.delete( `enc_${key}` )
        } catch ( err ) {
            return error( new CacheError(
                `EncryptedCache delete failed: ${err instanceof Error ? err.message : "Unknown error"}`,
                { key, error: err }
            ) )
        }
    }

    /**
   * Clear all encrypted data
   */
    async clear(): Promise<Either<CacheError, void>> {
        try {
            if ( !this.hasEncryption ) {
                return this.baseCache.clear()
            }

            if ( this.secureStorage ) {
                this.secureStorage.clear()
            }

            return this.baseCache.clear()
        } catch ( err ) {
            return error( new CacheError(
                `EncryptedCache clear failed: ${err instanceof Error ? err.message : "Unknown error"}`,
                { error: err }
            ) )
        }
    }

    /**
   * Invalidate encrypted cache entries
   */
    async invalidate( pattern: string ): Promise<Either<CacheError, void>> {
        try {
            if ( !this.hasEncryption ) {
                return this.baseCache.invalidate( pattern )
            }

            await this.initialize()

            // Get existing encrypted data and remove matching keys
            try {
                const existingData = await this.secureStorage.getItem()
                if ( existingData && typeof existingData === "object" ) {
                    const regex = this.patternToRegex( pattern )
                    const keysToDelete = Object.keys( existingData ).filter( key => regex.test( key ) )
          
                    keysToDelete.forEach( key => delete existingData[ key ] )
                    await this.secureStorage.setItem( existingData )
                }
            } catch {
                // Ignore errors when updating encrypted data
            }

            // Invalidate markers in base cache
            return this.baseCache.invalidate( `enc_${pattern}` )
        } catch ( err ) {
            return error( new CacheError(
                `EncryptedCache invalidate failed: ${err instanceof Error ? err.message : "Unknown error"}`,
                { pattern, error: err }
            ) )
        }
    }

    /**
   * Check if encryption is available and initialized
   */
    isEncryptionEnabled(): boolean {
        return this.hasEncryption && this.isInitialized
    }

    /**
   * Get the underlying base cache
   */
    getBaseCache(): ICacheAdapter {
        return this.baseCache
    }

    // ============================================================================
    // PRIVATE METHODS
    // ============================================================================

    private patternToRegex( pattern: string ): RegExp {
        const escaped = pattern.replace( /[.+?^${}()|[\]\\]/g, "\\$&" )
        const regexPattern = escaped.replace( /\*/g, ".*" )
        return new RegExp( `^${regexPattern}$` )
    }
}