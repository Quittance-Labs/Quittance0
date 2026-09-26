import Redis from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

function buildRedisClient(): Redis {
  const client = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    retryStrategy(times) {
      if (process.env.NODE_ENV === 'test' || times > 1) return null;
      return Math.min(times * 50, 200);
    },
  });

  client.on('connect', () => {
    console.log('✅ Redis connected');
  });

  client.on('error', (err) => {
    console.error('❌ Redis error:', err);
  });

  return client;
}

export async function createRedisClient(): Promise<Redis> {
  const client = buildRedisClient();
  try {
    await client.connect();
    return client;
  } catch (error) {
    client.disconnect(false);
    throw error;
  }
}

export const redis = buildRedisClient();
export default redis;
