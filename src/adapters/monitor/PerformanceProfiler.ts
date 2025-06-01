import { ILogger } from "../../types"

/**
 * Performance profiling configuration
 */
export type ProfilerConfig = {
    /** Enable performance profiling */
    enabled: boolean
    /** Sample rate for profiling (0-1) */
    sampleRate: number
    /** Maximum number of profiles to keep */
    maxProfiles: number
    /** Minimum duration to capture (ms) */
    minDuration: number
    /** Enable memory profiling */
    memoryProfiling: boolean
    /** Logger for debugging */
    logger?: ILogger
}

/**
 * Performance profile data
 */
export type PerformanceProfile = {
    id: string
    name: string
    startTime: number
    endTime: number
    duration: number
    memoryUsage?: {
        before: MemoryInfo
        after: MemoryInfo
        delta: number
    }
    callStack?: string[]
    metadata: Record<string, any>
    children: PerformanceProfile[]
}

/**
 * Memory usage information
 */
export type MemoryInfo = {
    used: number
    total: number
    limit: number
}

/**
 * Performance statistics
 */
export type PerformanceStats = {
    totalProfiles: number
    averageDuration: number
    medianDuration: number
    p95Duration: number
    p99Duration: number
    slowestOperations: Array<{
        name: string
        duration: number
        timestamp: number
    }>
    memoryStats?: {
        averageUsage: number
        peakUsage: number
        totalAllocated: number
    }
}

/**
 * Advanced performance profiler for monitoring operation performance
 */
export class PerformanceProfiler {
    private config: ProfilerConfig
    private profiles: PerformanceProfile[] = []
    private activeProfiles = new Map<string, PerformanceProfile>()
    private profileCounter = 0

    constructor( config: ProfilerConfig ) {
        this.config = {
            ...config,
            enabled: config.enabled ?? true,
            sampleRate: config.sampleRate ?? 1.0,
            maxProfiles: config.maxProfiles ?? 1000,
            minDuration: config.minDuration ?? 1,
            memoryProfiling: config.memoryProfiling ?? false
        }
    }

    /**
     * Start profiling an operation
     */
    startProfile( name: string, metadata?: Record<string, any> ): string | null {
        if ( !this.config.enabled || Math.random() > this.config.sampleRate ) {
            return null
        }

        const profileId = this.generateProfileId()
        const profile: PerformanceProfile = {
            id: profileId,
            name,
            startTime: this.getHighResolutionTime(),
            endTime: 0,
            duration: 0,
            metadata: metadata || {},
            children: []
        }

        if ( this.config.memoryProfiling ) {
            profile.memoryUsage = {
                before: this.getMemoryInfo(),
                after: { used: 0, total: 0, limit: 0 },
                delta: 0
            }
        }

        this.activeProfiles.set( profileId, profile )
        this.log( "debug", `Started profiling: ${name}`, { profileId } )

        return profileId
    }

    /**
     * End profiling an operation
     */
    endProfile( profileId: string | null, additionalMetadata?: Record<string, any> ): PerformanceProfile | null {
        if ( !profileId || !this.activeProfiles.has( profileId ) ) {
            return null
        }

        const profile = this.activeProfiles.get( profileId )!
        profile.endTime = this.getHighResolutionTime()
        profile.duration = profile.endTime - profile.startTime

        if ( additionalMetadata ) {
            Object.assign( profile.metadata, additionalMetadata )
        }

        if ( this.config.memoryProfiling && profile.memoryUsage ) {
            profile.memoryUsage.after = this.getMemoryInfo()
            profile.memoryUsage.delta = profile.memoryUsage.after.used - profile.memoryUsage.before.used
        }

        // Only keep profiles that meet minimum duration
        if ( profile.duration >= this.config.minDuration ) {
            this.addProfile( profile )
        }

        this.activeProfiles.delete( profileId )
        this.log( "debug", `Ended profiling: ${profile.name}`, { 
            profileId, 
            duration: profile.duration 
        } )

        return profile
    }

    /**
     * Profile a function execution
     */
    async profileFunction<T>(
        name: string, 
        fn: () => Promise<T> | T,
        metadata?: Record<string, any>
    ): Promise<T> {
        const profileId = this.startProfile( name, metadata )
        
        try {
            const result = await fn()
            this.endProfile( profileId, { success: true } )
            return result
        } catch ( error ) {
            this.endProfile( profileId, { 
                success: false, 
                error: error instanceof Error ? error.message : "Unknown error" 
            } )
            throw error
        }
    }

