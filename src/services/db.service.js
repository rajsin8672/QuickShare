import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { config } from '../config/env.js';

// In-memory fallback database for local development / testing without live Supabase credentials
class MemoryDB {
  constructor() {
    this.shares = new Map(); // id -> share
    this.shareCodeIndex = new Map(); // share_code -> id
    this.files = new Map(); // id -> file
    this.downloadEvents = [];
  }

  async createShare(data) {
    const id = data.id || crypto.randomUUID();
    const now = new Date().toISOString();
    const primaryFile = (data.files && data.files.length > 0) ? data.files[0] : null;
    const primaryPath = data.primaryStoragePath || null;

    const share = {
      id,
      share_code: data.shareCode,
      deletion_token_hash: data.deletionTokenHash,
      text_content: data.textContent || null,
      password_hash: data.passwordHash || null,
      expires_at: data.expiresAt.toISOString(),
      download_limit: data.downloadLimit || null,
      download_count: 0,
      file_count: data.fileCount || 0,
      total_size_bytes: data.totalSizeBytes || 0,
      file_path: primaryPath,
      original_filename: primaryFile ? (primaryFile.originalname || null) : null,
      mime_type: primaryFile ? (primaryFile.mimetype || null) : null,
      file_size: primaryFile ? (primaryFile.size || 0) : null,
      status: 'active',
      created_at: now,
      deleted_at: null
    };

    this.shares.set(id, share);
    this.shareCodeIndex.set(data.shareCode, id);
    return share;
  }

  async createShareFiles(shareId, files) {
    const createdFiles = [];
    const now = new Date().toISOString();

    for (const f of files) {
      const fileId = crypto.randomUUID();
      const record = {
        id: fileId,
        share_id: shareId,
        storage_path: f.storagePath,
        original_filename: f.originalFilename,
        mime_type: f.mimeType,
        file_size: f.fileSize,
        file_category: f.fileCategory || 'document',
        created_at: now
      };
      this.files.set(fileId, record);
      createdFiles.push(record);
    }
    return createdFiles;
  }

  async getShareByCode(shareCode) {
    const id = this.shareCodeIndex.get(shareCode);
    if (!id) return null;
    return this.shares.get(id) || null;
  }

  async getShareById(id) {
    return this.shares.get(id) || null;
  }

  async getShareFiles(shareId) {
    const result = [];
    for (const file of this.files.values()) {
      if (file.share_id === shareId) {
        result.push(file);
      }
    }
    return result;
  }

  async getShareFileById(shareId, fileId) {
    const file = this.files.get(fileId);
    if (file && file.share_id === shareId) {
      return file;
    }
    return null;
  }

  async incrementDownloadCount(shareId) {
    const share = this.shares.get(shareId);
    if (!share) return { success: false, newCount: 0, limit: 0 };

    const isExpired = new Date(share.expires_at) <= new Date();
    if (share.status !== 'active' || isExpired) {
      return { success: false, newCount: share.download_count, limit: share.download_limit };
    }

    if (share.download_limit !== null && share.download_count >= share.download_limit) {
      return { success: false, newCount: share.download_count, limit: share.download_limit };
    }

    share.download_count += 1;
    return {
      success: true,
      newCount: share.download_count,
      limit: share.download_limit
    };
  }

  async markShareDeleted(shareCode) {
    const id = this.shareCodeIndex.get(shareCode);
    if (!id) return false;
    const share = this.shares.get(id);
    if (!share) return false;

    share.status = 'deleted';
    share.deleted_at = new Date().toISOString();
    return true;
  }

  async getExpiredActiveShares(batchSize = 50) {
    const now = new Date();
    const expired = [];
    for (const share of this.shares.values()) {
      if (new Date(share.expires_at) <= now) {
        expired.push(share);
        if (expired.length >= batchSize) break;
      }
    }
    return expired;
  }

  async setShareExpired(shareId) {
    const share = this.shares.get(shareId);
    if (share) {
      share.status = 'expired';
    }
  }

  async recordDownloadEvent(shareId, fileId, downloadType, ipHash) {
    this.downloadEvents.push({
      id: crypto.randomUUID(),
      share_id: shareId,
      file_id: fileId,
      download_type: downloadType,
      ip_hash: ipHash,
      created_at: new Date().toISOString()
    });
  }

  async hardDeleteShare(shareId) {
    const share = this.shares.get(shareId);
    if (share) {
      this.shareCodeIndex.delete(share.share_code);
      this.shares.delete(shareId);
    }
    // Delete files
    for (const [fId, file] of this.files.entries()) {
      if (file.share_id === shareId) {
        this.files.delete(fId);
      }
    }
  }

