import {
    CacheSyncConfig,
    CacheAdapter,
    CacheError,
    Either,
    success,
    error,
    Logger
} from "../../types"

/**
 * Tab synchronization manager configuration
 */
export type TabSyncManagerConfig = CacheSyncConfig & {
    /** Cache adapter to synchronize */
    cache: CacheAdapter
    /** Logger for debugging */
    logger?: Logger
    /** Sync debounce delay in ms */
    debounceDelay?: number
    /** Maximum message size in bytes */
    maxMessageSize?: number
    /** Enable message compression */
    enableCompression?: boolean
}

/**
 * Sync message types
 */
enum SyncMessageType {
    SET = "set",
    DELETE = "delete",
    CLEAR = "clear",
    INVALIDATE = "invalidate",
    HEARTBEAT = "heartbeat",
    LEADER_ELECTION = "leader_election"
}

/**
 * Sync message structure
 */
type SyncMessage = {
    type: SyncMessageType
    payload: any
    timestamp: number
    tabId: string
    messageId: string
    isLeader?: boolean
}

/**
 * Pending operation for conflict resolution
 */
type PendingOperation = {
    key: string
    value: any
    timestamp: number
    source: "local" | "remote"
}

/**
 * Tab information for leader election
 */
type TabInfo = {
    id: string
    lastSeen: number
    isLeader: boolean
}

/**
 * Cross-tab cache synchronization manager
 */
export class TabSyncManager {
    private config: Required<Omit<TabSyncManagerConfig, "conflictResolver" | "logger">> & Pick<TabSyncManagerConfig, "conflictResolver" | "logger">
    private channel?: BroadcastChannel
    private tabId: string
    private isLeader = false
    private isActive = false
    private pendingOperations = new Map<string, PendingOperation>()
    private knownTabs = new Map<string, TabInfo>()
    private debounceTimers = new Map<string, NodeJS.Timeout>()
    private heartbeatInterval?: NodeJS.Timeout
    private leaderElectionTimeout?: NodeJS.Timeout

    constructor( config: TabSyncManagerConfig ) {
        this.config = {
            channel: "ra-ts-cache-sync",
            strategy: "broadcast",
            conflictResolution: "last-write-wins",
            debounceDelay: 100,
            maxMessageSize: 10240, // 10KB
            enableCompression: false,
            ...config
        }

        this.tabId = this.generateTabId()
        
        if ( this.config.enabled && typeof BroadcastChannel !== "undefined" ) {
            this.initialize()
        }
    }

    /**
     * Initialize synchronization
     */
    private initialize(): void {
        try {
            this.channel = new BroadcastChannel( this.config.channel )
            this.channel.addEventListener( "message", this.handleMessage.bind( this ) )
            
            this.isActive = true
            this.startHeartbeat()
            this.initiateLeaderElection()
            
            // Listen for page unload to cleanup
            if ( typeof window !== "undefined" ) {
                window.addEventListener( "beforeunload", this.cleanup.bind( this ) )
            }
            
            this.log( "info", "Tab sync manager initialized", { 
                tabId: this.tabId, 
                channel: this.config.channel 
            } )
        } catch ( err ) {
            this.log( "error", "Failed to initialize tab sync", { error: err } )
        }
    }

    /**
     * Synchronize cache set operation
     */
    async syncSet<T>( key: string, value: T, ttl?: number ): Promise<Either<CacheError, void>> {
        if ( !this.isActive ) {
            return success( undefined )
        }

        try {
            // Apply locally first
            const result = await this.config.cache.set( key, value, ttl )
            if ( result.error ) {
                return result
            }

            // Broadcast to other tabs
            await this.broadcastOperation( {
                type: SyncMessageType.SET,
                payload: { key, value, ttl },
                timestamp: Date.now(),
                tabId: this.tabId,
                messageId: this.generateMessageId()
            } )

            return success( undefined )
        } catch ( err ) {
            return error( new CacheError( "Sync set failed", { key, error: err } ) )
        }
    }

    /**
     * Synchronize cache delete operation
     */
    async syncDelete( key: string ): Promise<Either<CacheError, void>> {
        if ( !this.isActive ) {
            return success( undefined )
        }

        try {
            // Apply locally first
            const result = await this.config.cache.delete( key )
            if ( result.error ) {
                return result
            }

            // Broadcast to other tabs
            await this.broadcastOperation( {
                type: SyncMessageType.DELETE,
                payload: { key },
                timestamp: Date.now(),
                tabId: this.tabId,
                messageId: this.generateMessageId()
            } )

            return success( undefined )
        } catch ( err ) {
            return error( new CacheError( "Sync delete failed", { key, error: err } ) )
        }
    }

