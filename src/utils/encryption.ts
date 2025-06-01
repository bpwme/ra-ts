/**
 * Encryption utilities for securing localStorage data
 * Uses Web Crypto API with AES-GCM for authenticated encryption
 */

/**
 * Generate a cryptographic key for encryption/decryption
 */
const generateKey = async (): Promise<CryptoKey> => {
    return await crypto.subtle.generateKey(
        {
            name: "AES-GCM",
            length: 256,
        },
        true, // extractable
        [ "encrypt", "decrypt" ],
    )
}

/**
 * Export a key to raw format for storage
 */
const exportKey = async ( key: CryptoKey ): Promise<ArrayBuffer> => {
    return await crypto.subtle.exportKey( "raw", key )
}

/**
 * Import a key from raw format
 */
const importKey = async ( keyData: ArrayBuffer ): Promise<CryptoKey> => {
    return await crypto.subtle.importKey(
        "raw",
        keyData,
        {
            name: "AES-GCM",
            length: 256,
        },
        true,
        [ "encrypt", "decrypt" ],
    )
}

/**
 * Derive a key from a password using PBKDF2
 */
const deriveKeyFromPassword = async (
    password: string,
    salt: Uint8Array,
): Promise<CryptoKey> => {
    const encoder = new TextEncoder()
    const passwordBuffer = encoder.encode( password )

    // Import password as key material
    const keyMaterial = await crypto.subtle.importKey(
        "raw",
        passwordBuffer,
        {
            name: "PBKDF2"
        },
        false,
        [ "deriveKey" ],
    )

    // Derive actual encryption key
    return await crypto.subtle.deriveKey(
        {
            name: "PBKDF2",
            salt,
            iterations: 100000, // OWASP recommended minimum
            hash: "SHA-256",
        },
        keyMaterial,
        {
            name: "AES-GCM",
            length: 256,
        },
        true,
        [ "encrypt", "decrypt" ],
    )
}

/**
 * Generate a random salt
 */
const generateSalt = (): Uint8Array => {
    return crypto.getRandomValues( new Uint8Array( 16 ) )
}

/**
 * Generate a random IV (Initialization Vector)
 */
const generateIV = (): Uint8Array => {
    return crypto.getRandomValues( new Uint8Array( 12 ) ) // 96 bits for GCM
}

/**
 * Encrypt data using AES-GCM
 */
const encryptData = async (
    data: string,
    key: CryptoKey,
): Promise<{
        encrypted: ArrayBuffer
        iv: Uint8Array
    }> => {
    const encoder = new TextEncoder()
    const dataBuffer = encoder.encode( data )
    const iv = generateIV()

    const encrypted = await crypto.subtle.encrypt(
        {
            name: "AES-GCM",
            iv,
        },
        key,
        dataBuffer,
    )

    return {
        encrypted,
        iv
    }
}

/**
 * Decrypt data using AES-GCM
 */
const decryptData = async (
    encryptedData: ArrayBuffer,
    key: CryptoKey,
    iv: Uint8Array,
): Promise<string> => {
    const decrypted = await crypto.subtle.decrypt(
        {
            name: "AES-GCM",
            iv,
        },
        key,
        encryptedData,
    )

    const decoder = new TextDecoder()
    return decoder.decode( decrypted )
}

/**
 * Convert ArrayBuffer to base64 string for storage
 */
const arrayBufferToBase64 = ( buffer: ArrayBuffer ): string => {
    const bytes = new Uint8Array( buffer )
    let binary = ""
    for ( let i = 0; i < bytes.byteLength; i++ ) {
        binary += String.fromCharCode( bytes[ i ] )
    }
    return btoa( binary )
}

/**
 * Convert base64 string back to ArrayBuffer
 */
const base64ToArrayBuffer = ( base64: string ): ArrayBuffer => {
    const binary = atob( base64 )
    const bytes = new Uint8Array( binary.length )
    for ( let i = 0; i < binary.length; i++ ) {
        bytes[ i ] = binary.charCodeAt( i )
    }
    return bytes.buffer
}

/**
 * Encrypted storage interface
 */
export type EncryptedData = {
    data: string // base64 encoded encrypted data
    iv: string // base64 encoded IV
    salt: string // base64 encoded salt
}

/**
 * Secure storage manager for localStorage
 */
export class SecureStorage {
    private key: CryptoKey | null = null
    private readonly keyStorageKey: string

    constructor( private readonly storageKey: string ) {
        this.keyStorageKey = `${storageKey}_key`
    }

    /**
     * Initialize with a password-derived key
     */
    async initWithPassword( password: string ): Promise<void> {
        const salt = generateSalt()
        this.key = await deriveKeyFromPassword( password, salt )

        // Store the salt for future use
        const saltBase64 = arrayBufferToBase64( salt.buffer as ArrayBuffer )
        sessionStorage.setItem( `${this.keyStorageKey}_salt`, saltBase64 )
    }