  reset() {
    this.shares.clear();
    this.shareCodeIndex.clear();
    this.files.clear();
    this.downloadEvents = [];
  }
}

// Supabase PostgreSQL Database Service Implementation
class SupabaseDB {
  constructor(client, options = {}) {
    this.client = client;
    this.url = options.url || config.supabase.url;
    this.key = options.key || config.supabase.key;
    this.columnsCache = null;
    this.hasFilesTable = null;
    this.hasEventsTable = null;
    this.inMemoryDeletionTokens = new Map();
  }

  async ensureSchemaInfo() {
    if (this.columnsCache !== null) {
      return;
    }
    try {
      if (this.url && this.key) {
        const res = await fetch(`${this.url}/rest/v1/`, {
          headers: {
            apikey: this.key,
            Authorization: `Bearer ${this.key}`
          }
        });
        if (res.ok) {
          const openApi = await res.json();
          const sharesProps = openApi.definitions?.shares?.properties;
          if (sharesProps) {
            this.columnsCache = new Set(Object.keys(sharesProps));
            this.hasFilesTable = Boolean(openApi.definitions?.share_files);
            this.hasEventsTable = Boolean(openApi.definitions?.download_events);
            return;
          }
        }
      }
    } catch (_) {
      // Fallback if OpenAPI discovery fails
    }

    // Default to full modern schema
    this.columnsCache = new Set([
      'id', 'share_code', 'deletion_token_hash', 'text_content',
      'password_hash', 'expires_at', 'download_limit', 'download_count',
      'file_count', 'total_size_bytes', 'status', 'created_at', 'deleted_at'
    ]);
    this.hasFilesTable = true;
    this.hasEventsTable = true;
  }

