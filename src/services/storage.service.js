import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { config } from '../config/env.js';
import { sanitizeFilename } from '../utils/validation.js';

// Local disk fallback storage for offline dev/tests
class LocalStorageService {
  constructor() {
    this.baseDir = path.resolve(process.cwd(), 'uploads', 'shared-files');
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
  }

  getFilePath(storagePath) {
    // Prevent directory traversal
    const safePath = path.normalize(storagePath).replace(/^(\.\.[\/\\])+/, '');
    return path.join(this.baseDir, safePath);
  }

  async uploadFile(storagePath, buffer, mimeType) {
    const fullPath = this.getFilePath(storagePath);
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    await fs.promises.writeFile(fullPath, buffer);
    return { path: storagePath, size: buffer.length };
  }

  async createSignedUrl(storagePath, expiresInSeconds = 60, downloadFilename = '') {
    // Generate an HMAC signed local URL valid for expiresInSeconds
    const expires = Math.floor(Date.now() / 1000) + expiresInSeconds;
    const dataToSign = `${storagePath}:${expires}`;
    const sig = crypto.createHmac('sha256', config.shareTokenSecret).update(dataToSign).digest('hex');
    const fnParam = downloadFilename ? `&filename=${encodeURIComponent(downloadFilename)}` : '';
    return `/api/shares/local-storage/download?path=${encodeURIComponent(storagePath)}&expires=${expires}&sig=${sig}${fnParam}`;
  }

  async getFileBuffer(storagePath) {
    const fullPath = this.getFilePath(storagePath);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`File not found at storage path: ${storagePath}`);
    }
    return await fs.promises.readFile(fullPath);
  }

  async getFileStream(storagePath, options = {}) {
    const fullPath = this.getFilePath(storagePath);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`File not found at storage path: ${storagePath}`);
    }
    return fs.createReadStream(fullPath, options);
  }

  async deleteFiles(storagePaths) {
    if (!storagePaths || storagePaths.length === 0) return;
    for (const sp of storagePaths) {
      try {
        const fullPath = this.getFilePath(sp);
        if (fs.existsSync(fullPath)) {
          await fs.promises.unlink(fullPath);
        }
      } catch (err) {
        console.warn(`[LocalStorage] Failed to delete file ${sp}:`, err.message);
      }
    }
  }
}

// Supabase Private Storage Service
class SupabaseStorageService {
  constructor(client, bucketName) {
    this.client = client;
    this.bucketName = bucketName;
  }

  async uploadFile(storagePath, buffer, mimeType) {
    const { data, error } = await this.client.storage
      .from(this.bucketName)
      .upload(storagePath, buffer, {
        contentType: mimeType,
        upsert: false
      });

    if (error) {
      throw new Error(`Supabase Storage upload error: ${error.message}`);
    }
    return data;
  }

  async createSignedUrl(storagePath, expiresInSeconds = 60, downloadFilename = '') {
    const options = downloadFilename ? { download: downloadFilename } : undefined;
    const { data, error } = await this.client.storage
      .from(this.bucketName)
      .createSignedUrl(storagePath, expiresInSeconds, options);

    if (error) {
      throw new Error(`Failed to generate signed download URL: ${error.message}`);
    }
    return data.signedUrl;
  }

  async getFileBuffer(storagePath) {
    const { data, error } = await this.client.storage
      .from(this.bucketName)
      .download(storagePath);

    if (error) {
      throw new Error(`Supabase Storage download error: ${error.message}`);
    }
    const arrayBuffer = await data.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  async getFileStream(storagePath, options = {}) {
    const buffer = await this.getFileBuffer(storagePath);
    if (typeof options.start === 'number' || typeof options.end === 'number') {
      const start = options.start || 0;
      const end = options.end !== undefined ? options.end + 1 : buffer.length;
      return Readable.from(buffer.subarray(start, end));
    }
    return Readable.from(buffer);
  }

  async deleteFiles(storagePaths) {
    if (!storagePaths || storagePaths.length === 0) return;
    const { data, error } = await this.client.storage
      .from(this.bucketName)
      .remove(storagePaths);

    if (error) {
      console.warn(`[SupabaseStorage] Error deleting files: ${error.message}`);
    }
    return data;
  }
}

// Instantiate storage service
let storageInstance;
const useLiveStorage = config.supabase.isConfigured && (process.env.NODE_ENV !== 'test' || process.env.TEST_LIVE_SUPABASE === 'true');

if (useLiveStorage) {
  try {
    const supabaseClient = createClient(
      config.supabase.url,
      config.supabase.key,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false
        }
      }
    );
    storageInstance = new SupabaseStorageService(supabaseClient, config.supabase.bucketName);
    console.log(`⚡ [Storage] Initialized with Supabase Storage bucket "${config.supabase.bucketName}".`);
  } catch (err) {
    console.warn('⚠️ [Storage] Failed to initialize Supabase storage client, using local storage fallback:', err.message);
    storageInstance = new LocalStorageService();
  }
} else {
  storageInstance = new LocalStorageService();
}

/**
 * Generate a safe internal storage path for an uploaded file in Supabase Storage or Local Storage.
 * Ensures all path segments contain only strict valid characters [a-zA-Z0-9_-] and lowercase ASCII extension.
 * Collision resistance is guaranteed by the UUIDs.
 * 
 * @param {string} shareId - Unique share identifier (UUID)
 * @param {string} fileId - Unique file identifier (UUID)
 * @param {string} [originalFilename] - Original filename to extract safe file extension from
 * @returns {string} Safe storage object key, e.g. "shares/<shareId>/<fileId>.png"
 */
export function buildStoragePath(shareId, fileId, originalFilename = '') {
  const cleanShareId = String(shareId || '').replace(/[^a-zA-Z0-9_-]/g, '') || crypto.randomUUID();
  const cleanFileId = String(fileId || '').replace(/[^a-zA-Z0-9_-]/g, '') || crypto.randomUUID();

  let safeExt = '';
  if (originalFilename && typeof originalFilename === 'string') {
    const rawExt = path.posix.extname(originalFilename.replace(/\\/g, '/')).toLowerCase();
    if (/^\.[a-z0-9]+$/.test(rawExt)) {
      safeExt = rawExt;
    }
  }

  return `shares/${cleanShareId}/${cleanFileId}${safeExt}`;
}

export const storage = storageInstance;
export { LocalStorageService, SupabaseStorageService };

