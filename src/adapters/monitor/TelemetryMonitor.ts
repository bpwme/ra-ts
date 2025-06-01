import {
    Monitor,
    Logger
} from "../../types"

/**
 * Telemetry export callback function
 */
export type TelemetryExportCallback = ( data: {
    type: "span" | "metric"
    timestamp: string
    service: string
    version: string
    data: TraceSpan | MetricData
} ) => void

/**
 * Configuration for TelemetryMonitor
 */
export type TelemetryConfig = {
    /** Enable tracing */
    tracing: boolean
    /** Enable metrics */
    metrics: boolean
    /** Enable logs */
    logs: boolean
    /** Service name for telemetry */
    serviceName: string
    /** Service version */
    serviceVersion: string
    /** Sampling rate for traces (0-1) */
    sampleRate: number
    /** Callback function to handle exported telemetry data */
    onExport?: TelemetryExportCallback
    /** Custom attributes to add to all spans */
    attributes?: Record<string, any>
    /** Logger for debugging */
    logger?: Logger
}

/**
 * Trace span representation
 */
export type TraceSpan = {
    name: string
    spanId: string
    traceId: string
    parentSpanId?: string
    attributes: Record<string, any>
    startTime: number
    endTime?: number
    status: "ok" | "error"
    error?: Error
    events: Array<{
        name: string
        timestamp: number
        attributes?: Record<string, any>
    }>
}

/**
 * Metrics data
 */
export type MetricData = {
    name: string
    value: number
    type: "counter" | "histogram" | "gauge"
    attributes?: Record<string, any>
    timestamp: number
}

/**
 * Health check result
 */
export type HealthCheckResult = {
    status: "healthy" | "unhealthy" | "degraded"
    checks: Record<string, {
        status: "pass" | "fail" | "warn"
        message?: string
        duration?: number
        details?: any
    }>
    timestamp: Date
    version: string
}

/**
 * OpenTelemetry-compatible monitor with distributed tracing
 */
export class TelemetryMonitor implements Monitor {
    private config: TelemetryConfig
    private spans = new Map<string, TraceSpan>()
    private metrics: MetricData[] = []
    private activeSpan?: TraceSpan
    private spanCounter = 0
    private traceCounter = 0
    private healthChecks = new Map<string, () => Promise<{ status: "pass" | "fail" | "warn", message?: string, details?: any }>>()

    constructor( config: TelemetryConfig ) {
        this.config = {
            ...config,
            tracing: config.tracing ?? true,
            metrics: config.metrics ?? true,
            logs: config.logs ?? true,
            sampleRate: config.sampleRate ?? 1.0
        }

        this.initializeTelemetry()
    }

    /**
     * Track an event with optional data
     */
    track( event: string, data?: any ): void {
        if ( this.config.tracing && this.activeSpan ) {
            this.activeSpan.events.push( {
                name: event,
                timestamp: Date.now(),
                attributes: data
            } )
        }

        if ( this.config.metrics ) {
            this.recordMetric( `datamanager.events.${event}`, 1, data )
        }

        this.log( "debug", `Event tracked: ${event}`, data )
    }

    /**
     * Start a timer, returns function to stop and record duration
     */
    startTimer( name: string ): () => void {
        const startTime = Date.now()
        
        if ( this.config.tracing ) {
            const span = this.createSpan( name )
            this.setActiveSpan( span )
        }

        return () => {
            const duration = Date.now() - startTime
            
            if ( this.config.tracing && this.activeSpan ) {
                this.finishSpan( this.activeSpan, { duration } )
            }

            if ( this.config.metrics ) {
                this.recordMetric( `datamanager.duration.${name}`, duration )
            }

            this.log( "debug", `Timer completed: ${name}`, { duration } )
        }
    }

    /**
     * Record a metric value
     */
    recordMetric( name: string, value: number, attributes?: Record<string, any> ): void {
        if ( !this.config.metrics ) return

        const metric: MetricData = {
            name,
            value,
            type: "histogram",
            attributes: {
                ...this.config.attributes,
                ...attributes
            },
            timestamp: Date.now()
        }

        this.metrics.push( metric )
        this.exportMetric( metric )

        // Keep only recent metrics - trim to 500 when we exceed 1000
        if ( this.metrics.length > 1000 ) {
            this.metrics = this.metrics.slice( -500 )
        }
    }

    /**
     * Create a new trace span
     */
    createSpan( name: string, parentSpan?: TraceSpan ): TraceSpan {
        const span: TraceSpan = {
            name,
            spanId: this.generateSpanId(),
            traceId: parentSpan?.traceId || this.generateTraceId(),
            parentSpanId: parentSpan?.spanId,
            attributes: { ...this.config.attributes },
            startTime: Date.now(),
            status: "ok",
            events: []
        }

        this.spans.set( span.spanId, span )
        return span
    }

    /**
     * Set the active span for context
     */
    setActiveSpan( span?: TraceSpan ): void {
        this.activeSpan = span
    }

    /**
     * Get the current active span
     */
    getActiveSpan(): TraceSpan | undefined {
        return this.activeSpan
    }

    /**
     * Add attributes to a span
     */
    addSpanAttributes( spanId: string, attributes: Record<string, any> ): void {
        const span = this.spans.get( spanId )
        if ( span ) {
            Object.assign( span.attributes, attributes )
        }
    }

    /**
     * Add an event to a span
     */
    addSpanEvent( spanId: string, event: string, attributes?: Record<string, any> ): void {
        const span = this.spans.get( spanId )
        if ( span ) {
            span.events.push( {
                name: event,
                timestamp: Date.now(),
                attributes
            } )
        }
    }