    /**
     * Synchronize cache clear operation
     */
    async syncClear(): Promise<Either<CacheError, void>> {
        if ( !this.isActive ) {
            return success( undefined )
        }

        try {
            // Apply locally first
            const result = await this.config.cache.clear()
            if ( result.error ) {
                return result
            }

            // Broadcast to other tabs
            await this.broadcastOperation( {
                type: SyncMessageType.CLEAR,
                payload: {},
                timestamp: Date.now(),
                tabId: this.tabId,
                messageId: this.generateMessageId()
            } )

            return success( undefined )
        } catch ( err ) {
            return error( new CacheError( "Sync clear failed", { error: err } ) )
        }
    }

    /**
     * Synchronize cache invalidate operation
     */
    async syncInvalidate( pattern: string ): Promise<Either<CacheError, void>> {
        if ( !this.isActive ) {
            return success( undefined )
        }

        try {
            // Apply locally first
            const result = await this.config.cache.invalidate( pattern )
            if ( result.error ) {
                return result
            }

            // Broadcast to other tabs
            await this.broadcastOperation( {
                type: SyncMessageType.INVALIDATE,
                payload: { pattern },
                timestamp: Date.now(),
                tabId: this.tabId,
                messageId: this.generateMessageId()
            } )

            return success( undefined )
        } catch ( err ) {
            return error( new CacheError( "Sync invalidate failed", { pattern, error: err } ) )
        }
    }

    /**
     * Handle incoming broadcast messages
     */
    private async handleMessage( event: MessageEvent ): Promise<void> {
        try {
            const message: SyncMessage = event.data
            
            // Ignore messages from this tab
            if ( message.tabId === this.tabId ) {
                return
            }

            this.log( "debug", "Received sync message", { 
                type: message.type, 
                from: message.tabId,
                messageId: message.messageId
            } )

            // Update known tabs
            this.updateTabInfo( message.tabId, message.isLeader )

            switch ( message.type ) {
            case SyncMessageType.SET:
                await this.handleSetMessage( message )
                break
            case SyncMessageType.DELETE:
                await this.handleDeleteMessage( message )
                break
            case SyncMessageType.CLEAR:
                await this.handleClearMessage( message )
                break
            case SyncMessageType.INVALIDATE:
                await this.handleInvalidateMessage( message )
                break
            case SyncMessageType.HEARTBEAT:
                // Just update tab info
                break
            case SyncMessageType.LEADER_ELECTION:
                await this.handleLeaderElection( message )
                break
            }
        } catch ( err ) {
            this.log( "error", "Error handling sync message", { error: err } )
        }
    }

    /**
     * Handle set operation from another tab
     */
    private async handleSetMessage( message: SyncMessage ): Promise<void> {
        const { key, value, ttl } = message.payload
        
        // Check for conflicts
        if ( this.hasConflict( key, message.timestamp ) ) {
            const resolved = await this.resolveConflict( key, value, message.timestamp, "remote" )
            if ( !resolved ) {
                return // Conflict resolution rejected the update
            }
        }

        // Apply the operation
        const result = await this.config.cache.set( key, value, ttl )
        if ( result.error ) {
            this.log( "warn", "Failed to apply remote set operation", { key, error: result.error } )
        }
    }

    /**
     * Handle delete operation from another tab
     */
    private async handleDeleteMessage( message: SyncMessage ): Promise<void> {
        const { key } = message.payload
        
        const result = await this.config.cache.delete( key )
        if ( result.error ) {
            this.log( "warn", "Failed to apply remote delete operation", { key, error: result.error } )
        }

        // Remove from pending operations
        this.pendingOperations.delete( key )
    }

    /**
     * Handle clear operation from another tab
     */
    private async handleClearMessage( _message: SyncMessage ): Promise<void> {
        const result = await this.config.cache.clear()
        if ( result.error ) {
            this.log( "warn", "Failed to apply remote clear operation", { error: result.error } )
        }

        // Clear all pending operations
        this.pendingOperations.clear()
    }

