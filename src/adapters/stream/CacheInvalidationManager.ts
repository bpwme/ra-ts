import {
    IStreamAdapter,
    StreamMessage,
    StreamHandler,
    ICacheAdapter,
    Either,
    success,
    error,
    StreamError,
    ILogger
} from "../../types"

/**
 * Configuration for cache invalidation rules
 */
export type InvalidationRule = {
    /** Channel pattern to listen for invalidation messages */
    channel: string
    /** Message type that triggers invalidation */
    messageType: string
    /** Function to extract cache patterns from message data */
    extractPatterns: ( data: any ) => string[]
    /** Optional condition to check before invalidation */
    condition?: ( data: any ) => boolean
}

/**
 * Configuration for cache invalidation manager
 */
export type CacheInvalidationConfig = {
    /** Stream adapter for receiving invalidation messages */
    streamAdapter: IStreamAdapter
    /** Cache adapter to invalidate */
    cacheAdapter: ICacheAdapter
    /** Invalidation rules */
    rules: InvalidationRule[]
    /** Logger for debugging */
    logger?: ILogger
}

/**
 * Manages real-time cache invalidation through WebSocket messages
 */
export class CacheInvalidationManager {
    private config: CacheInvalidationConfig
    private isActive = false
    private handlers = new Map<string, StreamHandler>()

    constructor( config: CacheInvalidationConfig ) {
        this.config = config
    }

    /**
     * Start listening for invalidation messages
     */
    async start(): Promise<Either<StreamError, void>> {
        if ( this.isActive ) {
            return success( undefined )
        }

        this.log( "info", "Starting cache invalidation manager", { ruleCount: this.config.rules.length } )

        try {
            // Subscribe to channels for each rule
            for ( const rule of this.config.rules ) {
                const handler = this.createHandler( rule )
                this.handlers.set( rule.channel, handler )

                const subscribeResult = await this.config.streamAdapter.subscribe( rule.channel, handler )
                if ( subscribeResult.error ) {
                    this.log( "error", "Failed to subscribe to invalidation channel", {
                        channel: rule.channel,
                        error: subscribeResult.error
                    } )
                    return subscribeResult
                }

                this.log( "debug", "Subscribed to invalidation channel", { channel: rule.channel } )
            }

            this.isActive = true
            return success( undefined )
        } catch ( err ) {
            return error( new StreamError( "Failed to start cache invalidation manager", { error: err } ) )
        }
    }

    /**
     * Stop listening for invalidation messages
     */
    async stop(): Promise<Either<StreamError, void>> {
        if ( !this.isActive ) {
            return success( undefined )
        }

        this.log( "info", "Stopping cache invalidation manager" )

        try {
            // Unsubscribe from all channels
            for ( const [ channel, handler ] of this.handlers ) {
                const unsubscribeResult = await this.config.streamAdapter.unsubscribe( channel, handler )
                if ( unsubscribeResult.error ) {
                    this.log( "error", "Failed to unsubscribe from invalidation channel", {
                        channel,
                        error: unsubscribeResult.error
                    } )
                }
            }

            this.handlers.clear()
            this.isActive = false
            return success( undefined )
        } catch ( err ) {
            return error( new StreamError( "Failed to stop cache invalidation manager", { error: err } ) )
        }
    }

    /**
     * Add a new invalidation rule
     */
    async addRule( rule: InvalidationRule ): Promise<Either<StreamError, void>> {
        this.config.rules.push( rule )

        if ( this.isActive ) {
            const handler = this.createHandler( rule )
            this.handlers.set( rule.channel, handler )

            const subscribeResult = await this.config.streamAdapter.subscribe( rule.channel, handler )
            if ( subscribeResult.error ) {
                // Remove the rule if subscription fails
                this.config.rules = this.config.rules.filter( r => r !== rule )
                return subscribeResult
            }

            this.log( "debug", "Added invalidation rule", { channel: rule.channel } )
        }

        return success( undefined )
    }

    /**
     * Remove an invalidation rule
     */
    async removeRule( channel: string ): Promise<Either<StreamError, void>> {
        const handler = this.handlers.get( channel )
        
        if ( handler && this.isActive ) {
            const unsubscribeResult = await this.config.streamAdapter.unsubscribe( channel, handler )
            if ( unsubscribeResult.error ) {
                return unsubscribeResult
            }
        }

        this.handlers.delete( channel )
        this.config.rules = this.config.rules.filter( rule => rule.channel !== channel )

        this.log( "debug", "Removed invalidation rule", { channel } )
        return success( undefined )
    }

    /**
     * Get current status and statistics
     */
    getStatus() {
        return {
            isActive: this.isActive,
            ruleCount: this.config.rules.length,
            subscribedChannels: Array.from( this.handlers.keys() )
        }
    }

    /**
     * Create a handler for an invalidation rule
     */
    private createHandler( rule: InvalidationRule ): StreamHandler {
        return async ( message: StreamMessage ) => {
            try {
                // Check if message type matches
                if ( message.type !== rule.messageType ) {
                    return
                }

                // Check optional condition
                if ( rule.condition && !rule.condition( message.data ) ) {
                    this.log( "debug", "Invalidation condition not met", {
                        channel: rule.channel,
                        messageType: message.type
                    } )
                    return
                }

                // Extract cache patterns to invalidate
                const patterns = rule.extractPatterns( message.data )
                
                if ( patterns.length === 0 ) {
                    this.log( "debug", "No cache patterns extracted from message", {
                        channel: rule.channel,
                        messageData: message.data
                    } )
                    return
                }

                this.log( "info", "Processing cache invalidation", {
                    channel: rule.channel,
                    patterns,
                    messageId: message.messageId
                } )

                // Invalidate cache for each pattern
                const invalidationResults = await Promise.allSettled(
                    patterns.map( pattern => this.config.cacheAdapter.invalidate( pattern ) )
                )

                // Log any failures
                invalidationResults.forEach( ( result, index ) => {
                    if ( result.status === "rejected" ) {
                        this.log( "error", "Cache invalidation failed", {
                            pattern: patterns[ index ],
                            error: result.reason
                        } )
                    } else if ( result.value.error ) {
                        this.log( "error", "Cache invalidation error", {
                            pattern: patterns[ index ],
                            error: result.value.error
                        } )
                    } else {
                        this.log( "debug", "Cache invalidated successfully", {
                            pattern: patterns[ index ]
                        } )
                    }
                } )

            } catch ( err ) {
                this.log( "error", "Error processing invalidation message", {
                    channel: rule.channel,
                    error: err,
                    message
                } )
            }
        }
    }

    /**
     * Log messages with optional logger
     */
    private log( level: "debug" | "info" | "warn" | "error", message: string, data?: any ): void {
        if ( this.config.logger ) {
            this.config.logger[ level ]( `[CacheInvalidation] ${message}`, data )
        }
    }
} 