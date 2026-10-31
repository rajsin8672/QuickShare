import { createClient } from '@supabase/supabase-js';
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

  async createSignedUrl(storagePath, expiresInSeconds = 60) {
    // In local mode, return a local API endpoint URL relative to the server
    return `/api/storage/local-download?path=${encodeURIComponent(storagePath)}`;
  }

  async getFileBuffer(storagePath) {
    const fullPath = this.getFilePath(storagePath);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`File not found at storage path: ${storagePath}`);
    }
    return await fs.promises.readFile(fullPath);
  }

  async getFileStream(storagePath) {
    const fullPath = this.getFilePath(storagePath);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`File not found at storage path: ${storagePath}`);
    }
    return fs.createReadStream(fullPath);
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

  async createSignedUrl(storagePath, expiresInSeconds = 60) {
    const { data, error } = await this.client.storage
      .from(this.bucketName)
      .createSignedUrl(storagePath, expiresInSeconds);

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

  async getFileStream(storagePath) {
    const buffer = await this.getFileBuffer(storagePath);
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

if (config.supabase.isConfigured) {
  try {
    const supabaseClient = createClient(
      config.supabase.url,
      config.supabase.serviceRoleKey,
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
 * Generate a safe internal storage path for an uploaded file
 * @param {string} shareId 
 * @param {string} fileId 
 * @param {string} originalFilename 
 * @returns {string} Safe storage path
 */
export function buildStoragePath(shareId, fileId, originalFilename) {
  const safeName = sanitizeFilename(originalFilename);
  return `shares/${shareId}/${fileId}-${safeName}`;
}

export const storage = storageInstance;
export { LocalStorageService, SupabaseStorageService };
