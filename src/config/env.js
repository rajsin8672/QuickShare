import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from .env file
dotenv.config();

const nodeEnv = process.env.NODE_ENV || 'development';
const isProd = nodeEnv === 'production';

// Validate and parse environment variables
export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv,
  isProd,

  // Supabase Configuration
  supabase: {
    url: process.env.SUPABASE_URL || '',
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
    bucketName: process.env.SUPABASE_BUCKET_NAME || 'shared-files',
    isConfigured: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
  },

  // Security Secrets
  shareTokenSecret: process.env.SHARE_TOKEN_SECRET || 'quickshare_default_secret_key_change_in_production_32chars',

  // Upload limits
  maxFileSize: parseInt(process.env.MAX_FILE_SIZE_BYTES || '26214400', 10), // 25 MB
  maxTotalSize: parseInt(process.env.MAX_TOTAL_SIZE_BYTES || '52428800', 10), // 50 MB
  maxFileCount: parseInt(process.env.MAX_FILE_COUNT || '10', 10), // 10 files

  // Expiration & Cleanup
  defaultExpiryMinutes: parseInt(process.env.DEFAULT_EXPIRY_MINUTES || '30', 10),
  cleanupIntervalMinutes: parseInt(process.env.CLEANUP_INTERVAL_MINUTES || '15', 10),

  // Rate Limiting
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10), // 15 mins
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '200', 10),
    codeGuessMax: parseInt(process.env.RATE_LIMIT_CODE_GUESS_MAX || '25', 10),
    uploadMax: parseInt(process.env.RATE_LIMIT_UPLOAD_MAX || '30', 10)
  },

  // CORS
  allowedOrigins: process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
    : ['http://localhost:3000', 'http://127.0.0.1:3000']
};

// Startup validation warnings/logging
export function validateEnv() {
  if (config.isProd) {
    if (!config.supabase.isConfigured) {
      console.warn('⚠️ [Config] SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not set. The app will run in fallback local storage mode.');
    }
    if (config.shareTokenSecret.length < 32) {
      console.warn('⚠️ [Config] SHARE_TOKEN_SECRET should be at least 32 characters long for production security.');
    }
  } else {
    if (!config.supabase.isConfigured) {
      console.log('ℹ️ [Config] Running in local/offline storage mode (no Supabase credentials provided).');
    } else {
      console.log('✅ [Config] Supabase credentials loaded.');
    }
  }
}

