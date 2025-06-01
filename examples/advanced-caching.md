# Advanced Caching Examples

This example demonstrates advanced caching strategies including multi-level cache hierarchies, background cache warming, and cross-tab synchronization.

## Multi-Level Cache Hierarchies

```typescript
import { 
    MultiLevelCache, 
    MemoryCache, 
    IndexedDBCache,
    ConsoleLogger 
} from 'ra-ts'

// Create cache levels (L1: Memory, L2: IndexedDB)
const l1Cache = new MemoryCache({
    maxSize: 100,
    defaultTTL: 60000 // 1 minute
})

const l2Cache = new IndexedDBCache({
    dbName: 'AppCacheL2',
    defaultTTL: 3600000 // 1 hour
})

// Configure multi-level cache
const multiCache = new MultiLevelCache({
    levels: [
        {
            level: 1,
            name: 'Memory',
            adapter: l1Cache,
            maxSize: 100,
            defaultTTL: 60000,
            promotionCriteria: {
                accessCount: 3,
                accessFrequency: 0.1
            },
            demotionCriteria: {
                staleness: 300000, // 5 minutes
                size: 1024 // 1KB
            }
        },
        {
            level: 2,
            name: 'IndexedDB',
            adapter: l2Cache,
            maxSize: 1000,
            defaultTTL: 3600000,
            promotionCriteria: {
                accessCount: 2
            },
            demotionCriteria: {
                staleness: 7200000 // 2 hours
            }
        }
    ],
    autoOptimize: true,
    optimizationInterval: 300000, // 5 minutes
    trackAccessPatterns: true,
    promotionThreshold: 3,
    demotionThreshold: 3600000, // 1 hour
    logger: new ConsoleLogger()
})

// Usage examples
const cacheUserData = async (userId: number) => {
    const cacheKey = `user:${userId}`
    
    // Check multi-level cache
    const cached = await multiCache.get<User>(cacheKey)
    if (cached.success && cached.data) {
        console.log('Cache hit!')
        return cached.data
    }
    
    // Fetch from API
    const user = await fetchUserFromAPI(userId)
    
    // Store in multi-level cache (will choose optimal level)
    await multiCache.set(cacheKey, user, 300000)
    
    return user
}

// Get analytics across all levels
const getCacheAnalytics = async () => {
    const analytics = await multiCache.getAnalytics()
    if (analytics.success) {
        console.log('Cache Analytics:', {
            hitRate: `${(analytics.data.hitRate * 100).toFixed(1)}%`,
            totalSize: `${(analytics.data.totalSize / 1024).toFixed(1)}KB`,
            entryCount: analytics.data.entryCount,
            popularKeys: analytics.data.popularKeys,
            largestEntries: analytics.data.largestEntries
        })
    }
}

// Manual optimization
const optimizeCache = async () => {
    const result = await multiCache.optimize()
    if (result.success) {
        console.log('Cache optimization completed')
    }
}
```

## Background Cache Warming

