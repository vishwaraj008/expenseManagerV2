// lib/redis.js
import { Redis } from '@upstash/redis';

// Create Redis instance with optimized settings for serverless
export const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
  retry: {
    retries: 2,
    backoff: (retryCount) => Math.exp(retryCount) * 50,
  },
  keepAlive: false, // Important for serverless
});

// Helper functions for Redis operations with error handling
export async function getConfig() {
  try {
    const config = await redis.json.get('config');
    return config || {};
  } catch (error) {
    console.error('Redis get config error:', error);
    // Return default config if Redis fails
    return 
  }
}

export async function getUserData(userId) {
  try {
    const userKey = `user:${userId}`;
    const userData = await redis.json.get(userKey);
    return userData || {};
  } catch (error) {
    console.error('Redis get user data error:', error);
    return {};
  }
}

export async function setUserData(userId, data) {
  try {
    const userKey = `user:${userId}`;
    await redis.json.set(userKey, '$', data);
    return true;
  } catch (error) {
    console.error('Redis set user data error:', error);
    return false;
  }
}

export async function resetUserData(userId) {
  try {
    const userKey = `user:${userId}`;
    await redis.json.set(userKey, '$', {});
    return true;
  } catch (error) {
    console.error('Redis reset user data error:', error);
    return false;
  }
}

// Initialize default config if not exists
export async function initializeConfig() {
  try {
    const existingConfig = await redis.json.get('config');
    if (!existingConfig) {
      await redis.json.set('config', '$', {
        chai: 10,
        chips: 10,
        choti: 10,
        connect: 15,
        samosa: 15
      });
      console.log('Default config initialized');
    }
  } catch (error) {
    console.error('Redis config initialization error:', error);
  }
}
