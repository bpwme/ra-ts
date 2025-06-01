import type { Validator, Either } from "../../types"
import { success, error, ValidationError } from "../../types"

// Import your sanitization utilities (peer dependencies)
let sanitizeParams: any
let sanitizeString: any
let isSafeValue: any
let hasPrototypePollution: any

try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sanitizationModule = require( "../../utils/sanitization" )
    sanitizeParams = sanitizationModule.sanitizeParams
    sanitizeString = sanitizationModule.sanitizeString
    isSafeValue = sanitizationModule.isSafeValue
    hasPrototypePollution = sanitizationModule.hasPrototypePollution
} catch {
    // Sanitization utilities not available
}

/**
 * Configuration for security validation
 */
export type SecurityValidatorConfig = {
  /** Whether to enable data sanitization */
  enableSanitization?: boolean
  /** Whether to check for prototype pollution */
  checkPrototypePollution?: boolean
  /** Whether to validate safe values */
  validateSafeValues?: boolean
  /** Sanitization options */
  sanitizationOptions?: {
    allowHtml?: boolean
    maxLength?: number
    preserveWhitespace?: boolean
  }
  /** Whether to fail validation on security issues or just log warnings */
  strictMode?: boolean
}

/**
 * Security validator that sanitizes data and checks for security issues
 */
export class SecurityValidator implements Validator {
    private readonly config: Required<SecurityValidatorConfig>
    private readonly hasSanitization: boolean

    constructor( config: SecurityValidatorConfig = {} ) {
        this.config = {
            enableSanitization: config.enableSanitization ?? true,
            checkPrototypePollution: config.checkPrototypePollution ?? true,
            validateSafeValues: config.validateSafeValues ?? true,
            sanitizationOptions: {
                allowHtml: false,
                maxLength: 10000,
                preserveWhitespace: false,
                ...config.sanitizationOptions
            },
            strictMode: config.strictMode ?? false
        }

        this.hasSanitization = !!( sanitizeParams && sanitizeString && isSafeValue )

        if ( this.config.enableSanitization && !this.hasSanitization ) {
            console.warn( "SecurityValidator: Sanitization utilities not available. Install isomorphic-dompurify and validator for full security features." )
        }
    }
    parse( _data: unknown ): Either<ValidationError, any> {
        throw new Error( "Method not implemented." )
    }
    safeParse( _data: unknown ): Either<ValidationError, any> {
        throw new Error( "Method not implemented." )
    }

    /**
   * Validate and sanitize data
   */
    async validate<T>( data: T ): Promise<Either<ValidationError, T>> {
        try {
            // Check for prototype pollution first
            if ( this.config.checkPrototypePollution && hasPrototypePollution ) {
                if ( hasPrototypePollution( data ) ) {
                    const pollutionError = new ValidationError(
                        "Prototype pollution attempt detected",
                        { data: "[REDACTED_FOR_SECURITY]" }
                    )
          
                    if ( this.config.strictMode ) {
                        return error( pollutionError )
                    } else {
                        console.warn( "SecurityValidator: Prototype pollution detected but not in strict mode" )
                    }
                }
            }

            // Check if values are safe
            if ( this.config.validateSafeValues && isSafeValue ) {
                if ( !isSafeValue( data ) ) {
                    const safetyError = new ValidationError(
                        "Unsafe data patterns detected",
                        { data: typeof data === "object" ? "[OBJECT_REDACTED]" : String( data ).substring( 0, 100 ) }
                    )
          
                    if ( this.config.strictMode ) {
                        return error( safetyError )
                    } else {
                        console.warn( "SecurityValidator: Unsafe patterns detected but not in strict mode" )
                    }
                }
            }

            // Sanitize data if enabled and available
            if ( this.config.enableSanitization && this.hasSanitization ) {
                const sanitizedData = sanitizeParams( data, this.config.sanitizationOptions )
                return success( sanitizedData as T )
            }

            return success( data )
        } catch ( err ) {
            return error( new ValidationError(
                `Security validation failed: ${err instanceof Error ? err.message : "Unknown error"}`,
                { error: err }
            ) )
        }
    }

    /**
   * Check if sanitization is available
   */
    isSanitizationAvailable(): boolean {
        return this.hasSanitization
    }

    /**
   * Get validator configuration
   */
    getConfig(): Required<SecurityValidatorConfig> {
        return { ...this.config }
    }
}