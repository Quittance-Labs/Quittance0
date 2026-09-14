import Redis from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

export const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  lazyConnect: true,
  maxRetriesPerRequest: 1,
  retryStrategy(times) {
    if (process.env.NODE_ENV === 'test' || times > 1) {
      return null;
    }
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
});

redis.on('connect', () => {
  console.log('✅ Redis connected');
});

redis.on('error', (err) => {
  console.error('❌ Redis error:', err);
});

export function createRedisClient(): Redis {
  return redis;
}

export default redis;