    /**
     * Get performance statistics
     */
    getStats(): PerformanceStats {
        if ( this.profiles.length === 0 ) {
            return {
                totalProfiles: 0,
                averageDuration: 0,
                medianDuration: 0,
                p95Duration: 0,
                p99Duration: 0,
                slowestOperations: []
            }
        }

        const durations = this.profiles.map( p => p.duration ).sort( ( a, b ) => a - b )
        const sum = durations.reduce( ( a, b ) => a + b, 0 )

        const stats: PerformanceStats = {
            totalProfiles: this.profiles.length,
            averageDuration: sum / durations.length,
            medianDuration: this.getPercentile( durations, 0.5 ),
            p95Duration: this.getPercentile( durations, 0.95 ),
            p99Duration: this.getPercentile( durations, 0.99 ),
            slowestOperations: this.profiles
                .sort( ( a, b ) => b.duration - a.duration )
                .slice( 0, 10 )
                .map( p => ( {
                    name: p.name,
                    duration: p.duration,
                    timestamp: p.startTime
                } ) )
        }

        if ( this.config.memoryProfiling ) {
            const memoryProfiles = this.profiles.filter( p => p.memoryUsage )
            if ( memoryProfiles.length > 0 ) {
                const memoryUsages = memoryProfiles.map( p => p.memoryUsage!.after.used )
                const memoryDeltas = memoryProfiles.map( p => p.memoryUsage!.delta )

                stats.memoryStats = {
                    averageUsage: memoryUsages.reduce( ( a, b ) => a + b, 0 ) / memoryUsages.length,
                    peakUsage: Math.max( ...memoryUsages ),
                    totalAllocated: memoryDeltas.filter( d => d > 0 ).reduce( ( a, b ) => a + b, 0 )
                }
            }
        }

        return stats
    }

    /**
     * Get profiles by name pattern
     */
    getProfiles( namePattern?: string | RegExp ): PerformanceProfile[] {
        if ( !namePattern ) {
            return [ ...this.profiles ]
        }

        const regex = typeof namePattern === "string" 
            ? new RegExp( namePattern ) 
            : namePattern

        return this.profiles.filter( p => regex.test( p.name ) )
    }

    /**
     * Get slow operations above threshold
     */
    getSlowOperations( thresholdMs: number ): PerformanceProfile[] {
        return this.profiles
            .filter( p => p.duration > thresholdMs )
            .sort( ( a, b ) => b.duration - a.duration )
    }

    /**
     * Clear all profiles
     */
    clearProfiles(): void {
        this.profiles = []
        this.log( "info", "Cleared all performance profiles" )
    }

    /**
     * Generate performance report
     */
    generateReport(): string {
        const stats = this.getStats()
        
        let report = "\n📊 Performance Profile Report\n"
        report += "================================\n\n"
        
        report += `Total Profiles: ${stats.totalProfiles}\n`
        report += `Average Duration: ${stats.averageDuration.toFixed( 2 )}ms\n`
        report += `Median Duration: ${stats.medianDuration.toFixed( 2 )}ms\n`
        report += `95th Percentile: ${stats.p95Duration.toFixed( 2 )}ms\n`
        report += `99th Percentile: ${stats.p99Duration.toFixed( 2 )}ms\n\n`

        if ( stats.memoryStats ) {
            report += "Memory Statistics:\n"
            report += `  Average Usage: ${( stats.memoryStats.averageUsage / 1024 / 1024 ).toFixed( 2 )}MB\n`
            report += `  Peak Usage: ${( stats.memoryStats.peakUsage / 1024 / 1024 ).toFixed( 2 )}MB\n`
            report += `  Total Allocated: ${( stats.memoryStats.totalAllocated / 1024 / 1024 ).toFixed( 2 )}MB\n\n`
        }

        report += "Slowest Operations:\n"
        stats.slowestOperations.forEach( ( op, index ) => {
            report += `  ${index + 1}. ${op.name}: ${op.duration.toFixed( 2 )}ms\n`
        } )

        return report
    }

    /**
     * Add a profile to storage
     */
    private addProfile( profile: PerformanceProfile ): void {
        this.profiles.push( profile )

        // Trim profiles if we exceed maximum
        if ( this.profiles.length > this.config.maxProfiles ) {
            this.profiles = this.profiles.slice( -this.config.maxProfiles )
        }
    }

    /**
     * Get high resolution timestamp
     */
    private getHighResolutionTime(): number {
        if ( typeof performance !== "undefined" && performance.now ) {
            return performance.now()
        }
        return Date.now()
    }

    /**
     * Get current memory information
     */
    private getMemoryInfo(): MemoryInfo {
        if ( typeof performance !== "undefined" && ( performance as any ).memory ) {
            const memory = ( performance as any ).memory
            return {
                used: memory.usedJSHeapSize,
                total: memory.totalJSHeapSize,
                limit: memory.jsHeapSizeLimit
            }
        }

        // Fallback for environments without memory API
        return {
            used: 0,
            total: 0,
            limit: 0
        }
    }

    /**
     * Calculate percentile from sorted array
     */
    private getPercentile( sortedValues: number[], percentile: number ): number {
        if ( sortedValues.length === 0 ) return 0
        
        const index = Math.ceil( sortedValues.length * percentile ) - 1
        return sortedValues[ Math.max( 0, index ) ]
    }

    /**
     * Generate unique profile ID
     */
    private generateProfileId(): string {
        return `profile_${Date.now()}_${++this.profileCounter}_${Math.random().toString( 36 ).substr( 2, 9 )}`
    }

    /**
     * Log messages with optional logger
     */
    private log( level: "debug" | "info" | "warn" | "error", message: string, data?: any ): void {
        if ( this.config.logger ) {
            this.config.logger[ level ]( `[PerformanceProfiler] ${message}`, data )
        }
    }

    /**
     * Check if profiling is enabled
     */
    isEnabled(): boolean {
        return this.config.enabled
    }

    /**
     * Update configuration
     */
    updateConfig( config: Partial<ProfilerConfig> ): void {
        Object.assign( this.config, config )
        this.log( "info", "Updated profiler configuration", config )
    }

    /**
     * Cleanup resources
     */
    destroy(): void {
        this.clearProfiles()
        this.activeProfiles.clear()
    }
}