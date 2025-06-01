/**
 * Base error class for DataManager operations
 */
export class DataManagerError extends Error {
    constructor(
        message: string,
        public readonly code: string,
        public readonly context?: any
    ) {
        super( message )
        this.name = "DataManagerError"
    }
}

/**
 * Error thrown when validation fails
 */
export class ValidationError extends DataManagerError {
    constructor( message: string, context?: any ) {
        super( message, "VALIDATION_ERROR", context )
        this.name = "ValidationError"
    }
}

/**
 * Error thrown when network operations fail
 */
export class NetworkError extends DataManagerError {
    constructor( message: string, context?: any ) {
        super( message, "NETWORK_ERROR", context )
        this.name = "NetworkError"
    }
}

/**
 * Error thrown when cache operations fail
 */
export class CacheError extends DataManagerError {
    constructor( message: string, context?: any ) {
        super( message, "CACHE_ERROR", context )
        this.name = "CacheError"
    }
}

/**
 * Error thrown when rate limiting is exceeded
 */
export class RateLimitError extends DataManagerError {
    constructor( message: string, context?: any ) {
        super( message, "RATE_LIMIT_ERROR", context )
        this.name = "RateLimitError"
    }
}

/**
 * Error thrown when queue operations fail
 */
export class QueueError extends DataManagerError {
    constructor( message: string, context?: any ) {
        super( message, "QUEUE_ERROR", context )
        this.name = "QueueError"
    }
}

/**
 * Error thrown when WebSocket/stream operations fail
 */
export class StreamError extends DataManagerError {
    constructor( message: string, context?: any ) {
        super( message, "STREAM_ERROR", context )
        this.name = "StreamError"
    }
}

/**
 * Error thrown when batch operations fail
 */
export class BatchError extends DataManagerError {
    constructor( message: string, context?: any ) {
        super( message, "BATCH_ERROR", context )
        this.name = "BatchError"
    }
} 