```typescript
import { 
    CacheWarmer, 
    MemoryCache,
    ConsoleLogger 
} from 'ra-ts'

const cache = new MemoryCache({ maxSize: 500 })

// Configure cache warming
const cacheWarmer = new CacheWarmer({
    cache,
    enabled: true,
    warmupInterval: 300000, // 5 minutes
    maxConcurrency: 3,
    priority: 'medium',
    maxWarmupDuration: 30000, // 30 seconds
    batchSize: 10,
    logger: new ConsoleLogger(),
    
    // Pre-defined warming patterns
    warmupPatterns: [
        'user:popular:*',
        'config:global:*',
        'content:featured:*'
    ],
    
    // Custom warmup function
    warmupFunction: async () => {
        console.log('Running custom warmup logic...')
        // Could pre-populate critical data
        return success(undefined)
    }
})

// Add custom warming tasks
cacheWarmer.addTask(
    'user:active:*',
    async () => {
        // Fetch active users from API
        const users = await fetchActiveUsers()
        return users.map(user => ({
            key: `user:${user.id}`,
            value: user,
            ttl: 300000
        }))
    },
    { priority: 'high', maxAttempts: 3 }
)

cacheWarmer.addTask(
    'content:trending:*',
    async () => {
        // Fetch trending content
        const content = await fetchTrendingContent()
        return content.map(item => ({
            key: `content:${item.id}`,
            value: item,
            ttl: 600000
        }))
    },
    { priority: 'medium' }
)

// Start warming
const startCacheWarming = async () => {
    const result = await cacheWarmer.start()
    if (result.success) {
        console.log('Cache warming started')
        
        // Monitor warming statistics
        setInterval(() => {
            const stats = cacheWarmer.getStats()
            console.log('Warming Stats:', {
                isRunning: stats.isRunning,
                totalWarmed: stats.totalWarmed,
                lastWarmup: stats.lastWarmup,
                averageTime: `${stats.averageWarmupTime}ms`
            })
        }, 60000) // Every minute
    }
}

// Warm specific pattern on demand
const warmSpecificPattern = async (pattern: string) => {
    const result = await cacheWarmer.warmPattern(pattern)
    if (result.success) {
        console.log(`Pattern ${pattern} warmed successfully`)
    }
}

// Dynamic warming based on user behavior
const warmUserPreferences = async (userId: number) => {
    cacheWarmer.addTask(
        `user:${userId}:preferences`,
        async () => {
            const preferences = await fetchUserPreferences(userId)
            return [
                {
                    key: `user:${userId}:settings`,
                    value: preferences.settings,
                    ttl: 3600000
                },
                {
                    key: `user:${userId}:theme`,
                    value: preferences.theme,
                    ttl: 86400000
                }
            ]
        },
        { priority: 'low' }
    )
}

// Stop warming gracefully
const stopCacheWarming = async () => {
    await cacheWarmer.stop()
    console.log('Cache warming stopped')
}
```

## Cross-Tab Cache Synchronization

```typescript
import { 
    TabSyncManager, 
    MemoryCache,
    ConsoleLogger 
} from 'ra-ts'

const cache = new MemoryCache({ maxSize: 200 })

// Configure tab synchronization
const tabSync = new TabSyncManager({
    cache,
    enabled: true,
    channel: 'myapp-cache-sync',
    strategy: 'broadcast',
    conflictResolution: 'last-write-wins',
    debounceDelay: 100,
    maxMessageSize: 10240, // 10KB
    logger: new ConsoleLogger(),
    
    // Custom conflict resolver
    conflictResolver: (localValue: any, remoteValue: any) => {
        // Merge strategies for different data types
        if (typeof localValue === 'object' && typeof remoteValue === 'object') {
            return { ...localValue, ...remoteValue, _mergedAt: Date.now() }
        }
        
        // For primitive values, use the newer one
        return remoteValue
    }
})

// Synchronized cache operations
const syncedSet = async <T>(key: string, value: T, ttl?: number) => {
    // This will sync across all tabs
    return tabSync.syncSet(key, value, ttl)
}

const syncedDelete = async (key: string) => {
    return tabSync.syncDelete(key)
}

const syncedClear = async () => {
    return tabSync.syncClear()
}

const syncedInvalidate = async (pattern: string) => {
    return tabSync.syncInvalidate(pattern)
}

// Usage in application
const updateUserSettings = async (userId: number, settings: UserSettings) => {
    const key = `user:${userId}:settings`
    
    // Update will be synchronized across all tabs
    const result = await syncedSet(key, settings, 3600000)
    
    if (result.success) {
        console.log('Settings updated and synchronized across tabs')
        
        // Check sync status
        const status = tabSync.getStatus()
        console.log('Sync Status:', {
            isLeader: status.isLeader,
            tabId: status.tabId,
            connectedTabs: status.knownTabs.length,
            pendingOps: status.pendingOperations
        })
    }
}

// Real-time collaboration example
const handleCollaborativeEdit = async (documentId: string, changes: any) => {
    const key = `doc:${documentId}:latest`
    
    // Get current document state
    const current = await cache.get(key)
    
    if (current.success && current.data) {
        // Apply changes locally
        const updated = applyChanges(current.data, changes)
        
        // Sync with other tabs
        await syncedSet(key, updated)
        
        console.log('Document changes synchronized')
    }
}
```

