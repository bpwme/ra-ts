# Request Batching Examples

This example demonstrates how to use the request batching system for optimizing API calls by grouping similar requests.

## Basic Request Batching

```typescript
import { 
    RequestBatcher, 
    DataLoader, 
    createDataLoader, 
    ConsoleLogger 
} from 'ra-ts'

// Create a basic request batcher
const userBatcher = new RequestBatcher<number, User>({
    maxBatchSize: 20,
    maxWaitTime: 50, // Wait up to 50ms before executing batch
    maxConcurrency: 3,
    enableDeduplication: true,
    enableCaching: true,
    cacheTTL: 60000, // Cache for 1 minute
    logger: new ConsoleLogger(),
    
    // Custom batch key function for grouping requests
    batchKeyFn: (userId: number) => `users:${Math.floor(userId / 100)}`, // Group by hundreds
    
    // Custom batch executor
    batchExecutor: async (userIds: number[]) => {
        try {
            const response = await fetch('/api/users/batch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userIds })
            })

            if (!response.ok) {
                return error(new NetworkError('Batch request failed'))
            }

            const users = await response.json()
            return success(users)
        } catch (err) {
            return error(new NetworkError('Batch execution failed', { error: err }))
        }
    }
})

// Use the batcher
const getUserBatched = async (userId: number): Promise<Either<any, User>> => {
    return userBatcher.batchRequest(userId)
}

// Multiple requests will be automatically batched
const getUsersExample = async () => {
    const [user1, user2, user3] = await Promise.all([
        getUserBatched(1),
        getUserBatched(2),
        getUserBatched(3)
    ])
    
    console.log('Users fetched:', { user1, user2, user3 })
    console.log('Batch stats:', userBatcher.getStats())
}
```

## DataLoader Pattern

```typescript
interface User {
    id: number
    name: string
    email: string
}

interface Post {
    id: number
    authorId: number
    title: string
    content: string
}

// User DataLoader with custom batch function
const userLoader = new DataLoader<number, User>({
    batchLoadFn: async (userIds: number[]) => {
        console.log('Loading users:', userIds)
        
        const response = await fetch('/api/users/batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: userIds })
        })

        if (!response.ok) {
            return error(new NetworkError('Failed to load users'))
        }

        const users = await response.json()
        return success(users)
    },
    maxBatchSize: 25,
    batchDelay: 16, // One frame delay
    cache: true,
    cacheTTL: 300000, // 5 minutes
    logger: new ConsoleLogger()
})

// Posts DataLoader
const postsByUserLoader = new DataLoader<number, Post[]>({
    batchLoadFn: async (userIds: number[]) => {
        console.log('Loading posts for users:', userIds)
        
        const response = await fetch('/api/posts/by-users', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userIds })
        })

        if (!response.ok) {
            return error(new NetworkError('Failed to load posts'))
        }

        const postsByUser = await response.json()
        return success(postsByUser)
    },
    maxBatchSize: 50,
    cache: true,
    logger: new ConsoleLogger()
})

// Usage examples
const loadUserWithPosts = async (userId: number) => {
    const [userResult, postsResult] = await Promise.all([
        userLoader.load(userId),
        postsByUserLoader.load(userId)
    ])

    if (userResult.error) return userResult
    if (postsResult.error) return postsResult

    return success({
        user: userResult.data,
        posts: postsResult.data
    })
}

// Load multiple users efficiently
const loadUsersPage = async (userIds: number[]) => {
    const results = await userLoader.loadMany(userIds)
    
    const users: User[] = []
    const errors: any[] = []
    
    results.forEach((result, index) => {
        if (result.success) {
            users.push(result.data)
        } else {
            errors.push({ index, error: result.error })
        }
    })

    return { users, errors }
}
```

## Advanced Batching Strategies