  async createShare(data) {
    await this.ensureSchemaInfo();

    const hasText = Boolean(data.textContent && data.textContent.trim().length > 0);
    const hasFiles = Boolean(data.fileCount && data.fileCount > 0);

    const insertPayload = {
      share_code: data.shareCode,
      expires_at: data.expiresAt.toISOString(),
      download_limit: data.downloadLimit || null,
      download_count: 0
    };

    if (data.id) {
      insertPayload.id = data.id;
    }

    if (this.columnsCache.has('text_content')) {
      insertPayload.text_content = hasText ? data.textContent : null;
    }

    // Determine primary file path for legacy table columns (satisfies valid_share_content)
    const primaryFile = (data.files && data.files.length > 0) ? data.files[0] : null;
    const primaryPath = data.primaryStoragePath || null;

    if (this.columnsCache.has('file_path') && primaryPath) {
      insertPayload.file_path = primaryPath;
      if (this.columnsCache.has('original_filename') && primaryFile) {
        insertPayload.original_filename = primaryFile.originalname || null;
      }
      if (this.columnsCache.has('mime_type') && primaryFile) {
        insertPayload.mime_type = primaryFile.mimetype || null;
      }
      if (this.columnsCache.has('file_size') && primaryFile) {
        insertPayload.file_size = primaryFile.size || 0;
      }
    }

    // Set content_type appropriately according to constraint logic
    if (this.columnsCache.has('content_type')) {
      if (hasText && !hasFiles) {
        insertPayload.content_type = 'text';
      } else if (!hasText && hasFiles) {
        insertPayload.content_type = 'file';
      } else {
        // Mixed share (both text and files): set null so valid_share_content and content_type checks both pass!
        insertPayload.content_type = null;
      }
    }

    // Deletion token hash
    if (this.columnsCache.has('deletion_token_hash')) {
      insertPayload.deletion_token_hash = data.deletionTokenHash;
    } else {
      this.inMemoryDeletionTokens.set(data.shareCode, data.deletionTokenHash);
    }

    // Password hash
    if (this.columnsCache.has('password_hash')) {
      insertPayload.password_hash = data.passwordHash || null;
    }

    // Status
    if (this.columnsCache.has('status')) {
      insertPayload.status = 'active';
    }

    // Multi-file counters
    if (this.columnsCache.has('file_count')) {
      insertPayload.file_count = data.fileCount || 0;
    }
    if (this.columnsCache.has('total_size_bytes')) {
      insertPayload.total_size_bytes = data.totalSizeBytes || 0;
    }

    const { data: record, error } = await this.client
      .from('shares')
      .insert(insertPayload)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create share record in PostgreSQL: ${error.message}`);
    }

    // Normalize returned record for callers
    record.share_code = record.share_code || data.shareCode;
    record.status = record.status || 'active';
    record.deletion_token_hash = record.deletion_token_hash || data.deletionTokenHash;
    record.file_count = typeof record.file_count === 'number' ? record.file_count : (data.fileCount || 0);
    record.total_size_bytes = typeof record.total_size_bytes === 'number' ? record.total_size_bytes : (data.totalSizeBytes || 0);

    return record;
  }

  async createShareFiles(shareId, files) {
    if (!files || files.length === 0) return [];
    await this.ensureSchemaInfo();

    if (this.hasFilesTable) {
      const records = files.map(f => ({
        share_id: shareId,
        storage_path: f.storagePath,
        original_filename: f.originalFilename,
        mime_type: f.mimeType,
        file_size: f.fileSize,
        file_category: f.fileCategory || 'document'
      }));

      const { data, error } = await this.client
        .from('share_files')
        .insert(records)
        .select();

      if (error) {
        throw new Error(`Failed to insert share files in PostgreSQL: ${error.message}`);
      }
      return data;
    }

    // Legacy fallback: store primary file on shares table if columns exist
    if (files.length > 0 && this.columnsCache.has('file_path')) {
      const f = files[0];
      await this.client
        .from('shares')
        .update({
          file_path: f.storagePath,
          original_filename: f.originalFilename,
          mime_type: f.mimeType,
          file_size: f.fileSize
        })
        .eq('id', shareId);
    }

    return files.map((f, idx) => ({
      id: `${shareId}-${idx}`,
      share_id: shareId,
      storage_path: f.storagePath,
      original_filename: f.originalFilename,
      mime_type: f.mimeType,
      file_size: f.fileSize,
      file_category: f.fileCategory || 'document'
    }));
  }

  async getShareByCode(shareCode) {
    await this.ensureSchemaInfo();
    const { data, error } = await this.client
      .from('shares')
      .select('*')
      .eq('share_code', shareCode)
      .maybeSingle();

    if (error) {
      throw new Error(`Database error looking up share code: ${error.message}`);
    }
    if (!data) return null;

    // Normalize missing columns
    if (!data.status) {
      const isExpired = new Date(data.expires_at) <= new Date();
      data.status = isExpired ? 'expired' : 'active';
    }
    if (!data.deletion_token_hash && this.inMemoryDeletionTokens.has(shareCode)) {
      data.deletion_token_hash = this.inMemoryDeletionTokens.get(shareCode);
    }
    if (typeof data.file_count !== 'number') {
      data.file_count = data.file_path ? 1 : 0;
    }
    if (typeof data.total_size_bytes !== 'number') {
      data.total_size_bytes = data.file_size ? Number(data.file_size) : 0;
    }

    return data;
  }

  async getShareById(id) {
    await this.ensureSchemaInfo();
    const { data, error } = await this.client
      .from('shares')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      throw new Error(`Database error looking up share ID: ${error.message}`);
    }
    if (!data) return null;

    if (!data.status) {
      const isExpired = new Date(data.expires_at) <= new Date();
      data.status = isExpired ? 'expired' : 'active';
    }
    if (!data.deletion_token_hash && this.inMemoryDeletionTokens.has(data.share_code)) {
      data.deletion_token_hash = this.inMemoryDeletionTokens.get(data.share_code);
    }
    if (typeof data.file_count !== 'number') {
      data.file_count = data.file_path ? 1 : 0;
    }
    if (typeof data.total_size_bytes !== 'number') {
      data.total_size_bytes = data.file_size ? Number(data.file_size) : 0;
    }

    return data;
  }

  async getShareFiles(shareId) {
    await this.ensureSchemaInfo();

    if (this.hasFilesTable) {
      const { data, error } = await this.client
        .from('share_files')
        .select('id, share_id, storage_path, original_filename, mime_type, file_size, file_category, created_at')
        .eq('share_id', shareId);

      if (error) {
        throw new Error(`Database error fetching share files: ${error.message}`);
      }
      return data || [];
    }

    // Legacy fallback: read from shares table
    const share = await this.getShareById(shareId);
    if (share && share.file_path) {
      return [{
        id: `${share.id}-0`,
        share_id: share.id,
        storage_path: share.file_path,
        original_filename: share.original_filename || 'download',
        mime_type: share.mime_type || 'application/octet-stream',
        file_size: share.file_size || 0,
        file_category: share.mime_type?.startsWith('image/') ? 'image' : (share.mime_type?.startsWith('video/') ? 'video' : 'document'),
        created_at: share.created_at
      }];
    }
    return [];
  }

  async getShareFileById(shareId, fileId) {
    await this.ensureSchemaInfo();

    if (this.hasFilesTable) {
      const { data, error } = await this.client
        .from('share_files')
        .select('*')
        .eq('share_id', shareId)
        .eq('id', fileId)
        .maybeSingle();

      if (error) {
        throw new Error(`Database error fetching share file: ${error.message}`);
      }
      return data;
    }

    const files = await this.getShareFiles(shareId);
    return files.find(f => f.id === fileId) || null;
  }

  async incrementDownloadCount(shareId) {
    // Attempt RPC increment_download_count first
    try {
      const { data, error } = await this.client.rpc('increment_download_count', {
        p_share_id: shareId
      });

      if (!error && data && data.length > 0) {
        return {
          success: data[0].success,
          newCount: data[0].new_count,
          limit: data[0].configured_limit
        };
      }
    } catch (_) {
      // Fallback to direct query if RPC does not exist
    }

    // Fallback if RPC function not created in schema
    const share = await this.getShareById(shareId);
    if (!share) return { success: false, newCount: 0, limit: 0 };

    const isExpired = new Date(share.expires_at) <= new Date();
    if (share.status !== 'active' || isExpired) {
      return { success: false, newCount: share.download_count, limit: share.download_limit };
    }

    if (share.download_limit !== null && share.download_count >= share.download_limit) {
      return { success: false, newCount: share.download_count, limit: share.download_limit };
    }

    const { data: updated, error: updateErr } = await this.client
      .from('shares')
      .update({ download_count: share.download_count + 1 })
      .eq('id', shareId)
      .select('download_count, download_limit')
      .single();

    if (updateErr) {
      return { success: false, newCount: share.download_count, limit: share.download_limit };
    }

    return {
      success: true,
      newCount: updated.download_count,
      limit: updated.download_limit
    };
  }

  async markShareDeleted(shareCode) {
    await this.ensureSchemaInfo();
    const updatePayload = {};
    if (this.columnsCache.has('status')) {
      updatePayload.status = 'deleted';
    }
    if (this.columnsCache.has('deleted_at')) {
      updatePayload.deleted_at = new Date().toISOString();
    }

    if (Object.keys(updatePayload).length > 0) {
      const { error } = await this.client
        .from('shares')
        .update(updatePayload)
        .eq('share_code', shareCode);
      return !error;
    } else {
      const { error } = await this.client
        .from('shares')
        .delete()
        .eq('share_code', shareCode);
      return !error;
    }
  }

  async getExpiredActiveShares(batchSize = 50) {
    await this.ensureSchemaInfo();
    const nowIso = new Date().toISOString();

    let query = this.client
      .from('shares')
      .select('*')
      .lte('expires_at', nowIso)
      .order('expires_at', { ascending: true })
      .limit(batchSize);

    const { data, error } = await query;
    if (error) {
      console.error('[SupabaseDB] Error fetching expired shares:', error.message);
      return [];
    }
    return data || [];
  }

  async setShareExpired(shareId) {
    await this.ensureSchemaInfo();
    if (this.columnsCache.has('status')) {
      await this.client
        .from('shares')
        .update({ status: 'expired' })
        .eq('id', shareId);
    }
  }

  async recordDownloadEvent(shareId, fileId, downloadType, ipHash) {
    await this.ensureSchemaInfo();
    if (!this.hasEventsTable) return;
    try {
      await this.client
        .from('download_events')
        .insert({
          share_id: shareId,
          file_id: fileId || null,
          download_type: downloadType,
          ip_hash: ipHash
        });
    } catch (_) {
      // Non-critical telemetry
    }
  }

  async hardDeleteShare(shareId) {
    if (!shareId) return false;
    await this.ensureSchemaInfo();
    if (this.hasFilesTable) {
      await this.client.from('share_files').delete().eq('share_id', shareId);
    }
    if (this.hasEventsTable) {
      await this.client.from('download_events').delete().eq('share_id', shareId);
    }
    const { error } = await this.client.from('shares').delete().eq('id', shareId);
    if (error) {
      console.warn(`[SupabaseDB] Failed to hard delete share ${shareId}:`, error.message);
      throw new Error(`Database error deleting share record: ${error.message}`);
    }
    return true;
  }
}

// Initialize database service instance
let dbInstance;
const useLiveSupabase = config.supabase.isConfigured && (process.env.NODE_ENV !== 'test' || process.env.TEST_LIVE_SUPABASE === 'true');

if (useLiveSupabase) {
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
    dbInstance = new SupabaseDB(supabaseClient);
    console.log(`⚡ [DB] Initialized with live Supabase PostgreSQL backend (${config.supabase.keyRole} role).`);
  } catch (err) {
    console.warn('⚠️ [DB] Failed to initialize Supabase client, using fallback in-memory database:', err.message);
    dbInstance = new MemoryDB();
  }
} else {
  dbInstance = new MemoryDB();
}

export const db = dbInstance;
export { MemoryDB, SupabaseDB };

