import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from .env file
dotenv.config();

const nodeEnv = process.env.NODE_ENV || 'development';
const isProd = nodeEnv === 'production';

// Inspect modern (sb_...) and legacy JWT keys safely without logging token contents
export function inspectKeyRole(key) {
  if (!key || typeof key !== 'string') return 'none';
  const trimmed = key.trim();
  if (trimmed === 'YOUR_COPIED_PUBLISHABLE_KEY' || trimmed.startsWith('YOUR_COPIED_') || trimmed.startsWith('YOUR_')) {
    return 'placeholder';
  }
  // Modern Supabase API key prefixes
  if (trimmed.startsWith('sb_secret_')) {
    return 'secret';
  }
  if (trimmed.startsWith('sb_publishable_')) {
    return 'publishable';
  }
  // Legacy Supabase JWT tokens
  const parts = trimmed.split('.');
  if (parts.length === 3) {
    try {
      const payloadStr = Buffer.from(parts[1], 'base64').toString('utf8');
      const payload = JSON.parse(payloadStr);
      if (payload && payload.role) {
        return payload.role; // e.g. 'service_role' or 'anon'
      }
    } catch (_) {
      // not a standard JWT payload
    }
  }
  return 'custom';
}

export function isPrivilegedRole(role) {
  return role === 'secret' || role === 'service_role';
}

const supabaseUrl = (process.env.SUPABASE_URL || '').trim();
// Support modern SUPABASE_SECRET_KEY as well as legacy SUPABASE_SERVICE_ROLE_KEY
const supabaseSecretKey = (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
// Support modern SUPABASE_PUBLISHABLE_KEY as well as legacy SUPABASE_ANON_KEY / SUPABASE_KEY
const supabasePublishableKey = (process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY || '').trim();

// The backend server prioritizes the privileged secret key for server-side database and storage operations
const supabaseActiveKey = supabaseSecretKey || supabasePublishableKey;
const keyRole = inspectKeyRole(supabaseActiveKey);
const isKeyPlaceholder = keyRole === 'placeholder';
const isPrivileged = isPrivilegedRole(keyRole);

// Validate and parse environment variables
export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv,
  isProd,

  // Supabase Configuration
  supabase: {
    url: supabaseUrl,
    key: supabaseActiveKey,
    secretKey: supabaseSecretKey,
    serviceRoleKey: supabaseSecretKey, // backward compatibility
    publishableKey: supabasePublishableKey,
    bucketName: (process.env.SUPABASE_BUCKET_NAME || 'shared-files').trim(),
    keyRole,
    isPrivileged,
    isPlaceholder: isKeyPlaceholder,
    isConfigured: Boolean(supabaseUrl && supabaseActiveKey && !isKeyPlaceholder)
  },

  // Security Secrets
  shareTokenSecret: process.env.SHARE_TOKEN_SECRET || 'quickshare_default_secret_key_change_in_production_32chars',

  // Upload limits (Default: 50MB single file, 100MB total, up to 10 files)
  maxFileSize: parseInt(process.env.MAX_FILE_SIZE_BYTES || '52428800', 10), // 50 MB
  maxTotalSize: parseInt(process.env.MAX_TOTAL_SIZE_BYTES || '104857600', 10), // 100 MB
  maxFileCount: parseInt(process.env.MAX_FILE_COUNT || '10', 10), // 10 files

  // Site & Canonical URL for SEO
  siteUrl: (process.env.SITE_URL || process.env.CANONICAL_DOMAIN || '').replace(/\/+$/, ''),

  // Format configurations
  allowedImageFormats: (process.env.ALLOWED_IMAGE_FORMATS || 'jpg,jpeg,png,webp,gif').toLowerCase().split(',').map(s => s.trim()),
  allowedVideoFormats: (process.env.ALLOWED_VIDEO_FORMATS || 'mp4,webm,mov').toLowerCase().split(',').map(s => s.trim()),
  allowedDocFormats: (process.env.ALLOWED_DOC_FORMATS || 'pdf,txt,doc,docx').toLowerCase().split(',').map(s => s.trim()),

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

// Startup validation warnings/logging (never logs raw secret keys)
export function validateEnv() {
  if (config.isProd) {
    if (!config.supabase.isConfigured) {
      console.warn('⚠️ [Config] Supabase is not configured with valid credentials. The app will run in fallback local storage mode.');
    } else if (!config.supabase.isPrivileged) {
      console.warn('⚠️ [Config] SUPABASE_SECRET_KEY is not configured. Running with unprivileged publishable key; private database and storage access may be restricted by RLS.');
    }
    if (config.shareTokenSecret.length < 32) {
      console.warn('⚠️ [Config] SHARE_TOKEN_SECRET should be at least 32 characters long for production security.');
    }
  } else {
    if (config.supabase.isPlaceholder) {
      console.log('ℹ️ [Config] Supabase key is set to a placeholder string. Running in fallback local storage mode.');
    } else if (!config.supabase.isConfigured) {
      console.log('ℹ️ [Config] Running in local/offline storage mode (no Supabase credentials provided).');
    } else if (config.supabase.isPrivileged) {
      console.log(`✅ [Config] Supabase loaded with privileged ${config.supabase.keyRole.toUpperCase()} credentials.`);
    } else {
      console.log(`ℹ️ [Config] Supabase loaded with ${config.supabase.keyRole.toUpperCase()} credentials.`);
    }
  }
}

