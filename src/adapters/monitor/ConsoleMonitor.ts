import type { IMonitor } from "../../types"

/**
 * Configuration for console monitor
 */
export type ConsoleMonitorConfig = {
  /** Whether to enable detailed logging */
  verbose?: boolean
  /** Minimum log level */
  logLevel?: "debug" | "info" | "warn" | "error"
  /** Whether to track performance metrics */
  trackPerformance?: boolean
  /** Whether to aggregate metrics */
  aggregateMetrics?: boolean
}

/**
 * Performance timer interface
 */
type PerformanceTimer = () => void

/**
 * Metric entry for tracking
 */
type MetricEntry = {
  name: string
  value: number
  metadata?: Record<string, any>
  timestamp: number
}

/**
 * Console-based monitor for development and debugging
 */
export class ConsoleMonitor implements IMonitor {
    private metrics: MetricEntry[] = []
    private timers = new Map<string, number>()
    private readonly config: Required<ConsoleMonitorConfig>

    constructor( config: ConsoleMonitorConfig = {} ) {
        this.config = {
            verbose: config.verbose ?? true,
            logLevel: config.logLevel ?? "debug",
            trackPerformance: config.trackPerformance ?? true,
            aggregateMetrics: config.aggregateMetrics ?? true
        }
    }
    recordMetric( _name: string, _value: number ): void {
        throw new Error( "Method not implemented." )
    }

    /**
   * Start a performance timer
   */
    startTimer( name: string ): PerformanceTimer {
        const startTime = performance.now()
        const timerId = `${name}_${Date.now()}_${Math.random()}`
    
        this.timers.set( timerId, startTime )

        return () => {
            const endTime = performance.now()
            const duration = endTime - startTime
      
            this.timers.delete( timerId )
            this.track( `${name}.duration`, duration, { unit: "ms" } )
      
            if ( this.shouldLog( "debug" ) ) {
                console.debug( `⏱️  ${name}: ${duration.toFixed( 2 )}ms` )
            }
        }
    }

    /**
   * Track a metric
   */
    track( name: string, value: number, metadata?: Record<string, any> ): void {
        const entry: MetricEntry = {
            name,
            value,
            metadata,
            timestamp: Date.now()
        }

        this.metrics.push( entry )

        // Keep only recent metrics to prevent memory leaks
        if ( this.metrics.length > 10000 ) {
            this.metrics = this.metrics.slice( -5000 )
        }

        if ( this.shouldLog( "debug" ) && this.config.verbose ) {
            const metadataStr = metadata ? ` (${JSON.stringify( metadata )})` : ""
            console.debug( `📊 ${name}: ${value}${metadataStr}` )
        }
    }

    /**
   * Log an event
   */
    log( level: "debug" | "info" | "warn" | "error", message: string, metadata?: Record<string, any> ): void {
        if ( !this.shouldLog( level ) ) return

        const icon = this.getLevelIcon( level )
        const metadataStr = metadata ? ` ${JSON.stringify( metadata )}` : ""
    
        console[ level ]( `${icon} ${message}${metadataStr}` )
    }

    /**
   * Get aggregated metrics
   */
    getMetrics( timeRange?: { start: number; end: number } ): Record<string, any> {
        let filteredMetrics = this.metrics

        if ( timeRange ) {
            filteredMetrics = this.metrics.filter(
                metric => metric.timestamp >= timeRange.start && metric.timestamp <= timeRange.end
            )
        }

        if ( !this.config.aggregateMetrics ) {
            return { raw: filteredMetrics }
        }

        // Aggregate metrics by name
        const aggregated: Record<string, {
      count: number
      sum: number
      avg: number
      min: number
      max: number
      latest: number
    }> = {}

        for ( const metric of filteredMetrics ) {
            if ( !aggregated[ metric.name ] ) {
                aggregated[ metric.name ] = {
                    count: 0,
                    sum: 0,
                    avg: 0,
                    min: Infinity,
                    max: -Infinity,
                    latest: 0
                }
            }

            const agg = aggregated[ metric.name ]
            agg.count++
            agg.sum += metric.value
            agg.min = Math.min( agg.min, metric.value )
            agg.max = Math.max( agg.max, metric.value )
            agg.latest = metric.value
            agg.avg = agg.sum / agg.count
        }

        return aggregated
    }

    /**
   * Print a metrics summary
   */
    printSummary( timeRange?: { start: number; end: number } ): void {
        const metrics = this.getMetrics( timeRange )
    
        console.group( "📈 Metrics Summary" )
    
        Object.entries( metrics ).forEach( ( [ name, stats ] ) => {
            if ( typeof stats === "object" && "count" in stats ) {
                console.log( `${name}:`, {
                    count: stats.count,
                    avg: stats.avg.toFixed( 2 ),
                    min: stats.min,
                    max: stats.max,
                    latest: stats.latest
                } )
            }
        } )
    
        console.groupEnd()
    }

    /**
   * Clear all metrics
   */
    clearMetrics(): void {
        this.metrics = []
        this.timers.clear()
    }

    // ============================================================================
    // PRIVATE METHODS
    // ============================================================================

    private shouldLog( level: "debug" | "info" | "warn" | "error" ): boolean {
        const levels = [ "debug", "info", "warn", "error" ]
        const currentLevelIndex = levels.indexOf( this.config.logLevel )
        const messageLevelIndex = levels.indexOf( level )
    
        return messageLevelIndex >= currentLevelIndex
    }

    private getLevelIcon( level: "debug" | "info" | "warn" | "error" ): string {
        const icons = {
            debug: "🐛",
            info: "ℹ️",
            warn: "⚠️",
            error: "❌"
        }
        return icons[ level ]
    }
}