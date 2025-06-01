import {
    IStreamAdapter,
    StreamError,
    StreamHandler,
    StreamMessage,
    StreamStats,
    WebSocketState,
    Either,
    success,
    error,
    ILogger
} from "../../types"

/**
 * Configuration for WebSocket adapter
 */
export type WebSocketAdapterConfig = {
    /** WebSocket server URL */
    url: string
    
    /** Protocols to use for WebSocket connection */
    protocols?: string | string[]
    
    /** Automatic reconnection settings */
    reconnection?: {
        enabled: boolean
        maxAttempts: number
        baseDelay: number
        maxDelay: number
        backoffFactor: number
    }
    
    /** Healthcheck configuration */
    healthcheck?: {
        enabled: boolean
        interval: number
        timeout: number
        pingMessage?: any
        pongMessage?: any
    }
    
    /** Connection timeout in milliseconds */
    connectionTimeout?: number
    
    /** Maximum message queue size for offline scenarios */
    maxQueueSize?: number
    
    /** Logger for debugging */
    logger?: ILogger
}

/**
 * Default configuration values
 */
const DEFAULT_CONFIG: Required<Omit<WebSocketAdapterConfig, "url" | "protocols" | "logger">> = {
    reconnection: {
        enabled: true,
        maxAttempts: 5,
        baseDelay: 1000,
        maxDelay: 30000,
        backoffFactor: 2
    },
    healthcheck: {
        enabled: true,
        interval: 30000,
        timeout: 5000,
        pingMessage: { type: "ping" },
        pongMessage: { type: "pong" }
    },
    connectionTimeout: 10000,
    maxQueueSize: 100
}

/**
 * WebSocket adapter implementation with advanced features
 */
export class WebSocketAdapter implements IStreamAdapter {
    private config: WebSocketAdapterConfig & Required<Omit<WebSocketAdapterConfig, "url" | "protocols" | "logger">>
    private ws: WebSocket | null = null
    private state: WebSocketState = WebSocketState.DISCONNECTED
    private subscriptions = new Map<string, Set<StreamHandler>>()
    private messageQueue: StreamMessage[] = []
    private reconnectAttempts = 0
    private healthcheckInterval: NodeJS.Timeout | null = null
    private healthcheckTimeout: NodeJS.Timeout | null = null
    private connectionTimeout: NodeJS.Timeout | null = null
    private stats: StreamStats = {
        connectionCount: 0,
        reconnectionCount: 0,
        messagesReceived: 0,
        messagesSent: 0,
        subscriptionCount: 0
    }

    constructor( config: WebSocketAdapterConfig ) {
        this.config = {
            ...DEFAULT_CONFIG,
            ...config,
            reconnection: { ...DEFAULT_CONFIG.reconnection, ...config.reconnection },
            healthcheck: { ...DEFAULT_CONFIG.healthcheck, ...config.healthcheck }
        }
    }

    /**
     * Establish WebSocket connection with timeout and error handling
     */
    async connect(): Promise<Either<StreamError, void>> {
        if ( this.state === WebSocketState.CONNECTED || this.state === WebSocketState.CONNECTING ) {
            return success( undefined )
        }

        this.state = WebSocketState.CONNECTING
        this.log( "debug", "Attempting to connect to WebSocket", { url: this.config.url } )

        try {
            const connectionPromise = new Promise<Either<StreamError, void>>( ( resolve ) => {
                this.ws = new WebSocket( this.config.url, this.config.protocols )

                // Connection timeout
                this.connectionTimeout = setTimeout( () => {
                    this.ws?.close()
                    resolve( error( new StreamError( "Connection timeout", { url: this.config.url } ) ) )
                }, this.config.connectionTimeout )

                this.ws.onopen = () => {
                    this.clearConnectionTimeout()
                    this.state = WebSocketState.CONNECTED
                    this.stats.connectionCount++
                    this.stats.lastConnectedAt = new Date()
                    this.reconnectAttempts = 0
                    
                    this.log( "info", "WebSocket connected successfully" )
                    this.startHealthcheck()
                    this.processQueuedMessages()
                    
                    resolve( success( undefined ) )
                }

                this.ws.onmessage = ( event ) => {
                    this.handleMessage( event )
                }

                this.ws.onclose = ( event ) => {
                    this.handleClose( event )
                }

                this.ws.onerror = ( event ) => {
                    this.handleError( event )
                    resolve( error( new StreamError( "WebSocket connection failed", { event } ) ) )
                }
            } )

            return await connectionPromise
        } catch ( err ) {
            this.state = WebSocketState.ERROR
            return error( new StreamError( "Failed to establish WebSocket connection", { error: err } ) )
        }
    }

