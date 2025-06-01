import type { ILogger } from "../../types/index.js"

/* eslint-disable @typescript-eslint/no-unused-vars */

/**
 * Default logger that does nothing - for production use
 */
export class NoOpLogger implements ILogger {
    debug( message: string, data?: any ): void {
    // No-op
    }

    info( message: string, data?: any ): void {
    // No-op
    }

    warn( message: string, data?: any ): void {
    // No-op
    }

    error( message: string, data?: any ): void {
    // No-op
    }
}

/**
 * Console logger for development
 */
export class ConsoleLogger implements ILogger {
    debug( message: string, data?: any ): void {
        console.debug( `[DataManager] ${message}`, data || "" )
    }

    info( message: string, data?: any ): void {
        console.info( `[DataManager] ${message}`, data || "" )
    }

    warn( message: string, data?: any ): void {
        console.warn( `[DataManager] ${message}`, data || "" )
    }

    error( message: string, data?: any ): void {
        console.error( `[DataManager] ${message}`, data || "" )
    }
}
