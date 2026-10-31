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
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
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

  async getExpiredActiveShares() {
    const now = new Date();
    const expired = [];
    for (const share of this.shares.values()) {
      if (share.status === 'active' && new Date(share.expires_at) <= now) {
        expired.push(share);
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
  constructor(client) {
    this.client = client;
  }

  async createShare(data) {
    const { data: record, error } = await this.client
      .from('shares')
      .insert({
        share_code: data.shareCode,
        deletion_token_hash: data.deletionTokenHash,
        text_content: data.textContent || null,
        password_hash: data.passwordHash || null,
        expires_at: data.expiresAt.toISOString(),
        download_limit: data.downloadLimit || null,
        download_count: 0,
        file_count: data.fileCount || 0,
        total_size_bytes: data.totalSizeBytes || 0,
        status: 'active'
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create share record in PostgreSQL: ${error.message}`);
    }
    return record;
  }

  async createShareFiles(shareId, files) {
    if (!files || files.length === 0) return [];

    const records = files.map(f => ({
      share_id: shareId,
      storage_path: f.storagePath,
      original_filename: f.originalFilename,
      mime_type: f.mimeType,
      file_size: f.fileSize
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

  async getShareByCode(shareCode) {
    const { data, error } = await this.client
      .from('shares')
      .select('*')
      .eq('share_code', shareCode)
      .maybeSingle();

    if (error) {
      throw new Error(`Database error looking up share code: ${error.message}`);
    }
    return data;
  }

  async getShareById(id) {
    const { data, error } = await this.client
      .from('shares')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      throw new Error(`Database error looking up share ID: ${error.message}`);
    }
    return data;
  }

  async getShareFiles(shareId) {
    const { data, error } = await this.client
      .from('share_files')
      .select('id, share_id, storage_path, original_filename, mime_type, file_size, created_at')
      .eq('share_id', shareId);

    if (error) {
      throw new Error(`Database error fetching share files: ${error.message}`);
    }
    return data || [];
  }

  async getShareFileById(shareId, fileId) {
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

  async incrementDownloadCount(shareId) {
    // Attempt RPC increment_download_count first
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
    const { error } = await this.client
      .from('shares')
      .update({
        status: 'deleted',
        deleted_at: new Date().toISOString()
      })
      .eq('share_code', shareCode);

    return !error;
  }

  async getExpiredActiveShares() {
    const nowIso = new Date().toISOString();
    const { data, error } = await this.client
      .from('shares')
      .select('*')
      .eq('status', 'active')
      .lte('expires_at', nowIso);

    if (error) {
      console.error('[SupabaseDB] Error fetching expired shares:', error.message);
      return [];
    }
    return data || [];
  }

  async setShareExpired(shareId) {
    await this.client
      .from('shares')
      .update({ status: 'expired' })
      .eq('id', shareId);
  }

  async recordDownloadEvent(shareId, fileId, downloadType, ipHash) {
    await this.client
      .from('download_events')
      .insert({
        share_id: shareId,
        file_id: fileId || null,
        download_type: downloadType,
        ip_hash: ipHash
      });
  }

  async hardDeleteShare(shareId) {
    await this.client.from('shares').delete().eq('id', shareId);
  }
}

// Initialize database service instance
let dbInstance;

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
    dbInstance = new SupabaseDB(supabaseClient);
    console.log('⚡ [DB] Initialized with live Supabase PostgreSQL backend.');
  } catch (err) {
    console.warn('⚠️ [DB] Failed to initialize Supabase client, using fallback in-memory database:', err.message);
    dbInstance = new MemoryDB();
  }
} else {
  dbInstance = new MemoryDB();
}

export const db = dbInstance;
export { MemoryDB, SupabaseDB };