    /**
     * Close WebSocket connection gracefully
     */
    async disconnect(): Promise<Either<StreamError, void>> {
        if ( this.state === WebSocketState.DISCONNECTED || this.state === WebSocketState.DISCONNECTING ) {
            return success( undefined )
        }

        this.state = WebSocketState.DISCONNECTING
        this.log( "debug", "Disconnecting WebSocket" )

        try {
            this.stopHealthcheck()
            this.clearConnectionTimeout()
            
            if ( this.ws ) {
                this.ws.close( 1000, "Normal closure" )
                this.ws = null
            }

            this.state = WebSocketState.DISCONNECTED
            this.stats.lastDisconnectedAt = new Date()
            
            this.log( "info", "WebSocket disconnected successfully" )
            return success( undefined )
        } catch ( err ) {
            return error( new StreamError( "Failed to disconnect WebSocket", { error: err } ) )
        }
    }

    /**
     * Subscribe to a channel with message handler
     */
    async subscribe( channel: string, handler: StreamHandler ): Promise<Either<StreamError, void>> {
        try {
            if ( !this.subscriptions.has( channel ) ) {
                this.subscriptions.set( channel, new Set() )
            }

            const handlers = this.subscriptions.get( channel )!
            handlers.add( handler )
            this.stats.subscriptionCount = this.getTotalSubscriptions()

            this.log( "debug", "Subscribed to channel", { channel, handlerCount: handlers.size } )
            return success( undefined )
        } catch ( err ) {
            return error( new StreamError( "Failed to subscribe to channel", { channel, error: err } ) )
        }
    }

    /**
     * Unsubscribe from a channel
     */
    async unsubscribe( channel: string, handler?: StreamHandler ): Promise<Either<StreamError, void>> {
        try {
            const handlers = this.subscriptions.get( channel )

            if ( !handlers ) {
                return success( undefined ) // Already unsubscribed
            }

            if ( handler ) {
                handlers.delete( handler )
                if ( handlers.size === 0 ) {
                    this.subscriptions.delete( channel )
                }
            } else {
                // Remove all handlers for this channel
                this.subscriptions.delete( channel )
            }

            this.stats.subscriptionCount = this.getTotalSubscriptions()
            this.log( "debug", "Unsubscribed from channel", { channel } )
            return success( undefined )
        } catch ( err ) {
            return error( new StreamError( "Failed to unsubscribe from channel", { channel, error: err } ) )
        }
    }

    /**
     * Send message through WebSocket
     */
    async sendMessage( message: StreamMessage ): Promise<Either<StreamError, void>> {
        try {
            if ( this.state !== WebSocketState.CONNECTED || !this.ws ) {
                // Queue message for later delivery
                if ( this.messageQueue.length < this.config.maxQueueSize ) {
                    this.messageQueue.push( message )
                    this.log( "debug", "Message queued for delivery", { messageId: message.messageId } )
                    return success( undefined )
                } else {
                    return error( new StreamError( "Message queue full and WebSocket not connected" ) )
                }
            }

            const serialized = JSON.stringify( message )
            this.ws.send( serialized )
            this.stats.messagesSent++

            this.log( "debug", "Message sent", { messageId: message.messageId, channel: message.channel } )
            return success( undefined )
        } catch ( err ) {
            return error( new StreamError( "Failed to send message", { message, error: err } ) )
        }
    }

    /**
     * Get current connection state
     */
    getState(): WebSocketState {
        return this.state
    }

    /**
     * Get connection and usage statistics
     */
    getStats(): StreamStats {
        return { ...this.stats }
    }

    /**
     * Handle incoming WebSocket messages
     */
    private handleMessage( event: MessageEvent ): void {
        try {
            this.stats.messagesReceived++
            
            // Handle healthcheck pong messages
            if ( this.isHealthcheckMessage( event.data ) ) {
                this.handleHealthcheckResponse()
                return
            }

            const message: StreamMessage = JSON.parse( event.data )
            
            // Add timestamp if not present
            if ( !message.timestamp ) {
                message.timestamp = new Date()
            }

            this.log( "debug", "Message received", { channel: message.channel, type: message.type } )
            this.deliverMessage( message )
        } catch ( err ) {
            this.log( "error", "Failed to handle incoming message", { error: err, data: event.data } )
        }
    }

    /**
     * Handle WebSocket close events
     */
    private handleClose( event: CloseEvent ): void {
        this.state = WebSocketState.DISCONNECTED
        this.stats.lastDisconnectedAt = new Date()
        this.stopHealthcheck()

        this.log( "info", "WebSocket closed", { code: event.code, reason: event.reason } )

        // Attempt reconnection if enabled and not a normal closure
        if ( this.config.reconnection.enabled && event.code !== 1000 ) {
            this.attemptReconnection()
        }
    }