    /**
     * Finish a span and export it
     */
    finishSpan( span: TraceSpan, attributes?: Record<string, any> ): void {
        span.endTime = Date.now()
        
        if ( attributes ) {
            Object.assign( span.attributes, attributes )
        }

        this.exportSpan( span )
        
        // Clear active span if this was it
        if ( this.activeSpan?.spanId === span.spanId ) {
            this.activeSpan = undefined
        }
    }

    /**
     * Record an error in the current span
     */
    recordError( error: Error, attributes?: Record<string, any> ): void {
        if ( this.activeSpan ) {
            this.activeSpan.status = "error"
            this.activeSpan.error = error
            this.addSpanEvent( this.activeSpan.spanId, "error", {
                "error.message": error.message,
                "error.name": error.name,
                "error.stack": error.stack,
                ...attributes
            } )
        }
    }

    /**
     * Register a health check
     */
    registerHealthCheck(
        name: string, 
        check: () => Promise<{ status: "pass" | "fail" | "warn", message?: string, details?: any }>
    ): void {
        this.healthChecks.set( name, check )
    }

    /**
     * Execute all health checks
     */
    async executeHealthChecks(): Promise<HealthCheckResult> {
        const result: HealthCheckResult = {
            status: "healthy",
            checks: {},
            timestamp: new Date(),
            version: this.config.serviceVersion
        }

        let hasFailures = false
        let hasWarnings = false

        for ( const [ name, check ] of this.healthChecks ) {
            try {
                const startTime = Date.now()
                const checkResult = await check()
                const duration = Date.now() - startTime

                result.checks[ name ] = {
                    ...checkResult,
                    duration
                }

                if ( checkResult.status === "fail" ) {
                    hasFailures = true
                } else if ( checkResult.status === "warn" ) {
                    hasWarnings = true
                }
            } catch ( error ) {
                result.checks[ name ] = {
                    status: "fail",
                    message: error instanceof Error ? error.message : "Health check failed",
                    details: error
                }
                hasFailures = true
            }
        }

        if ( hasFailures ) {
            result.status = "unhealthy"
        } else if ( hasWarnings ) {
            result.status = "degraded"
        }

        return result
    }

    /**
     * Get telemetry statistics
     */
    getStats() {
        return {
            spans: {
                total: this.spans.size,
                active: this.activeSpan ? 1 : 0
            },
            metrics: {
                total: this.metrics.length,
                recent: this.metrics.filter( m => Date.now() - m.timestamp < 60000 ).length
            },
            healthChecks: {
                registered: this.healthChecks.size
            },
            config: {
                tracing: this.config.tracing,
                metrics: this.config.metrics,
                logs: this.config.logs,
                sampleRate: this.config.sampleRate,
                hasExportCallback: !!this.config.onExport
            }
        }
    }

    /**
     * Start a traced operation
     */
    async withTrace<T>(
        name: string, 
        operation: ( span: TraceSpan ) => Promise<T>,
        attributes?: Record<string, any>
    ): Promise<T> {
        const span = this.createSpan( name, this.activeSpan )
        
        if ( attributes ) {
            Object.assign( span.attributes, attributes )
        }

        const previousSpan = this.activeSpan
        this.setActiveSpan( span )

        try {
            const result = await operation( span )
            this.finishSpan( span )
            return result
        } catch ( error ) {
            if ( error instanceof Error ) {
                this.recordError( error )
            }
            this.finishSpan( span, { error: true } )
            throw error
        } finally {
            this.setActiveSpan( previousSpan )
        }
    }

    /**
     * Initialize telemetry based on configuration
     */
    private initializeTelemetry(): void {
        this.log( "info", "Initializing telemetry", {
            serviceName: this.config.serviceName,
            serviceVersion: this.config.serviceVersion,
            hasExportCallback: !!this.config.onExport
        } )

        // Register default health checks
        this.registerHealthCheck( "telemetry", async () => ( {
            status: "pass" as const,
            message: "Telemetry monitor is operational",
            details: this.getStats()
        } ) )
    }

    /**
     * Export a span to the configured callback
     */
    private exportSpan( span: TraceSpan ): void {
        if ( this.config.onExport ) {
            this.config.onExport( {
                type: "span",
                timestamp: new Date().toISOString(),
                service: this.config.serviceName,
                version: this.config.serviceVersion,
                data: span
            } )
        }
    }

    /**
     * Export a metric to the configured callback
     */
    private exportMetric( metric: MetricData ): void {
        if ( this.config.onExport ) {
            this.config.onExport( {
                type: "metric",
                timestamp: new Date().toISOString(),
                service: this.config.serviceName,
                version: this.config.serviceVersion,
                data: metric
            } )
        }
    }

    /**
     * Generate unique span ID
     */
    private generateSpanId(): string {
        return `span_${Date.now()}_${++this.spanCounter}_${Math.random().toString( 36 ).substr( 2, 9 )}`
    }

    /**
     * Generate unique trace ID
     */
    private generateTraceId(): string {
        return `trace_${Date.now()}_${++this.traceCounter}_${Math.random().toString( 36 ).substr( 2, 9 )}`
    }

    /**
     * Log messages with optional logger
     */
    private log( level: "debug" | "info" | "warn" | "error", message: string, data?: any ): void {
        if ( this.config.logger ) {
            this.config.logger[ level ]( `[TelemetryMonitor] ${message}`, data )
        }
    }

    /**
     * Cleanup resources
     */
    destroy(): void {
        this.spans.clear()
        this.metrics = []
        this.healthChecks.clear()
        this.activeSpan = undefined
    }
}