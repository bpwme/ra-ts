# WebSocket Integration Example

This example demonstrates how to use the WebSocket adapter for real-time data synchronization and cache invalidation.

## Basic WebSocket Setup

```typescript
import { 
    DataManager, 
    WebSocketAdapter, 
    CacheInvalidationManager, 
    MemoryCache, 
    ConsoleLogger 
} from 'ra-ts'

// Create WebSocket adapter
const websocketAdapter = new WebSocketAdapter({
    url: 'wss://api.example.com/ws',
    protocols: ['ra-ts'],
    reconnection: {
        enabled: true,
        maxAttempts: 5,
        baseDelay: 1000,
        maxDelay: 30000,
        backoffFactor: 2
    },
    heartbeat: {
        enabled: true,
        interval: 30000,
        timeout: 5000,
        pingMessage: { type: 'ping' },
        pongMessage: { type: 'pong' }
    },
    logger: new ConsoleLogger()
})

// Create cache
const cache = new MemoryCache({ maxSize: 1000 })

// Setup cache invalidation
const invalidationManager = new CacheInvalidationManager({
    streamAdapter: websocketAdapter,
    cacheAdapter: cache,
    rules: [
        {
            channel: 'cache:invalidate',
            messageType: 'invalidate',
            extractPatterns: (data) => data.patterns || [],
            condition: (data) => data.action === 'invalidate'
        },
        {
            channel: 'users:updates',
            messageType: 'user_updated',
            extractPatterns: (data) => [`user:${data.userId}`, `user:${data.userId}:*`]
        },
        {
            channel: 'posts:updates',
            messageType: 'post_updated',
            extractPatterns: (data) => [`post:${data.postId}`, `user:${data.authorId}:posts`]
        }
    ],
    logger: new ConsoleLogger()
})

// Create DataManager with WebSocket integration
const dataManager = new DataManager({
    cache,
    stream: websocketAdapter,
    logger: new ConsoleLogger(),
    defaultTTL: 300000,
    enableOptimisticUpdates: true
})
```

## Real-time User Updates

```typescript
interface User {
    id: number
    name: string
    email: string
    lastSeen: Date
}

// Connect to WebSocket and start cache invalidation
const setupRealTimeUpdates = async () => {
    // Connect WebSocket
    const connectResult = await websocketAdapter.connect()
    if (connectResult.error) {
        console.error('Failed to connect WebSocket:', connectResult.error)
        return
    }

    // Start cache invalidation
    const startResult = await invalidationManager.start()
    if (startResult.error) {
        console.error('Failed to start cache invalidation:', startResult.error)
        return
    }

    console.log('Real-time updates enabled')
}

// Fetch user with real-time updates
const getUserWithRealTimeUpdates = async (userId: number) => {
    // Subscribe to user-specific updates
    await websocketAdapter.subscribe(`user:${userId}`, async (message) => {
        console.log('Received user update:', message)
        
        if (message.type === 'user_data_changed') {
            // Automatically invalidate cache when user data changes
            await cache.invalidate(`user:${userId}`)
            await cache.invalidate(`user:${userId}:*`)
            
            console.log(`Cache invalidated for user ${userId}`)
        }
    })

    // Fetch user data (will be cached)
    return dataManager
        .query<User>(`user:${userId}`)
        .staleTime(60000)
        .ttl(300000)
        .fetch(async () => {
            const response = await fetch(`/api/users/${userId}`)
            if (!response.ok) {
                return error(new NetworkError('Failed to fetch user'))
            }
            const userData = await response.json()
            return success(userData)
        })
}

// Update user with real-time notification
const updateUserWithNotification = async (userId: number, updates: Partial<User>) => {
    return dataManager
        .mutate<User>(`user:${userId}`)
        .optimistic({ ...getCurrentUser(), ...updates })
        .invalidates(`user:${userId}`, `user:${userId}:*`)
        .execute(async () => {
            const response = await fetch(`/api/users/${userId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updates)
            })

            if (!response.ok) {
                return error(new NetworkError('Failed to update user'))
            }

            const updatedUser = await response.json()

            // Send real-time notification to other clients
            await websocketAdapter.sendMessage({
                channel: 'users:updates',
                type: 'user_updated',
                data: { userId, updates: updatedUser },
                timestamp: new Date(),
                messageId: `user-update-${userId}-${Date.now()}`
            })

            return success(updatedUser)
        })
}
```

## Advanced Usage: Live Dashboard

```typescript
interface DashboardData {
    activeUsers: number
    totalPosts: number
    systemHealth: 'healthy' | 'warning' | 'error'
}

// Setup live dashboard with multiple data streams
const setupLiveDashboard = async () => {
    // Subscribe to system metrics
    await websocketAdapter.subscribe('system:metrics', async (message) => {
        if (message.type === 'metrics_update') {
            // Update dashboard cache with fresh metrics
            await cache.set('dashboard:metrics', message.data, 30000)
            
            // Trigger UI update (in a real app, this would update reactive state)
            console.log('Dashboard metrics updated:', message.data)
        }
    })

    // Subscribe to user activity
    await websocketAdapter.subscribe('users:activity', async (message) => {
        if (message.type === 'user_activity') {
            // Invalidate user-related caches
            await cache.invalidate('dashboard:activeUsers')
            console.log('User activity detected, refreshing active users count')
        }
    })

    // Subscribe to content updates
    await websocketAdapter.subscribe('content:updates', async (message) => {
        if (message.type === 'post_created' || message.type === 'post_deleted') {
            await cache.invalidate('dashboard:totalPosts')
            console.log('Content updated, refreshing post count')
        }
    })
}