    /**
     * Handle WebSocket error events
     */
    private handleError( event: Event ): void {
        this.state = WebSocketState.ERROR
        this.log( "error", "WebSocket error occurred", { event } )
    }

    /**
     * Attempt automatic reconnection with exponential backoff
     */
    private attemptReconnection(): void {
        if ( this.reconnectAttempts >= this.config.reconnection.maxAttempts ) {
            this.log( "error", "Maximum reconnection attempts reached", { attempts: this.reconnectAttempts } )
            return
        }

        this.reconnectAttempts++
        this.stats.reconnectionCount++

        const delay = Math.min(
            this.config.reconnection.baseDelay * Math.pow( this.config.reconnection.backoffFactor, this.reconnectAttempts - 1 ),
            this.config.reconnection.maxDelay
        )

        this.log( "info", "Attempting reconnection", { attempt: this.reconnectAttempts, delay } )

        setTimeout( () => {
            this.connect()
        }, delay )
    }

    /**
     * Start healthcheck mechanism
     */
    private startHealthcheck(): void {
        if ( !this.config.healthcheck.enabled ) return

        this.healthcheckInterval = setInterval( () => {
            if ( this.state === WebSocketState.CONNECTED && this.ws ) {
                try {
                    const pingMessage = JSON.stringify( this.config.healthcheck.pingMessage )
                    this.ws.send( pingMessage )

                    // Set timeout for pong response
                    this.healthcheckTimeout = setTimeout( () => {
                        this.log( "warn", "Healthcheck timeout - closing connection" )
                        this.ws?.close()
                    }, this.config.healthcheck.timeout )
                } catch ( err ) {
                    this.log( "error", "Failed to send healthcheck", { error: err } )
                }
            }
        }, this.config.healthcheck.interval )
    }

    /**
     * Stop healthcheck mechanism
     */
    private stopHealthcheck(): void {
        if ( this.healthcheckInterval ) {
            clearInterval( this.healthcheckInterval )
            this.healthcheckInterval = null
        }
        if ( this.healthcheckTimeout ) {
            clearTimeout( this.healthcheckTimeout )
            this.healthcheckTimeout = null
        }
    }

    /**
     * Handle healthcheck response
     */
    private handleHealthcheckResponse(): void {
        if ( this.healthcheckTimeout ) {
            clearTimeout( this.healthcheckTimeout )
            this.healthcheckTimeout = null
        }
    }

    /**
     * Check if message is a healthcheck response
     */
    private isHealthcheckMessage( data: any ): boolean {
        try {
            const parsed = JSON.parse( data )
            return parsed.type === this.config.healthcheck.pongMessage?.type
        } catch {
            return false
        }
    }

    /**
     * Clear connection timeout
     */
    private clearConnectionTimeout(): void {
        if ( this.connectionTimeout ) {
            clearTimeout( this.connectionTimeout )
            this.connectionTimeout = null
        }
    }

    /**
     * Deliver message to subscribed handlers
     */
    private async deliverMessage( message: StreamMessage ): Promise<void> {
        const handlers = this.subscriptions.get( message.channel )
        
        if ( !handlers || handlers.size === 0 ) {
            this.log( "debug", "No handlers for channel", { channel: message.channel } )
            return
        }

        // Execute all handlers concurrently
        const promises = Array.from( handlers ).map( async ( handler ) => {
            try {
                await handler( message )
            } catch ( err ) {
                this.log( "error", "Handler error", { channel: message.channel, error: err } )
            }
        } )

        await Promise.all( promises )
    }

    /**
     * Process queued messages after reconnection
     */
    private async processQueuedMessages(): Promise<void> {
        if ( this.messageQueue.length === 0 ) return

        this.log( "info", "Processing queued messages", { count: this.messageQueue.length } )

        const messages = [ ...this.messageQueue ]
        this.messageQueue = []

        for ( const message of messages ) {
            const result = await this.sendMessage( message )
            if ( result.error ) {
                this.log( "error", "Failed to send queued message", { 
                    messageId: message.messageId, 
                    error: result.error 
                } )
            }
        }
    }

    /**
     * Get total number of active subscriptions
     */
    private getTotalSubscriptions(): number {
        return Array.from( this.subscriptions.values() )
            .reduce( ( total, handlers ) => total + handlers.size, 0 )
    }

    /**
     * Log messages with optional logger
     */
    private log( level: "debug" | "info" | "warn" | "error", message: string, data?: any ): void {
        if ( this.config.logger ) {
            this.config.logger[ level ]( message, data )
        }
    }
} 