    /**
     * Initialize with an existing password (loads salt from storage)
     */
    async initWithExistingPassword( password: string ): Promise<boolean> {
        try {
            const saltBase64 = sessionStorage.getItem( `${this.keyStorageKey}_salt` )
            if ( !saltBase64 )
                return false

            const salt = new Uint8Array( base64ToArrayBuffer( saltBase64 ) )
            this.key = await deriveKeyFromPassword( password, salt )
            return true
        }
        catch {
            return false
        }
    }

    /**
     * Generate and store a new random key
     */
    async generateNewKey(): Promise<void> {
        this.key = await generateKey()
        const keyData = await exportKey( this.key )
        const keyBase64 = arrayBufferToBase64( keyData )

        // Store in sessionStorage (more secure than localStorage)
        sessionStorage.setItem( this.keyStorageKey, keyBase64 )
    }

    /**
     * Load existing key from storage
     */
    async loadExistingKey(): Promise<boolean> {
        try {
            const keyBase64 = sessionStorage.getItem( this.keyStorageKey )
            if ( !keyBase64 )
                return false

            const keyData = base64ToArrayBuffer( keyBase64 )
            this.key = await importKey( keyData )
            return true
        }
        catch {
            return false
        }
    }

    /**
     * Encrypt and store data
     */
    async setItem( data: any ): Promise<void> {
        if ( !this.key ) {
            throw new Error( "SecureStorage not initialized. Call generateNewKey() or initWithPassword() first." )
        }

        const jsonData = JSON.stringify( data )
        const {
            encrypted,
            iv
        } = await encryptData( jsonData, this.key )

        const encryptedData: EncryptedData = {
            data: arrayBufferToBase64( encrypted as ArrayBuffer ),
            iv: arrayBufferToBase64( iv.buffer as ArrayBuffer ),
            salt: "", // Not used for random keys
        }

        localStorage.setItem( this.storageKey, JSON.stringify( encryptedData ) )
    }

    /**
     * Decrypt and retrieve data
     */
    async getItem<T = any>(): Promise<T | null> {
        if ( !this.key ) {
            throw new Error( "SecureStorage not initialized. Call loadExistingKey() or initWithPassword() first." )
        }

        try {
            const storedData = localStorage.getItem( this.storageKey )
            if ( !storedData )
                return null

            const encryptedData: EncryptedData = JSON.parse( storedData )
            const encrypted = base64ToArrayBuffer( encryptedData.data )
            const iv = new Uint8Array( base64ToArrayBuffer( encryptedData.iv ) )

            const decryptedJson = await decryptData( encrypted, this.key, iv )
            return JSON.parse( decryptedJson )
        }
        catch {
            // If decryption fails, data might be corrupted or key is wrong
            return null
        }
    }

    /**
     * Remove encrypted data
     */
    removeItem(): void {
        localStorage.removeItem( this.storageKey )
    }

    /**
     * Clear all keys and data
     */
    clear(): void {
        localStorage.removeItem( this.storageKey )
        sessionStorage.removeItem( this.keyStorageKey )
        sessionStorage.removeItem( `${this.keyStorageKey}_salt` )
        this.key = null
    }

    /**
     * Check if storage is initialized
     */
    isInitialized(): boolean {
        return this.key !== null
    }
}

/**
 * Simple encryption utilities for basic use cases
 */
export const encryption = {
    /**
     * Encrypt a string with a password
     */
    async encryptWithPassword(
        data: string,
        password: string,
    ): Promise<EncryptedData> {
        const salt = generateSalt()
        const key = await deriveKeyFromPassword( password, salt )
        const {
            encrypted,
            iv
        } = await encryptData( data, key )

        return {
            data: arrayBufferToBase64( encrypted as ArrayBuffer ),
            iv: arrayBufferToBase64( iv.buffer as ArrayBuffer ),
            salt: arrayBufferToBase64( salt.buffer as ArrayBuffer ),
        }
    },

    /**
     * Decrypt a string with a password
     */
    async decryptWithPassword(
        encryptedData: EncryptedData,
        password: string,
    ): Promise<string> {
        const salt = new Uint8Array( base64ToArrayBuffer( encryptedData.salt ) )
        const key = await deriveKeyFromPassword( password, salt )
        const encrypted = base64ToArrayBuffer( encryptedData.data )
        const iv = new Uint8Array( base64ToArrayBuffer( encryptedData.iv ) )

        return await decryptData( encrypted, key, iv )
    },

    /**
     * Generate a secure random password
     */
    generateSecurePassword( length: number = 32 ): string {
        const charset
            = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*"
        const array = new Uint8Array( length )
        crypto.getRandomValues( array )

        return Array.from( array, byte => charset[ byte % charset.length ] ).join( "" )
    },

    /**
     * Hash data using SHA-256
     */
    async hash( data: string ): Promise<string> {
        const encoder = new TextEncoder()
        const dataBuffer = encoder.encode( data )
        const hashBuffer = await crypto.subtle.digest( "SHA-256", dataBuffer )
        return arrayBufferToBase64( hashBuffer as ArrayBuffer )
    },
}
