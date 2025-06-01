# Ra-ts Documentation

**Ra-ts** - A powerful, type-safe data management library with caching, queuing, rate limiting, and advanced request handling capabilities.

Ra-ts provides a robust foundation for managing data in modern applications with type safety, performance, and developer experience in mind. The modular adapter system allows you to customize behavior for your specific needs while maintaining a consistent API across your application. 

## Table of Contents

- [Overview](#overview)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Core Concepts](#core-concepts)
- [API Reference](#api-reference)
- [Examples](#examples)
- [Adapters](#adapters)
- [Advanced Usage](#advanced-usage)
- [Error Handling](#error-handling)
- [Best Practices](#best-practices)

## Overview

Ra-ts is a comprehensive data management solution that provides:

- **Type-safe operations** with explicit error handling using Either types
- **Advanced caching** with multiple storage backends (Memory, IndexedDB, LocalStorage)
- **Request deduplication** to prevent duplicate network calls
- **Rate limiting** with multiple strategies (Token Bucket, Concurrency, Adaptive)
- **Optimistic updates** for better UX
- **Queue management** for offline/background operations
- **Data validation** and sanitization
- **Monitoring and logging** capabilities
- **Encryption support** for sensitive data

## Installation

```bash
npm install ra-ts
# or
pnpm add ra-ts
# or
yarn add ra-ts
```

### Peer Dependencies

For validation and security features:

```bash
npm install validator isomorphic-dompurify
```

## Quick Start

```typescript
import { DataManager, MemoryCache, ConsoleLogger } from 'ra-ts'

// Create a DataManager instance
const dataManager = new DataManager({
  cache: new MemoryCache({ maxSize: 500 }),
  logger: new ConsoleLogger(),
  defaultTTL: 300000, // 5 minutes
  enableOptimisticUpdates: true
})

// Fetch user data with caching
const fetchUser = async (userId: number) => {
  return dataManager
    .query<User>(`user:${userId}`)
    .staleTime(60000)  // Consider stale after 1 minute
    .ttl(300000)       // Cache for 5 minutes
    .retries(3)        // Retry up to 3 times
    .fetch(async () => {
      const response = await fetch(`/api/users/${userId}`)
      if (!response.ok) {
        return error(new NetworkError('Failed to fetch user'))
      }
      const userData = await response.json()
      return success(userData)
    })
}

// Update user with optimistic updates
const updateUser = async (userId: number, userData: Partial<User>) => {
  return dataManager
    .mutate<User>(`user:${userId}`)
    .optimistic({ ...currentUser, ...userData })  // Show immediately
    .invalidates('user:*', 'users:list')          // Clear related cache
    .retries(2)
    .execute(async () => {
      const response = await fetch(`/api/users/${userId}`, {
        method: 'PATCH',
        body: JSON.stringify(userData),
        headers: { 'Content-Type': 'application/json' }
      })
      
      if (!response.ok) {
        return error(new NetworkError('Failed to update user'))
      }
      
      const updatedUser = await response.json()
      return success(updatedUser)
    })
}
```

## Core Concepts

### Either Type System

Ra-ts uses explicit error handling with Either types instead of throwing exceptions:

```typescript
import { Either, success, error, isSuccess, isError } from 'ra-ts'

// Function returns Either<ErrorType, SuccessType>
const fetchData = async (): Promise<Either<NetworkError, User>> => {
  try {
    const response = await fetch('/api/user')
    if (!response.ok) {
      return error(new NetworkError('Request failed'))
    }
    const user = await response.json()
    return success(user)
  } catch (err) {
    return error(new NetworkError('Network error'))
  }
}

// Handle the result
const result = await fetchData()
if (isSuccess(result)) {
  console.log('User:', result.data)
} else {
  console.error('Error:', result.error.message)
}
```

### Builder Pattern

Fluent API for configuring queries and mutations:

```typescript
// Query builder
const userQuery = dataManager
  .query<User>('user:123')
  .staleTime(30000)      // Stale after 30 seconds
  .ttl(600000)           // Cache for 10 minutes
  .retries(3)            // Retry failed requests
  .sanitize()            // Enable data sanitization
  .validate(userSchema)  // Validate with schema

// Mutation builder
const userMutation = dataManager
  .mutate<User>('user:123')
  .optimistic(optimisticData)
  .invalidates('user:*', 'profile:*')
  .ttl(300000)
  .validate(userSchema)
```

## API Reference

### DataManager

The main class that coordinates all operations.

#### Constructor

```typescript
const dataManager = new DataManager(config?: DataManagerConfig)
```

**DataManagerConfig:**
```typescript
type DataManagerConfig = {
  cache?: CacheAdapter
  queue?: QueueAdapter
  rateLimiter?: RateLimiter
  logger?: Logger
  monitor?: Monitor
  securityValidator?: Validator
  defaultTTL?: number
  enableOptimisticUpdates?: boolean
  enableSanitization?: boolean
}
```

#### Methods

##### `query<T>(key: string): QueryBuilder<T>`

Creates a query builder for the given cache key.

##### `mutate<T>(key: string): MutationBuilder<T>`

Creates a mutation builder for the given cache key.

### QueryBuilder

Fluent interface for configuring data fetching operations.

#### Methods

##### `staleTime(ms: number): this`
Sets how long cached data is considered fresh.

##### `ttl(ms: number): this`
Sets cache time-to-live.

##### `retries(count: number): this`
Sets maximum retry attempts.

##### `validate<S>(schema: Validator<S>): QueryBuilder<S>`
Adds schema validation.

##### `sanitize(): this` / `skipSanitization(): this`
Controls data sanitization.

##### `fetch(fetcher: () => Promise<Either<any, T>>): Promise<Either<any, T>>`
Executes the query with configured options.

### MutationBuilder

Fluent interface for configuring data modification operations.

#### Methods

##### `optimistic(data: T): this`
Sets optimistic update data to show immediately.

##### `invalidates(...patterns: string[]): this`
Cache patterns to clear after successful mutation.

##### `retries(count: number): this`
Sets maximum retry attempts.

##### `ttl(ms: number): this`
Sets TTL for mutation result.

##### `validate<S>(schema: Validator<S>): MutationBuilder<S>`
Adds schema validation.

##### `execute(mutator: () => Promise<Either<any, T>>): Promise<Either<any, T>>`
Executes the mutation with configured options.

## Examples

### Basic Data Fetching

```typescript
import { DataManager, MemoryCache, success, error } from 'ra-ts'

const dm = new DataManager({
  cache: new MemoryCache({ maxSize: 100 })
})

interface User {
  id: number
  name: string
  email: string
}

// Simple fetch with caching
const getUser = async (id: number): Promise<Either<any, User>> => {
  return dm.query<User>(`user:${id}`)
    .staleTime(60000)
    .fetch(async () => {
      const response = await fetch(`/api/users/${id}`)
      if (!response.ok) {
        return error(new Error('Failed to fetch user'))
      }
      const user = await response.json()
      return success(user)
    })
}
```

### Data Validation with Zod

```typescript
import { z } from 'zod'

const userSchema = {
  parse: (data: unknown) => {
    const schema = z.object({
      id: z.number(),
      name: z.string().min(1),
      email: z.string().email()
    })
    
    try {
      const validated = schema.parse(data)
      return success(validated)
    } catch (err) {
      return error(new ValidationError('Invalid user data', err))
    }
  },
  safeParse: function(data: unknown) { return this.parse(data) }
}

const getValidatedUser = async (id: number) => {
  return dm.query<User>(`user:${id}`)
    .validate(userSchema)
    .fetch(fetchUserData)
}
```

### Optimistic Updates

```typescript
const updateUserProfile = async (
  userId: number, 
  updates: Partial<User>
): Promise<Either<any, User>> => {
  const currentUser = await getCurrentUser(userId)
  
  if (isError(currentUser)) {
    return currentUser
  }

  const optimisticUser = { ...currentUser.data, ...updates }

  return dm.mutate<User>(`user:${userId}`)
    .optimistic(optimisticUser)
    .invalidates('user:*', 'profile:*')
    .execute(async () => {
      const response = await fetch(`/api/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      })

      if (!response.ok) {
        return error(new NetworkError('Update failed'))
      }

      const updatedUser = await response.json()
      return success(updatedUser)
    })
}
```

### Batch Operations

```typescript
const getUsersWithPosts = async (userIds: number[]) => {
  const userPromises = userIds.map(id => 
    dm.query<User>(`user:${id}`)
      .staleTime(120000)
      .fetch(() => fetchUser(id))
  )

  const postPromises = userIds.map(id =>
    dm.query<Post[]>(`user:${id}:posts`)
      .staleTime(60000)
      .fetch(() => fetchUserPosts(id))
  )

  const [users, posts] = await Promise.all([
    Promise.all(userPromises),
    Promise.all(postPromises)
  ])

  // Handle results...
  return { users, posts }
}
```

### Error Recovery

```typescript
const robustDataFetch = async <T>(
  key: string,
  fetcher: () => Promise<Either<any, T>>,
  fallback?: T
): Promise<Either<any, T>> => {
  const result = await dm.query<T>(key)
    .retries(3)
    .staleTime(30000)
    .fetch(fetcher)

  if (isError(result) && fallback) {
    // Return fallback data if available
    return success(fallback)
  }

  return result
}
```

### Batch Loading with DataLoader

For efficient request batching and caching, use the DataLoader pattern:

```typescript
import { DataLoader, success, error, NetworkError } from 'ra-ts'

interface User {
  id: number
  name: string
  email: string
}

// Create a DataLoader for batching user requests
const userLoader = new DataLoader<number, User>({
  batchLoadFn: async (userIds: number[]) => {
    console.log('Batching user requests:', userIds)
    
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
  maxBatchSize: 25,        // Batch up to 25 requests
  batchDelay: 16,          // Wait 16ms before executing batch
  cache: true,             // Enable result caching
  cacheTTL: 300000,        // Cache for 5 minutes
  logger: new ConsoleLogger()
})

// Load individual users - requests will be automatically batched
const loadUser = async (userId: number) => {
  return userLoader.load(userId)
}

// Load multiple users efficiently
const loadUsers = async (userIds: number[]) => {
  return userLoader.loadMany(userIds)
}

// Usage example - these will be batched together
const getUsersExample = async () => {
  const users = await loadUsers([1,2,3])

  // or
  
  const [user1, user2, user3] = await Promise.all([
    loadUser(1),
    loadUser(2), 
    loadUser(3)
  ])
  
  // Get performance stats
  const stats = userLoader.getStats()
  console.log('Batch stats:', stats)
}
```

## Adapters

### Cache Adapters

#### MemoryCache

High-performance in-memory cache with LRU eviction:

```typescript
import { MemoryCache } from 'ra-ts'

const memoryCache = new MemoryCache({
  maxSize: 1000,           // Maximum entries
  defaultTTL: 300000,      // 5 minutes default TTL
  cleanupInterval: 60000   // Cleanup every minute
})

// Get cache statistics
const stats = memoryCache.getStats()
console.log('Cache size:', stats.size)
console.log('Expired entries:', stats.expiredCount)
```

#### IndexedDBCache

Browser persistent storage:

```typescript
import { IndexedDBCache } from 'ra-ts'

const indexedDBCache = new IndexedDBCache({
  dbName: 'MyAppCache',
  version: 1,
  defaultTTL: 86400000,    // 24 hours
  maxSize: 50 * 1024 * 1024, // 50MB
  compressionThreshold: 1024  // Compress data > 1KB
})
```

#### LocalStorageCache

Browser localStorage with quotas:

```typescript
import { LocalStorageCache } from 'ra-ts'

const localStorageCache = new LocalStorageCache({
  prefix: 'myapp:',
  defaultTTL: 3600000,     // 1 hour
  maxSize: 5 * 1024 * 1024, // 5MB quota
  compression: true
})
```

#### EncryptedCache

Encrypted storage for sensitive data:

```typescript
import { EncryptedCache, MemoryCache } from 'ra-ts'

const encryptedCache = new EncryptedCache({
  baseCache: new MemoryCache(),
  encryptionKey: 'your-32-char-encryption-key-here',
  algorithm: 'AES-GCM'
})
```

### Rate Limiters

#### TokenBucketLimiter

Classic token bucket algorithm:

```typescript
import { TokenBucketLimiter } from 'ra-ts'

const rateLimiter = new TokenBucketLimiter({
  capacity: 10,        // 10 tokens
  refillRate: 1,       // 1 token per second
  refillInterval: 1000 // Every 1000ms
})
```

#### ConcurrencyLimiter

Limits concurrent operations:

```typescript
import { ConcurrencyLimiter } from 'ra-ts'

const concurrencyLimiter = new ConcurrencyLimiter({
  maxConcurrent: 3,    // Max 3 simultaneous requests
  queueTimeout: 5000   // Queue timeout 5 seconds
})
```

#### AdaptiveRateLimiter

Adjusts limits based on success/failure rates:

```typescript
import { AdaptiveRateLimiter } from 'ra-ts'

const adaptiveLimiter = new AdaptiveRateLimiter({
  initialRate: 10,
  minRate: 1,
  maxRate: 50,
  adjustmentFactor: 0.1,
  windowSize: 100
})
```

### Queue Adapters

#### BrowserQueue

Queue for offline/background operations:

```typescript
import { BrowserQueue, JobStatus } from 'ra-ts'

const queue = new BrowserQueue({
  storage: 'indexeddb',
  maxRetries: 3,
  retryDelay: 1000,
  concurrency: 2
})

// Add job to queue
await queue.add({
  id: 'unique-job-id',
  type: 'api-call',
  payload: { method: 'POST', url: '/api/data', body: data },
  retries: 0,
  maxRetries: 3,
  createdAt: new Date()
})

// Process queued jobs
queue.process(async (job) => {
  // Handle job execution
  return success(result)
})

// Get queue statistics
const stats = await queue.getStats()
console.log('Pending jobs:', stats.pending)
console.log('Failed jobs:', stats.failed)
```

### Stream Adapters

#### WebSocketAdapter

Real-time data streaming with advanced reconnection and health monitoring:

```typescript
import { WebSocketAdapter, ConsoleLogger } from 'ra-ts'

const wsAdapter = new WebSocketAdapter({
  url: 'wss://api.example.com/realtime',
  protocols: ['protocol1', 'protocol2'],
  
  // Automatic reconnection with exponential backoff
  reconnection: {
    enabled: true,
    maxAttempts: 5,
    baseDelay: 1000,     // Start with 1 second
    maxDelay: 30000,     // Max 30 seconds
    backoffFactor: 2     // Double delay each attempt
  },
  
  // Health monitoring with ping/pong
  healthcheck: {
    enabled: true,
    interval: 30000,     // Ping every 30 seconds
    timeout: 5000,       // Expect pong within 5 seconds
    pingMessage: { type: 'ping' },
    pongMessage: { type: 'pong' }
  },
  
  connectionTimeout: 10000,  // 10 second connection timeout
  maxQueueSize: 100,         // Queue up to 100 messages when offline
  logger: new ConsoleLogger()
})

// Connect to WebSocket
const connectResult = await wsAdapter.connect()
if (connectResult.error) {
  console.error('Failed to connect:', connectResult.error)
}

// Subscribe to channels
await wsAdapter.subscribe('user-updates', async (message) => {
  console.log('User update received:', message.data)
  
  // Update cache based on real-time data
  await dataManager.mutate(`user:${message.data.userId}`)
    .optimistic(message.data)
    .execute(async () => success(message.data))
})

await wsAdapter.subscribe('notifications', async (message) => {
  console.log('New notification:', message.data)
  // Handle notifications
})

// Send messages
await wsAdapter.sendMessage({
  channel: 'user-actions',
  type: 'status-update',
  data: { status: 'online' },
  timestamp: new Date(),
  messageId: 'unique-id-123'
})

// Monitor connection stats
const stats = wsAdapter.getStats()
console.log('WebSocket stats:', {
  connectionCount: stats.connectionCount,
  messagesReceived: stats.messagesReceived,
  messagesSent: stats.messagesSent,
  subscriptionCount: stats.subscriptionCount
})

// Graceful disconnection
await wsAdapter.disconnect()
```

### Monitoring

#### ConsoleMonitor

Development monitoring with console output:

```typescript
import { ConsoleMonitor } from 'ra-ts'

const monitor = new ConsoleMonitor({
  enableTiming: true,
  enableEvents: true,
  enableMetrics: true,
  logLevel: 'debug'
})

const dm = new DataManager({ monitor })
```

#### PerformanceProfiler

Advanced performance profiling with detailed timing and memory analysis:

```typescript
import { PerformanceProfiler, ConsoleLogger } from 'ra-ts'

const profiler = new PerformanceProfiler({
  enabled: true,
  sampleRate: 0.1,        // Profile 10% of operations
  maxProfiles: 1000,      // Keep last 1000 profiles
  minDuration: 1,         // Only capture operations > 1ms
  memoryProfiling: true,  // Track memory usage
  logger: new ConsoleLogger()
})

// Manual profiling
const profileId = profiler.startProfile('user-fetch', { userId: 123 })
try {
  const user = await fetchUser(123)
  profiler.endProfile(profileId, { success: true, userType: user.type })
} catch (error) {
  profiler.endProfile(profileId, { success: false, error: error.message })
}

// Automatic function profiling
const fetchUserProfiled = async (userId: number) => {
  return profiler.profileFunction(
    'fetch-user-operation',
    async () => {
      const response = await fetch(`/api/users/${userId}`)
      const user = await response.json()
      return user
    },
    { userId, operation: 'api-fetch' }
  )
}

// Get performance statistics
const stats = profiler.getStats()
console.log('Performance Stats:', {
  totalProfiles: stats.totalProfiles,
  averageDuration: stats.averageDuration,
  p95Duration: stats.p95Duration,
  p99Duration: stats.p99Duration,
  memoryStats: stats.memoryStats
})

// Find slow operations
const slowOps = profiler.getSlowOperations(100) // Operations > 100ms
console.log('Slow operations:', slowOps)

// Generate detailed report
console.log(profiler.generateReport())

// Use with DataManager for automatic profiling
const profiledDataManager = new DataManager({
  cache: new MemoryCache(),
  monitor: {
    track: (event, data) => profiler.startProfile(event, data),
    startTimer: (name) => {
      const profileId = profiler.startProfile(name)
      return () => profiler.endProfile(profileId)
    },
    recordMetric: (name, value) => {
      // Custom metric recording
      console.log(`Metric ${name}:`, value)
    }
  }
})
```

#### TelemetryMonitor

OpenTelemetry-compatible monitoring with distributed tracing:

```typescript
import { TelemetryMonitor, ConsoleLogger } from 'ra-ts'

const telemetry = new TelemetryMonitor({
  tracing: true,
  metrics: true,
  logs: true,
  serviceName: 'my-app',
  serviceVersion: '1.0.0',
  sampleRate: 1.0,        // Trace 100% of operations
  
  // Export callback for external telemetry systems
  onExport: (data) => {
    console.log('Telemetry export:', data)
    // Send to external systems like Jaeger, Zipkin, etc.
  },
  
  // Global attributes for all spans
  attributes: {
    environment: 'production',
    datacenter: 'us-east-1'
  },
  
  logger: new ConsoleLogger()
})

// Manual span creation
const span = telemetry.createSpan('user-operation')
telemetry.setActiveSpan(span)

// Add attributes and events to spans
telemetry.addSpanAttributes(span.spanId, { userId: 123, operation: 'fetch' })
telemetry.addSpanEvent(span.spanId, 'cache-miss', { cacheKey: 'user:123' })

// Finish the span
telemetry.finishSpan(span, { result: 'success' })

// Traced operations with automatic span management
const result = await telemetry.withTrace(
  'complex-user-operation',
  async (span) => {
    // This code runs within a traced span
    const user = await fetchUser(123)
    
    // Add attributes based on result
    telemetry.addSpanAttributes(span.spanId, {
      userId: user.id,
      userType: user.type,
      hasPermissions: user.permissions.length > 0
    })
    
    const posts = await fetchUserPosts(user.id)
    telemetry.addSpanEvent(span.spanId, 'posts-loaded', { count: posts.length })
    
    return { user, posts }
  },
  { operationType: 'user-dashboard' }
)

// Record metrics
telemetry.recordMetric('api.requests', 1, { endpoint: '/users', method: 'GET' })
telemetry.recordMetric('cache.hit_rate', 0.85, { cache: 'user-cache' })

// Error tracking
try {
  await riskyOperation()
} catch (error) {
  telemetry.recordError(error, { operation: 'risky-operation', userId: 123 })
  throw error
}

// Health checks
telemetry.registerHealthCheck('database', async () => {
  try {
    await database.ping()
    return { status: 'pass', message: 'Database connection healthy' }
  } catch (error) {
    return { status: 'fail', message: 'Database connection failed', details: error }
  }
})

telemetry.registerHealthCheck('cache', async () => {
  const hitRate = cache.getHitRate()
  return {
    status: hitRate > 0.7 ? 'pass' : 'warn',
    message: `Cache hit rate: ${(hitRate * 100).toFixed(1)}%`,
    details: { hitRate }
  }
})

// Execute health checks
const health = await telemetry.executeHealthChecks()
console.log('Health status:', health)

// Use with DataManager for automatic tracing
const tracedDataManager = new DataManager({
  cache: new MemoryCache(),
  monitor: telemetry
})

// Get telemetry statistics
const telemetryStats = telemetry.getStats()
console.log('Telemetry stats:', telemetryStats)
```

### Security

#### SecurityValidator

Data validation and sanitization:

```typescript
import { SecurityValidator } from 'ra-ts'

const securityValidator = new SecurityValidator({
  enableSanitization: true,
  enableValidation: true,
  maxStringLength: 10000,
  allowedTags: ['b', 'i', 'em', 'strong'],
  strictMode: true
})

const dm = new DataManager({
  securityValidator,
  enableSanitization: true
})
```

## Advanced Usage

### Custom Cache Implementation

```typescript
import type { CacheAdapter, Either } from 'ra-ts'
import { success, error, CacheError } from 'ra-ts'

class CustomCache implements CacheAdapter {
  private store = new Map<string, any>()

  async get<T>(key: string): Promise<Either<CacheError, T | undefined>> {
    try {
      const value = this.store.get(key)
      return success(value)
    } catch (err) {
      return error(new CacheError('Get failed', { key, err }))
    }
  }

  async set<T>(key: string, value: T, ttl?: number): Promise<Either<CacheError, void>> {
    try {
      this.store.set(key, value)
      // Handle TTL logic...
      return success(undefined)
    } catch (err) {
      return error(new CacheError('Set failed', { key, err }))
    }
  }

  async delete(key: string): Promise<Either<CacheError, void>> {
    try {
      this.store.delete(key)
      return success(undefined)
    } catch (err) {
      return error(new CacheError('Delete failed', { key, err }))
    }
  }

  async clear(): Promise<Either<CacheError, void>> {
    try {
      this.store.clear()
      return success(undefined)
    } catch (err) {
      return error(new CacheError('Clear failed', { err }))
    }
  }

  async invalidate(pattern: string): Promise<Either<CacheError, void>> {
    try {
      // Implement pattern matching...
      return success(undefined)
    } catch (err) {
      return error(new CacheError('Invalidate failed', { pattern, err }))
    }
  }
}
```

### Multiple DataManager Instances

```typescript
// API client with aggressive caching
const apiClient = new DataManager({
  cache: new IndexedDBCache({ defaultTTL: 3600000 }),
  rateLimiter: new TokenBucketLimiter({ capacity: 20, refillRate: 2 }),
  logger: new ConsoleLogger()
})

// Real-time data with minimal caching
const realtimeClient = new DataManager({
  cache: new MemoryCache({ maxSize: 50, defaultTTL: 5000 }),
  rateLimiter: new ConcurrencyLimiter({ maxConcurrent: 10 }),
  enableOptimisticUpdates: false
})

// Background sync with queue
const syncClient = new DataManager({
  queue: new BrowserQueue({ storage: 'indexeddb' }),
  rateLimiter: new AdaptiveRateLimiter({ initialRate: 5 })
})
```

### Complex Data Dependencies

```typescript
const getUserDashboard = async (userId: number) => {
  // Fetch user profile
  const userResult = await dm.query<User>(`user:${userId}`)
    .staleTime(300000)
    .fetch(() => fetchUser(userId))

  if (isError(userResult)) {
    return userResult
  }

  const user = userResult.data

  // Fetch user's data in parallel
  const [postsResult, settingsResult, notificationsResult] = await Promise.all([
    dm.query<Post[]>(`user:${userId}:posts`)
      .staleTime(60000)
      .fetch(() => fetchUserPosts(userId)),
    
    dm.query<Settings>(`user:${userId}:settings`)
      .staleTime(600000)
      .fetch(() => fetchUserSettings(userId)),
    
    dm.query<Notification[]>(`user:${userId}:notifications`)
      .staleTime(30000)
      .fetch(() => fetchUserNotifications(userId))
  ])

  // Handle any errors
  if (isError(postsResult)) return postsResult
  if (isError(settingsResult)) return settingsResult
  if (isError(notificationsResult)) return notificationsResult

  return success({
    user,
    posts: postsResult.data,
    settings: settingsResult.data,
    notifications: notificationsResult.data
  })
}
```

## Error Handling

### Error Types

Ra-ts provides specific error types for different scenarios:

```typescript
import {
  DataManagerError,
  ValidationError,
  NetworkError,
  CacheError,
  RateLimitError,
  QueueError
} from 'ra-ts'

const handleError = (error: any) => {
  if (error instanceof ValidationError) {
    console.error('Data validation failed:', error.message)
  } else if (error instanceof NetworkError) {
    console.error('Network request failed:', error.message)
  } else if (error instanceof CacheError) {
    console.error('Cache operation failed:', error.message)
  } else if (error instanceof RateLimitError) {
    console.error('Rate limit exceeded:', error.message)
  } else if (error instanceof QueueError) {
    console.error('Queue operation failed:', error.message)
  }
}
```

### Graceful Degradation

```typescript
const getDataWithFallback = async <T>(
  key: string,
  fetcher: () => Promise<Either<any, T>>,
  fallbackFetcher?: () => Promise<Either<any, T>>
): Promise<Either<any, T>> => {
  
  // Try primary data source
  const result = await dm.query<T>(key)
    .retries(2)
    .fetch(fetcher)

  if (isSuccess(result)) {
    return result
  }

  // Try fallback if available
  if (fallbackFetcher) {
    console.warn(`Primary fetch failed for ${key}, trying fallback`)
    return dm.query<T>(`${key}:fallback`)
      .retries(1)
      .fetch(fallbackFetcher)
  }

  return result
}
```

## Best Practices

### 1. Cache Key Strategy

Use consistent, hierarchical cache keys:

```typescript
// Good
const keys = {
  user: (id: number) => `user:${id}`,
  userPosts: (id: number) => `user:${id}:posts`,
  userSettings: (id: number) => `user:${id}:settings`,
  postComments: (postId: number) => `post:${postId}:comments`
}

// Invalidation patterns
await dm.mutate('user:123')
  .invalidates('user:123:*') // Invalidates all user sub-resources
  .execute(updateUser)
```

### 2. Error Boundaries

Wrap operations in try-catch for unexpected errors:

```typescript
const safeQuery = async <T>(
  key: string,
  fetcher: () => Promise<Either<any, T>>
): Promise<Either<any, T>> => {
  try {
    return await dm.query<T>(key).fetch(fetcher)
  } catch (unexpectedError) {
    console.error('Unexpected error:', unexpectedError)
    return error(new DataManagerError(
      'Unexpected error occurred',
      'UNEXPECTED_ERROR',
      { key, error: unexpectedError }
    ))
  }
}
```

### 3. Resource Management

Clean up resources when done:

```typescript
// Clean up cache periodically
const cleanupCache = async () => {
  if (dm._cache && 'cleanup' in dm._cache) {
    const removed = await dm._cache.cleanup()
    console.log(`Cleaned up ${removed} expired entries`)
  }
}

// Run cleanup every 10 minutes
setInterval(cleanupCache, 600000)
```

### 4. Type Safety

Use proper TypeScript types:

```typescript
interface ApiResponse<T> {
  data: T
  status: 'success' | 'error'
  message?: string
}

const fetchTypedData = async <T>(
  endpoint: string
): Promise<Either<NetworkError, T>> => {
  const response = await fetch(endpoint)
  
  if (!response.ok) {
    return error(new NetworkError(`HTTP ${response.status}`))
  }

  const apiResponse: ApiResponse<T> = await response.json()
  
  if (apiResponse.status === 'error') {
    return error(new NetworkError(apiResponse.message || 'API error'))
  }

  return success(apiResponse.data)
}
```

### 5. Performance Optimization

Configure appropriate cache sizes and TTLs:

```typescript
// For frequently accessed, stable data
const staticDataManager = new DataManager({
  cache: new IndexedDBCache({
    defaultTTL: 86400000, // 24 hours
    maxSize: 100 * 1024 * 1024 // 100MB
  })
})

// For real-time, frequently changing data
const realtimeDataManager = new DataManager({
  cache: new MemoryCache({
    defaultTTL: 30000, // 30 seconds
    maxSize: 100
  }),
  enableOptimisticUpdates: true
})
```