```typescript
// Geographic-based batching
const locationBatcher = new RequestBatcher<LocationQuery, WeatherData>({
    maxBatchSize: 10,
    maxWaitTime: 100,
    batchKeyFn: (query: LocationQuery) => {
        // Group by region for efficient API usage
        const region = getRegionCode(query.lat, query.lng)
        return `weather:${region}`
    },
    batchExecutor: async (queries: LocationQuery[]) => {
        // Use bulk weather API
        const response = await fetch('/api/weather/bulk', {
            method: 'POST',
            body: JSON.stringify({ locations: queries })
        })

        if (!response.ok) {
            return error(new NetworkError('Weather batch failed'))
        }

        const weatherData = await response.json()
        return success(weatherData)
    },
    logger: new ConsoleLogger()
})

// Time-based batching for analytics
const analyticsEventBatcher = new RequestBatcher<AnalyticsEvent, void>({
    maxBatchSize: 100,
    maxWaitTime: 5000, // 5 second buffer
    maxConcurrency: 2,
    batchKeyFn: () => 'analytics', // Single batch type
    batchExecutor: async (events: AnalyticsEvent[]) => {
        try {
            await fetch('/api/analytics/events', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ events })
            })
            
            return success(events.map(() => undefined))
        } catch (err) {
            return error(new BatchError('Analytics batch failed', { error: err }))
        }
    },
    enableCaching: false, // Don't cache analytics events
    logger: new ConsoleLogger()
})

// Track events efficiently
const trackEvent = async (event: AnalyticsEvent) => {
    return analyticsEventBatcher.batchRequest(event)
}
```

## Performance Optimization

```typescript
// Database query batching
interface DatabaseQuery {
    table: string
    where: Record<string, any>
    select?: string[]
}

const dbQueryBatcher = new RequestBatcher<DatabaseQuery, any[]>({
    maxBatchSize: 50,
    maxWaitTime: 10,
    
    // Group queries by table for optimal database performance
    batchKeyFn: (query: DatabaseQuery) => query.table,
    
    batchExecutor: async (queries: DatabaseQuery[]) => {
        // Optimize database queries by table
        const tableName = queries[0].table
        
        // Combine WHERE clauses efficiently
        const combinedQuery = optimizeQueries(queries)
        
        try {
            const result = await database.query(combinedQuery)
            return success(result)
        } catch (err) {
            return error(new BatchError('Database batch failed', { error: err }))
        }
    },
    
    logger: new ConsoleLogger()
})

// Search result batching with intelligent grouping
const searchBatcher = new RequestBatcher<SearchQuery, SearchResult[]>({
    maxBatchSize: 20,
    maxWaitTime: 30,
    
    // Group by search category and filters
    batchKeyFn: (query: SearchQuery) => {
        return `search:${query.category}:${JSON.stringify(query.filters)}`
    },
    
    batchExecutor: async (queries: SearchQuery[]) => {
        // Combine search terms for more efficient search
        const combinedTerms = queries.map(q => q.term).join(' OR ')
        const category = queries[0].category
        const filters = queries[0].filters

        const response = await fetch('/api/search', {
            method: 'POST',
            body: JSON.stringify({
                query: combinedTerms,
                category,
                filters,
                individualQueries: queries.map(q => q.term)
            })
        })

        if (!response.ok) {
            return error(new NetworkError('Search batch failed'))
        }

        const results = await response.json()
        return success(results)
    },
    
    enableCaching: true,
    cacheTTL: 120000, // 2 minutes
    logger: new ConsoleLogger()
})
```

## Error Handling and Monitoring

