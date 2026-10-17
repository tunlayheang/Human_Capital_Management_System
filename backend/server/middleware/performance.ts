import { Request, Response, NextFunction } from 'express';
import { performance } from 'perf_hooks';

// Extend Request interface to include user
declare global {
  namespace Express {
    interface Request {
      user?: any;
    }
  }
}

// Simple in-memory cache for development
class MemoryCache {
  private cache = new Map<string, { data: any; expiry: number }>();
  
  set(key: string, data: any, ttl: number = 300000) { // 5 minutes default
    this.cache.set(key, { data, expiry: Date.now() + ttl });
  }
  
  get(key: string) {
    const item = this.cache.get(key);
    if (!item) return null;
    
    if (Date.now() > item.expiry) {
      this.cache.delete(key);
      return null;
    }
    
    return item.data;
  }
  
  delete(key: string) {
    this.cache.delete(key);
  }
  
  clear() {
    this.cache.clear();
  }

  /** Drop cached HTTP responses whose key contains a path fragment (e.g. `/departments`). */
  clearMatching(pathFragment: string) {
    const needle = pathFragment.toLowerCase();
    for (const key of this.cache.keys()) {
      if (key.toLowerCase().includes(needle)) {
        this.cache.delete(key);
      }
    }
  }
}

export const cache = new MemoryCache();

// Cache middleware
export const cacheMiddleware = (ttl: number = 300000) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = `${req.method}:${req.originalUrl}:${req.user?.id || 'anonymous'}`;
    
    const cached = cache.get(key);
    if (cached) {
      res.set('X-Cache', 'HIT');
      return res.json(cached);
    }
    
    // Override res.json to cache the response
    const originalJson = res.json;
    res.json = function(data: any) {
      cache.set(key, data, ttl);
      res.set('X-Cache', 'MISS');
      return originalJson.call(this, data);
    };
    
    next();
  };
};

// Performance monitoring middleware
export const performanceMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const start = performance.now();
  
  res.on('finish', () => {
    const duration = performance.now() - start;
    
    // Log slow queries (>500ms)
    if (duration > 500) {
      console.warn(`🐌 Slow request: ${req.method} ${req.originalUrl} - ${duration.toFixed(2)}ms`);
    }
    
    // Log database queries if available
    if ((req as any).sqlQueries) {
      const totalSqlTime = (req as any).sqlQueries.reduce((sum: number, query: any) => sum + (query.duration || 0), 0);
      if (totalSqlTime > 100) {
        console.warn(`🗄️  Slow SQL: ${totalSqlTime.toFixed(2)}ms for ${(req as any).sqlQueries.length} queries`);
      }
    }
  });
  
  next();
};

// Database query optimization helper
export const optimizeQuery = {
  // Batch operations
  bulkCreate: async (model: any, records: any[], options: any = {}) => {
    return await model.bulkCreate(records, {
      ...options,
      validate: false, // Skip validation for performance
      logging: false,  // Disable logging for bulk operations
      ...options
    });
  },
  
  // Optimized find with pagination
  findWithPagination: async (model: any, where: any = {}, page: number = 1, limit: number = 20) => {
    const offset = (page - 1) * limit;
    
    const [rows, total] = await Promise.all([
      model.findAll({
        where,
        limit,
        offset,
        logging: false
      }),
      model.count({ where, logging: false })
    ]);
    
    return {
      rows,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    };
  },
  
  // Cached count query
  cachedCount: async (model: any, where: any = {}, ttl: number = 60000) => {
    const key = `count:${model.name}:${JSON.stringify(where)}`;
    
    let count = cache.get(key);
    if (count === null) {
      count = await model.count({ where, logging: false });
      cache.set(key, count, ttl);
    }
    
    return count;
  }
};

// Connection pool monitoring
export const monitorPool = (sequelize: any) => {
  const pool = sequelize.connectionManager.pool;
  
  setInterval(() => {
    const usage = {
      total: pool.numUsed + pool.numFree,
      active: pool.numUsed,
      idle: pool.numFree,
      waiting: pool.numPendingAcquires
    };
    
    // Alert if pool is under pressure
    if (usage.waiting > 0 || usage.active / usage.total > 0.8) {
      console.warn('🔥 Database pool under pressure:', usage);
    }
  }, 30000); // Check every 30 seconds
};