// Fetch live dashboard data
const getLiveDashboardData = async (): Promise<Either<any, DashboardData>> => {
    const [metricsResult, usersResult, postsResult] = await Promise.all([
        dataManager.query<any>('dashboard:metrics')
            .staleTime(5000)
            .fetch(async () => {
                const response = await fetch('/api/dashboard/metrics')
                return response.ok ? success(await response.json()) : error(new NetworkError('Metrics fetch failed'))
            }),
        
        dataManager.query<number>('dashboard:activeUsers')
            .staleTime(30000)
            .fetch(async () => {
                const response = await fetch('/api/dashboard/active-users')
                return response.ok ? success(await response.json()) : error(new NetworkError('Active users fetch failed'))
            }),
        
        dataManager.query<number>('dashboard:totalPosts')
            .staleTime(60000)
            .fetch(async () => {
                const response = await fetch('/api/dashboard/total-posts')
                return response.ok ? success(await response.json()) : error(new NetworkError('Total posts fetch failed'))
            })
    ])

    if (metricsResult.error || usersResult.error || postsResult.error) {
        return error(new DataManagerError('Failed to fetch dashboard data'))
    }

    return success({
        activeUsers: usersResult.data,
        totalPosts: postsResult.data,
        systemHealth: metricsResult.data.health
    })
}
```

## Error Handling and Cleanup

```typescript
// Proper cleanup when component/app unmounts
const cleanup = async () => {
    console.log('Cleaning up WebSocket connections...')
    
    // Stop cache invalidation
    await invalidationManager.stop()
    
    // Unsubscribe from all channels
    await websocketAdapter.unsubscribe('users:updates')
    await websocketAdapter.unsubscribe('system:metrics')
    await websocketAdapter.unsubscribe('users:activity')
    await websocketAdapter.unsubscribe('content:updates')
    
    // Disconnect WebSocket
    await websocketAdapter.disconnect()
    
    console.log('Cleanup completed')
}

// Error handling
const handleWebSocketError = (error: any) => {
    console.error('WebSocket error:', error)
    
    // Implement fallback behavior
    // For example, switch to polling mode
    const pollForUpdates = setInterval(async () => {
        // Invalidate cache periodically as fallback
        await cache.invalidate('user:*')
        await cache.invalidate('dashboard:*')
    }, 30000)
    
    // Try to reconnect after 5 seconds
    setTimeout(() => {
        websocketAdapter.connect()
    }, 5000)
}

// Monitor connection state
setInterval(() => {
    const state = websocketAdapter.getState()
    const stats = websocketAdapter.getStats()
    
    console.log('WebSocket Status:', {
        state,
        stats,
        invalidationStatus: invalidationManager.getStatus()
    })
}, 10000)
```

## Usage with Vue.js

```typescript
// Vue composable for WebSocket integration
import { ref, onMounted, onUnmounted } from 'vue'

export const useRealTimeUser = (userId: number) => {
    const user = ref<User | null>(null)
    const isLoading = ref(false)
    const error = ref<string | null>(null)

    const fetchUser = async () => {
        isLoading.value = true
        error.value = null

        const result = await getUserWithRealTimeUpdates(userId)
        
        if (result.error) {
            error.value = result.error.message
        } else {
            user.value = result.data
        }
        
        isLoading.value = false
    }

    const updateUser = async (updates: Partial<User>) => {
        const result = await updateUserWithNotification(userId, updates)
        
        if (result.error) {
            error.value = result.error.message
        } else {
            user.value = result.data
        }
    }

    onMounted(async () => {
        await setupRealTimeUpdates()
        await fetchUser()
    })

    onUnmounted(async () => {
        await cleanup()
    })

    return {
        user: readonly(user),
        isLoading: readonly(isLoading),
        error: readonly(error),
        updateUser,
        refetch: fetchUser
    }
}
```

## Configuration Options

The WebSocket adapter supports extensive configuration:

```typescript
const advancedConfig = {
    url: 'wss://api.example.com/ws',
    protocols: ['ra-ts', 'v1'],
    
    // Reconnection with exponential backoff
    reconnection: {
        enabled: true,
        maxAttempts: 10,
        baseDelay: 1000,      // Start with 1 second
        maxDelay: 60000,      // Cap at 1 minute
        backoffFactor: 1.5    // Multiply delay by 1.5 each attempt
    },
    
    // Heartbeat to detect dead connections
    heartbeat: {
        enabled: true,
        interval: 30000,      // Send ping every 30 seconds
        timeout: 10000,       // Expect pong within 10 seconds
        pingMessage: { type: 'ping', timestamp: Date.now() },
        pongMessage: { type: 'pong' }
    },
    
    connectionTimeout: 15000, // Connection must establish within 15 seconds
    maxQueueSize: 500,        // Queue up to 500 messages when offline
    
    logger: new ConsoleLogger()
}
```

This example demonstrates the complete WebSocket integration workflow, from basic setup to advanced real-time features with proper error handling and cleanup. 