```typescript
// Robust batch processing with error isolation
const robustUserLoader = new RequestBatcher<number, User>({
    maxBatchSize: 30,
    maxWaitTime: 50,
    maxConcurrency: 5,
    
    batchExecutor: async (userIds: number[]) => {
        try {
            const response = await fetch('/api/users/batch', {
                method: 'POST',
                body: JSON.stringify({ userIds }),
                headers: { 'Content-Type': 'application/json' }
            })

            if (!response.ok) {
                // Handle HTTP errors gracefully
                if (response.status === 404) {
                    // Return null for missing users instead of failing the whole batch
                    return success(userIds.map(() => null))
                }
                return error(new NetworkError(`HTTP ${response.status}`))
            }

            const result = await response.json()
            
            // Validate result structure
            if (!Array.isArray(result) || result.length !== userIds.length) {
                return error(new BatchError('Invalid batch response structure'))
            }

            return success(result)
        } catch (err) {
            return error(new BatchError('Network error during batch', { error: err }))
        }
    },
    
    logger: new ConsoleLogger()
})

// Monitor batch performance
const monitorBatchPerformance = () => {
    setInterval(() => {
        const stats = robustUserLoader.getStats()
        
        console.log('Batch Performance Metrics:', {
            totalRequests: stats.totalRequests,
            totalBatches: stats.totalBatches,
            averageBatchSize: stats.averageBatchSize.toFixed(2),
            averageWaitTime: `${stats.averageWaitTime.toFixed(2)}ms`,
            cacheHitRate: `${(stats.cacheHitRate * 100).toFixed(1)}%`,
            activeBatches: stats.activebatches,
            pendingRequests: stats.pendingRequests
        })
        
        // Alert on performance issues
        if (stats.averageWaitTime > 100) {
            console.warn('High batch wait time detected!')
        }
        
        if (stats.cacheHitRate < 0.5) {
            console.warn('Low cache hit rate detected!')
        }
    }, 30000) // Every 30 seconds
}

// Graceful shutdown
const gracefulShutdown = async () => {
    console.log('Shutting down batch processors...')
    
    // Flush pending batches
    await Promise.all([
        userBatcher.flush(),
        analyticsEventBatcher.flush(),
        searchBatcher.flush()
    ])
    
    // Clear pending requests
    userBatcher.clearPending()
    analyticsEventBatcher.clearPending()
    searchBatcher.clearPending()
    
    console.log('Batch processors shut down gracefully')
}
```

## Integration with DataManager

```typescript
// Custom fetcher with batching
const createBatchedFetcher = <T>(
    batcher: RequestBatcher<any, T>
) => {
    return async (request: any): Promise<Either<any, T>> => {
        return batcher.batchRequest(request)
    }
}

// Use with DataManager
const dataManager = new DataManager({
    cache: new MemoryCache({ maxSize: 1000 }),
    logger: new ConsoleLogger()
})

const fetchUserWithBatching = async (userId: number) => {
    return dataManager
        .query<User>(`user:${userId}`)
        .staleTime(60000)
        .ttl(300000)
        .fetch(createBatchedFetcher(userBatcher).bind(null, userId))
}

// Batch multiple DataManager operations
const fetchUsersWithDataManager = async (userIds: number[]) => {
    const promises = userIds.map(id => 
        dataManager
            .query<User>(`user:${id}`)
            .staleTime(60000)
            .fetch(createBatchedFetcher(userBatcher).bind(null, id))
    )

    return Promise.all(promises)
}
```

## Configuration Best Practices

```typescript
// Development configuration - more logging, smaller batches
const devBatcherConfig = {
    maxBatchSize: 5,
    maxWaitTime: 100,
    maxConcurrency: 2,
    enableDeduplication: true,
    enableCaching: true,
    cacheTTL: 30000,
    logger: new ConsoleLogger() // Verbose logging
}

// Production configuration - optimized for performance
const prodBatcherConfig = {
    maxBatchSize: 100,
    maxWaitTime: 10,
    maxConcurrency: 10,
    enableDeduplication: true,
    enableCaching: true,
    cacheTTL: 300000,
    logger: undefined // No logging in production
}

// Create environment-specific batcher
const createEnvironmentBatcher = (env: 'development' | 'production') => {
    const config = env === 'development' ? devBatcherConfig : prodBatcherConfig
    
    return new RequestBatcher({
        ...config,
        batchExecutor: async (requests) => {
            // Your batch logic here
            return success(requests)
        }
    })
}
```

This example demonstrates comprehensive request batching patterns, from basic batching to advanced optimization strategies, with proper error handling and performance monitoring. 