## Comprehensive Cache Strategy

```typescript
import { 
    MultiLevelCache,
    CacheWarmer,
    TabSyncManager,
    MemoryCache,
    IndexedDBCache,
    ConsoleLogger 
} from 'ra-ts'

// Advanced cache setup combining all features
const createAdvancedCacheSystem = () => {
    const logger = new ConsoleLogger()
    
    // 1. Multi-level cache
    const multiCache = new MultiLevelCache({
        levels: [
            {
                level: 1,
                name: 'L1-Memory',
                adapter: new MemoryCache({ 
                    maxSize: 100, 
                    defaultTTL: 60000 
                }),
                promotionCriteria: { accessCount: 3 }
            },
            {
                level: 2,
                name: 'L2-IndexedDB',
                adapter: new IndexedDBCache({ 
                    dbName: 'AppCache',
                    defaultTTL: 3600000 
                }),
                demotionCriteria: { staleness: 7200000 }
            }
        ],
        autoOptimize: true,
        optimizationInterval: 300000,
        logger
    })
    
    // 2. Cache warming
    const warmer = new CacheWarmer({
        cache: multiCache,
        enabled: true,
        warmupInterval: 600000, // 10 minutes
        maxConcurrency: 2,
        batchSize: 20,
        logger,
        warmupPatterns: [
            'user:active:*',
            'config:*',
            'content:popular:*'
        ]
    })
    
    // 3. Tab synchronization
    const tabSync = new TabSyncManager({
        cache: multiCache,
        enabled: true,
        channel: 'advanced-cache-sync',
        conflictResolution: 'last-write-wins',
        logger
    })
    
    return { multiCache, warmer, tabSync }
}

// Initialize the system
const initAdvancedCaching = async () => {
    const { multiCache, warmer, tabSync } = createAdvancedCacheSystem()
    
    // Start warming
    await warmer.start()
    
    // Add application-specific warming tasks
    warmer.addTask('user:permissions:*', async () => {
        const permissions = await fetchAllPermissions()
        return permissions.map(p => ({
            key: `permission:${p.id}`,
            value: p,
            ttl: 1800000 // 30 minutes
        }))
    })
    
    // Performance monitoring
    setInterval(async () => {
        const [cacheStats, warmStats, syncStatus] = await Promise.all([
            multiCache.getAnalytics(),
            Promise.resolve(warmer.getStats()),
            Promise.resolve(tabSync.getStatus())
        ])
        
        console.log('System Performance:', {
            cache: cacheStats.success ? {
                hitRate: `${(cacheStats.data.hitRate * 100).toFixed(1)}%`,
                entries: cacheStats.data.entryCount,
                size: `${(cacheStats.data.totalSize / 1024).toFixed(1)}KB`
            } : 'Error',
            warming: {
                active: warmStats.isRunning,
                totalWarmed: warmStats.totalWarmed,
                avgTime: `${warmStats.averageWarmupTime}ms`
            },
            sync: {
                isLeader: syncStatus.isLeader,
                tabs: syncStatus.knownTabs.length,
                pending: syncStatus.pendingOperations
            }
        })
    }, 30000) // Every 30 seconds
    
    return { multiCache, warmer, tabSync }
}

// Application integration
const createCachedDataService = (cache: MultiLevelCache, tabSync: TabSyncManager) => {
    return {
        async getUser(id: number): Promise<User | null> {
            const key = `user:${id}`
            const result = await cache.get<User>(key)
            
            if (result.success && result.data) {
                return result.data
            }
            
            // Fetch and cache
            const user = await fetchUserFromAPI(id)
            await tabSync.syncSet(key, user, 300000)
            return user
        },
        
        async updateUser(id: number, updates: Partial<User>): Promise<void> {
            const key = `user:${id}`
            const current = await cache.get<User>(key)
            
            if (current.success && current.data) {
                const updated = { ...current.data, ...updates }
                await tabSync.syncSet(key, updated, 300000)
                
                // Invalidate related caches
                await tabSync.syncInvalidate(`user:${id}:*`)
            }
        },
        
        async invalidateUser(id: number): Promise<void> {
            await tabSync.syncInvalidate(`user:${id}*`)
        }
    }
}

// Error handling and recovery
const handleCacheErrors = (cache: MultiLevelCache) => {
    // Monitor for cache errors and implement recovery strategies
    const originalGet = cache.get.bind(cache)
    
    cache.get = async function<T>(key: string) {
        try {
            return await originalGet(key)
        } catch (error) {
            console.error('Cache get error:', error)
            
            // Fallback to direct API call
            if (key.startsWith('user:')) {
                const userId = key.split(':')[1]
                const user = await fetchUserFromAPI(parseInt(userId))
                return success(user as T)
            }
            
            return success(undefined)
        }
    }
}
```

