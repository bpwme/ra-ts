
import type { Monitor } from "../../types/index"

/* eslint-disable @typescript-eslint/no-unused-vars */

/**
 * Default monitor that doesn't track anything
 */
export class NoOpMonitor implements Monitor {
    track( event: string, data?: any ): void {
    // No-op
    }

    startTimer( name: string ): () => void {
        return () => {} // Return no-op function
    }

    recordMetric( name: string, value: number ): void {
    // No-op
    }
}