    /**
     * Handle invalidate operation from another tab
     */
    private async handleInvalidateMessage( _message: SyncMessage ): Promise<void> {
        const { pattern } = _message.payload
        
        const result = await this.config.cache.invalidate( pattern )
        if ( result.error ) {
            this.log( "warn", "Failed to apply remote invalidate operation", { pattern, error: result.error } )
        }

        // Remove matching pending operations
        const regex = new RegExp( pattern.replace( /\*/g, ".*" ) )
        for ( const [ key ] of this.pendingOperations ) {
            if ( regex.test( key ) ) {
                this.pendingOperations.delete( key )
            }
        }
    }

    /**
     * Handle leader election messages
     */
    private async handleLeaderElection( message: SyncMessage ): Promise<void> {
        const { isElection, candidateId } = message.payload
        
        if ( isElection ) {
            // Respond with our candidacy if we're eligible
            if ( this.tabId < candidateId ) {
                await this.broadcastOperation( {
                    type: SyncMessageType.LEADER_ELECTION,
                    payload: { isElection: true, candidateId: this.tabId },
                    timestamp: Date.now(),
                    tabId: this.tabId,
                    messageId: this.generateMessageId()
                } )
            }
        } else {
            // Someone declared leadership
            this.isLeader = message.tabId === this.tabId
            this.log( "info", "Leader elected", { 
                leaderId: message.tabId, 
                isLeader: this.isLeader 
            } )
        }
    }

    /**
     * Broadcast sync operation to other tabs
     */
    private async broadcastOperation( message: SyncMessage ): Promise<void> {
        if ( !this.channel || !this.isActive ) {
            return
        }

        try {
            // Check message size
            const serialized = JSON.stringify( message )
            if ( serialized.length > this.config.maxMessageSize ) {
                this.log( "warn", "Message too large for broadcast", { 
                    size: serialized.length, 
                    maxSize: this.config.maxMessageSize 
                } )
                return
            }

            // Add to pending operations for conflict resolution
            if ( message.type === SyncMessageType.SET ) {
                this.addPendingOperation( message.payload.key, message.payload.value, message.timestamp, "local" )
            }

            this.channel.postMessage( message )
            
            this.log( "debug", "Broadcasted sync message", { 
                type: message.type, 
                messageId: message.messageId 
            } )
        } catch ( err ) {
            this.log( "error", "Failed to broadcast sync message", { error: err } )
        }
    }

    /**
     * Check if there's a conflict for a key
     */
    private hasConflict( key: string, timestamp: number ): boolean {
        const pending = this.pendingOperations.get( key )
        return pending ? Math.abs( pending.timestamp - timestamp ) < this.config.debounceDelay : false
    }

    /**
     * Resolve conflict between local and remote operations
     */
    private async resolveConflict(
        key: string, 
        remoteValue: any, 
        remoteTimestamp: number, 
        _source: "local" | "remote"
    ): Promise<boolean> {
        const pending = this.pendingOperations.get( key )
        if ( !pending ) return true

        switch ( this.config.conflictResolution ) {
        case "last-write-wins":
            return remoteTimestamp > pending.timestamp
                
        case "merge":
            // Simple merge strategy - newer timestamp wins
            return remoteTimestamp > pending.timestamp
                
        case "custom":
            if ( this.config.conflictResolver ) {
                try {
                    const resolved = this.config.conflictResolver( pending.value, remoteValue )
                    // Update cache with resolved value
                    await this.config.cache.set( key, resolved )
                    return false // We handled the conflict
                } catch ( err ) {
                    this.log( "error", "Custom conflict resolution failed", { key, error: err } )
                    return remoteTimestamp > pending.timestamp // Fallback to timestamp
                }
            }
            return remoteTimestamp > pending.timestamp
                
        default:
            return true
        }
    }

    /**
     * Add pending operation for conflict detection
     */
    private addPendingOperation( key: string, value: any, timestamp: number, source: "local" | "remote" ): void {
        // Clear any existing debounce timer
        const existingTimer = this.debounceTimers.get( key )
        if ( existingTimer ) {
            clearTimeout( existingTimer )
        }

        // Add to pending operations
        this.pendingOperations.set( key, { key, value, timestamp, source } )

        // Set debounce timer to clean up
        const timer = setTimeout( () => {
            this.pendingOperations.delete( key )
            this.debounceTimers.delete( key )
        }, this.config.debounceDelay * 2 )

        this.debounceTimers.set( key, timer )
    }