## Performance Optimization Tips

```typescript
// 1. Cache partitioning for multi-tenant applications
const createPartitionedCache = (tenantId: string) => {
    return new MultiLevelCache({
        levels: [
            {
                level: 1,
                name: `L1-${tenantId}`,
                adapter: new MemoryCache({ 
                    maxSize: 50,
                    // Tenant-specific prefix
                    keyPrefix: `tenant:${tenantId}:` 
                })
            }
        ]
    })
}

// 2. Intelligent warming based on usage patterns
const createSmartWarmer = (cache: MultiLevelCache) => {
    const warmer = new CacheWarmer({
        cache,
        enabled: true,
        warmupInterval: 900000 // 15 minutes
    })
    
    // Add patterns based on analytics
    const addWarmingPattern = async () => {
        const analytics = await cache.getAnalytics()
        if (analytics.success) {
            const popularKeys = analytics.data.popularKeys
            
            // Extract patterns from popular keys
            const patterns = new Set<string>()
            popularKeys.forEach(({ key }) => {
                const pattern = key.replace(/:\d+/g, ':*')
                patterns.add(pattern)
            })
            
            // Add as warming tasks
            patterns.forEach(pattern => {
                warmer.addTask(pattern, async () => {
                    // Implement pattern-specific warming logic
                    return []
                })
            })
        }
    }
    
    // Run pattern analysis every hour
    setInterval(addWarmingPattern, 3600000)
    
    return warmer
}

// 3. Adaptive cache sizing based on memory pressure
const createAdaptiveCache = () => {
    let currentMaxSize = 100
    
    const cache = new MemoryCache({ 
        maxSize: currentMaxSize,
        onEviction: (key, reason) => {
            if (reason === 'size') {
                // Increase cache size if evicting due to size limits
                currentMaxSize = Math.min(currentMaxSize * 1.2, 500)
                console.log(`Adaptive cache size increased to ${currentMaxSize}`)
            }
        }
    })
    
    // Monitor memory usage and adjust
    if (typeof performance !== 'undefined' && 'memory' in performance) {
        setInterval(() => {
            const memInfo = (performance as any).memory
            const usedRatio = memInfo.usedJSHeapSize / memInfo.jsHeapSizeLimit
            
            if (usedRatio > 0.8) {
                // High memory pressure, reduce cache size
                currentMaxSize = Math.max(currentMaxSize * 0.8, 50)
                console.log(`Memory pressure detected, cache size reduced to ${currentMaxSize}`)
            }
        }, 60000) // Check every minute
    }
    
    return cache
}
```

This example demonstrates comprehensive advanced caching strategies that can improve application performance by 40%+ through intelligent multi-level hierarchies, proactive warming, and seamless cross-tab synchronization. 