    /**
     * Update tab information
     */
    private updateTabInfo( tabId: string, isLeader?: boolean ): void {
        this.knownTabs.set( tabId, {
            id: tabId,
            lastSeen: Date.now(),
            isLeader: isLeader || false
        } )
    }

    /**
     * Start heartbeat to maintain tab awareness
     */
    private startHeartbeat(): void {
        this.heartbeatInterval = setInterval( async () => {
            await this.broadcastOperation( {
                type: SyncMessageType.HEARTBEAT,
                payload: {},
                timestamp: Date.now(),
                tabId: this.tabId,
                messageId: this.generateMessageId(),
                isLeader: this.isLeader
            } )

            // Clean up stale tabs
            this.cleanupStaleTabs()
        }, 5000 ) // Every 5 seconds
    }

    /**
     * Initiate leader election
     */
    private initiateLeaderElection(): void {
        // Wait a bit to see if there's already a leader
        this.leaderElectionTimeout = setTimeout( async () => {
            if ( !this.hasActiveLeader() ) {
                await this.electLeader()
            }
        }, 1000 )
    }

    /**
     * Check if there's an active leader
     */
    private hasActiveLeader(): boolean {
        const now = Date.now()
        for ( const tab of this.knownTabs.values() ) {
            if ( tab.isLeader && ( now - tab.lastSeen ) < 10000 ) { // Leader seen within 10 seconds
                return true
            }
        }
        return false
    }

    /**
     * Elect leader among tabs
     */
    private async electLeader(): Promise<void> {
        // Simple election: lowest tab ID wins
        let lowestId = this.tabId
        
        for ( const tab of this.knownTabs.values() ) {
            if ( tab.id < lowestId ) {
                lowestId = tab.id
            }
        }

        if ( lowestId === this.tabId ) {
            this.isLeader = true
            await this.broadcastOperation( {
                type: SyncMessageType.LEADER_ELECTION,
                payload: { isElection: false, leaderId: this.tabId },
                timestamp: Date.now(),
                tabId: this.tabId,
                messageId: this.generateMessageId(),
                isLeader: true
            } )
            
            this.log( "info", "Elected as leader", { tabId: this.tabId } )
        }
    }

    /**
     * Clean up stale tabs
     */
    private cleanupStaleTabs(): void {
        const now = Date.now()
        const staleThreshold = 30000 // 30 seconds
        
        for ( const [ tabId, tab ] of this.knownTabs ) {
            if ( now - tab.lastSeen > staleThreshold ) {
                this.knownTabs.delete( tabId )
                
                // If the leader went stale, initiate new election
                if ( tab.isLeader ) {
                    this.initiateLeaderElection()
                }
            }
        }
    }

    /**
     * Generate unique tab ID
     */
    private generateTabId(): string {
        return `tab_${Date.now()}_${Math.random().toString( 36 ).substr( 2, 9 )}`
    }

    /**
     * Generate unique message ID
     */
    private generateMessageId(): string {
        return `msg_${Date.now()}_${Math.random().toString( 36 ).substr( 2, 9 )}`
    }

    /**
     * Log messages with optional logger
     */
    private log( level: "debug" | "info" | "warn" | "error", message: string, data?: any ): void {
        if ( this.config.logger ) {
            this.config.logger[ level ]( `[TabSyncManager] ${message}`, data )
        }
    }

    /**
     * Get synchronization status
     */
    getStatus() {
        return {
            isActive: this.isActive,
            isLeader: this.isLeader,
            tabId: this.tabId,
            knownTabs: Array.from( this.knownTabs.values() ),
            pendingOperations: this.pendingOperations.size
        }
    }

    /**
     * Cleanup resources
     */
    private cleanup(): void {
        this.isActive = false
        
        if ( this.heartbeatInterval ) {
            clearInterval( this.heartbeatInterval )
        }
        
        if ( this.leaderElectionTimeout ) {
            clearTimeout( this.leaderElectionTimeout )
        }
        
        for ( const timer of this.debounceTimers.values() ) {
            clearTimeout( timer )
        }
        
        if ( this.channel ) {
            this.channel.close()
        }
        
        this.pendingOperations.clear()
        this.knownTabs.clear()
        this.debounceTimers.clear()
    }

    /**
     * Destroy and cleanup
     */
    destroy(): void {
        this.cleanup()
    }
} 