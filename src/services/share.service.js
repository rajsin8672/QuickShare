import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { config } from '../config/env.js';
import { db } from './db.service.js';
import { storage, buildStoragePath } from './storage.service.js';
import {
  generateShareCode,
  generateDeletionToken,
  hashToken,
  verifyToken,
  normalizeShareCode,
  createShareAccessToken,
  verifyShareAccessToken
} from '../utils/generateCode.js';
import {
  validateFileType,
  validateExpiryMinutes,
  validateDownloadLimit,
  calculateExpiresAt,
  sanitizeFilename,
  getFileCategory
} from '../utils/validation.js';

export class ShareService {
  /**
   * Create a new share with files and/or text message
   */
  async createShare({ files = [], textContent = '', password = '', expiryMinutes = 30, downloadLimit = null }) {
    const trimmedText = (textContent || '').trim();

    // 1. Validation: Reject completely empty shares
    if ((!files || files.length === 0) && !trimmedText) {
      const err = new Error('Share cannot be empty. Please provide files, a text message, or both.');
      err.statusCode = 400;
      throw err;
    }

    // 2. Validate file count
    if (files.length > config.maxFileCount) {
      const err = new Error(`Cannot upload more than ${config.maxFileCount} files per share.`);
      err.statusCode = 400;
      throw err;
    }

    // 3. Validate individual file sizes, total size, and file types
    let totalSizeBytes = 0;
    for (const file of files) {
      if (file.size > config.maxFileSize) {
        const err = new Error(`File "${file.originalname}" exceeds the maximum allowed size of ${Math.round(config.maxFileSize / 1024 / 1024)}MB.`);
        err.statusCode = 400;
        throw err;
      }
      totalSizeBytes += file.size;

      const typeCheck = validateFileType(file.originalname, file.mimetype, file.buffer);
      if (!typeCheck.valid) {
        const err = new Error(typeCheck.error);
        err.statusCode = 400;
        throw err;
      }
    }

    if (totalSizeBytes > config.maxTotalSize) {
      const err = new Error(`Total upload size exceeds the maximum limit of ${Math.round(config.maxTotalSize / 1024 / 1024)}MB.`);
      err.statusCode = 400;
      throw err;
    }

    // 4. Expiration & Download Limits
    const validExpiryMinutes = validateExpiryMinutes(expiryMinutes);
    const expiresAt = calculateExpiresAt(validExpiryMinutes);
    const validatedLimit = validateDownloadLimit(downloadLimit);

    // 5. Password Hashing (if provided)
    let passwordHash = null;
    if (password && typeof password === 'string' && password.trim().length > 0) {
      const salt = await bcrypt.genSalt(10);
      passwordHash = await bcrypt.hash(password.trim(), salt);
    }

    // 6. Cryptographically secure random code generation with collision retry
    let shareCode = '';
    let attempts = 0;
    const maxAttempts = 10;
    while (attempts < maxAttempts) {
      attempts++;
      const candidateCode = generateShareCode(attempts > 5 ? 7 : 6);
      const existing = await db.getShareByCode(candidateCode);
      if (!existing) {
        shareCode = candidateCode;
        break;
      }
    }

    if (!shareCode) {
      const err = new Error('Failed to generate a unique share code. Please try again.');
      err.statusCode = 500;
      throw err;
    }

    // 7. Generate creator deletion token and share ID
    const shareId = crypto.randomUUID();
    const deletionToken = generateDeletionToken();
    const deletionTokenHash = hashToken(deletionToken);

    // Pre-calculate storage paths for files using safe UUID keys and preserved filenames
    const preparedFiles = files.map(file => {
      const fileId = crypto.randomUUID();
      const safeDisplayName = sanitizeFilename(file.originalname);
      const storagePath = buildStoragePath(shareId, fileId, file.originalname);
      const category = getFileCategory(file.originalname, file.mimetype);
      return {
        fileId,
        safeDisplayName,
        storagePath,
        category,
        file
      };
    });

    const primaryStoragePath = preparedFiles.length > 0 ? preparedFiles[0].storagePath : null;

    // 8. Database Record Creation
    let createdShare = null;
    const uploadedStoragePaths = [];

    try {
      createdShare = await db.createShare({
        id: shareId,
        shareCode,
        deletionTokenHash,
        textContent: trimmedText || null,
        passwordHash,
        expiresAt,
        downloadLimit: validatedLimit,
        fileCount: files.length,
        totalSizeBytes,
        files: preparedFiles.map(p => ({
          originalname: p.safeDisplayName,
          mimetype: p.file.mimetype,
          size: p.file.size
        })),
        primaryStoragePath
      });

      // 9. Upload files to private storage and insert file records
      const fileRecordsToInsert = [];
      for (const prep of preparedFiles) {
        // Upload to storage bucket
        await storage.uploadFile(prep.storagePath, prep.file.buffer, prep.file.mimetype);
        uploadedStoragePaths.push(prep.storagePath);

        fileRecordsToInsert.push({
          storagePath: prep.storagePath,
          originalFilename: prep.safeDisplayName,
          mimeType: prep.file.mimetype,
          fileSize: prep.file.size,
          fileCategory: prep.category
        });
      }

      if (fileRecordsToInsert.length > 0) {
        await db.createShareFiles(createdShare.id, fileRecordsToInsert);
      }

      return {
        success: true,
        shareCode,
        expiresAt: createdShare.expires_at,
        fileCount: createdShare.file_count,
        totalSizeBytes: createdShare.total_size_bytes,
        downloadLimit: createdShare.download_limit,
        deletionToken // Plaintext secret returned ONLY to creator
      };
    } catch (uploadError) {
      // Compensating rollback cleanup: delete any storage files & DB record created
      console.error('[ShareService] Error creating share, initiating rollback:', uploadError.message);
      if (uploadedStoragePaths.length > 0) {
        await storage.deleteFiles(uploadedStoragePaths).catch(e => console.warn('Rollback storage error:', e.message));
      }
      if (createdShare && createdShare.id) {
        await db.hardDeleteShare(createdShare.id).catch(e => console.warn('Rollback db error:', e.message));
      }
      throw uploadError;
    }
  }

  /**
   * Retrieve share details for a receiver
   */
  async getShare(rawCode, authToken = null) {
    const code = normalizeShareCode(rawCode);
    if (!code) {
      const err = new Error('Sharing code is required.');
      err.statusCode = 400;
      throw err;
    }

    const share = await db.getShareByCode(code);
    if (!share) {
      const err = new Error('Share not found. Please check your code and try again.');
      err.statusCode = 404;
      throw err;
    }

    // Check status
    if (share.status === 'deleted') {
      const err = new Error('This share has been deleted by the owner.');
      err.statusCode = 410; // Gone
      throw err;
    }

    // Check expiration
    const now = new Date();
    if (share.status === 'expired' || new Date(share.expires_at) <= now) {
      await db.setShareExpired(share.id);
      const err = new Error('This share has expired and is no longer available.');
      err.statusCode = 410;
      throw err;
    }

    // Check download limit
    if (share.download_limit !== null && share.download_count >= share.download_limit) {
      const err = new Error(`Download limit of ${share.download_limit} has been reached for this share.`);
      err.statusCode = 410;
      throw err;
    }

    // Check password protection
    const isPasswordProtected = Boolean(share.password_hash);
    let isAuthorized = !isPasswordProtected;

    if (isPasswordProtected && authToken) {
      if (verifyShareAccessToken(authToken, code, config.shareTokenSecret)) {
        isAuthorized = true;
      }
    }

    if (isPasswordProtected && !isAuthorized) {
      // Return locked metadata without sensitive text or file list
      return {
        requiresPassword: true,
        shareCode: share.share_code,
        fileCount: share.file_count,
        totalSizeBytes: share.total_size_bytes,
        hasText: Boolean(share.text_content),
        expiresAt: share.expires_at,
        downloadLimit: share.download_limit,
        downloadCount: share.download_count
      };
    }

    // Full authorized details
    const files = await db.getShareFiles(share.id);
    const safeFiles = files.map(f => {
      const category = f.file_category || getFileCategory(f.original_filename, f.mime_type);
      const canPreview = ['image', 'video', 'pdf', 'text'].includes(category);
      return {
        id: f.id,
        originalFilename: f.original_filename,
        mimeType: f.mime_type,
        fileSize: f.file_size,
        fileCategory: category,
        canPreview
      };
    });

    return {
      requiresPassword: false,
      shareCode: share.share_code,
      textContent: share.text_content,
      fileCount: share.file_count,
      totalSizeBytes: share.total_size_bytes,
      expiresAt: share.expires_at,
      downloadLimit: share.download_limit,
      downloadCount: share.download_count,
      files: safeFiles
    };
  }

  /**
   * Verify password for a password-protected share
   */
  async verifyPassword(rawCode, password) {
    const code = normalizeShareCode(rawCode);
    const share = await db.getShareByCode(code);
    if (!share) {
      const err = new Error('Share not found.');
      err.statusCode = 404;
      throw err;
    }

    if (share.status === 'deleted') {
      const err = new Error('This share has been deleted.');
      err.statusCode = 410;
      throw err;
    }

    if (new Date(share.expires_at) <= new Date() || share.status === 'expired') {
      const err = new Error('This share has expired.');
      err.statusCode = 410;
      throw err;
    }

    if (!share.password_hash) {
      // Not password protected
      const token = createShareAccessToken(code, config.shareTokenSecret);
      return { token, share: await this.getShare(code, token) };
    }

    if (!password || typeof password !== 'string') {
      const err = new Error('Password is required.');
      err.statusCode = 400;
      throw err;
    }

    const matches = await bcrypt.compare(password.trim(), share.password_hash);
    if (!matches) {
      const err = new Error('Incorrect password. Please try again.');
      err.statusCode = 401;
      throw err;
    }

    // Generate short-lived bearer token (valid for 1 hour)
    const token = createShareAccessToken(code, config.shareTokenSecret, 3600);
    const shareData = await this.getShare(code, token);

    return {
      success: true,
      token,
      share: shareData
    };
  }

  /**
   * Delete a share using the secret owner deletion token
   */
  async deleteShare(rawCode, deletionToken) {
    const code = normalizeShareCode(rawCode);
    if (!code) {
      const err = new Error('Share code is required.');
      err.statusCode = 400;
      throw err;
    }

    if (!deletionToken || typeof deletionToken !== 'string') {
      const err = new Error('Valid owner deletion token is required.');
      err.statusCode = 403;
      throw err;
    }

    const share = await db.getShareByCode(code);
    if (!share) {
      const err = new Error('Share not found.');
      err.statusCode = 404;
      throw err;
    }

    // Verify deletion token hash
    const isValidToken = verifyToken(deletionToken.trim(), share.deletion_token_hash);
    if (!isValidToken) {
      const err = new Error('Invalid deletion token. Only the creator can delete this share.');
      err.statusCode = 403;
      throw err;
    }

    // Fetch and delete files from storage
    const files = await db.getShareFiles(share.id);
    const storagePaths = files.map(f => f.storage_path);
    if (storagePaths.length > 0) {
      await storage.deleteFiles(storagePaths).catch(e => console.warn('File deletion warning:', e.message));
    }

    // Mark as deleted in DB
    await db.markShareDeleted(code);

    return { success: true, message: 'Share and associated files have been permanently deleted.' };
  }

  /**
   * Authorize and prepare file for download
   */
  async getFileDownload(rawCode, fileId, authToken, isPreview = false, ipHash = null) {
    const code = normalizeShareCode(rawCode);
    const share = await db.getShareByCode(code);
    if (!share) {
      const err = new Error('Share not found.');
      err.statusCode = 404;
      throw err;
    }

    if (share.status === 'deleted') {
      const err = new Error('This share has been deleted.');
      err.statusCode = 410;
      throw err;
    }

    if (new Date(share.expires_at) <= new Date() || share.status === 'expired') {
      await db.setShareExpired(share.id);
      const err = new Error('This share has expired.');
      err.statusCode = 410;
      throw err;
    }

    // Password verification
    if (share.password_hash) {
      if (!verifyShareAccessToken(authToken, code, config.shareTokenSecret)) {
        const err = new Error('Unauthorized. Password authentication required for this share.');
        err.statusCode = 401;
        throw err;
      }
    }

    // Check file exists in share
    const file = await db.getShareFileById(share.id, fileId);
    if (!file) {
      const err = new Error('File not found in this share.');
      err.statusCode = 404;
      throw err;
    }

    // Only increment download count on actual file downloads (not previews)
    if (!isPreview) {
      const limitResult = await db.incrementDownloadCount(share.id);
      if (!limitResult.success) {
        const err = new Error('Download limit reached for this share.');
        err.statusCode = 410;
        throw err;
      }
      await db.recordDownloadEvent(share.id, file.id, 'single_file', ipHash);
    }

    return {
      file,
      share
    };
  }

  /**
   * Authorize and generate a short-lived signed download URL
   */
  async getSignedDownloadUrl(rawCode, fileId, authToken, ipHash = null, expiresInSeconds = 60) {
    const code = normalizeShareCode(rawCode);
    const share = await db.getShareByCode(code);
    if (!share) {
      const err = new Error('Share not found.');
      err.statusCode = 404;
      throw err;
    }

    if (share.status === 'deleted') {
      const err = new Error('This share has been deleted.');
      err.statusCode = 410;
      throw err;
    }

    if (new Date(share.expires_at) <= new Date() || share.status === 'expired') {
      await db.setShareExpired(share.id);
      const err = new Error('This share has expired.');
      err.statusCode = 410;
      throw err;
    }

    // Password verification
    if (share.password_hash) {
      if (!verifyShareAccessToken(authToken, code, config.shareTokenSecret)) {
        const err = new Error('Unauthorized. Password authentication required for this share.');
        err.statusCode = 401;
        throw err;
      }
    }

    const file = await db.getShareFileById(share.id, fileId);
    if (!file) {
      const err = new Error('File not found in this share.');
      err.statusCode = 404;
      throw err;
    }

    // Atomically increment download count
    const limitResult = await db.incrementDownloadCount(share.id);
    if (!limitResult.success) {
      const err = new Error('Download limit reached for this share.');
      err.statusCode = 410;
      throw err;
    }
    await db.recordDownloadEvent(share.id, file.id, 'single_file_signed_url', ipHash);

    // Constrain expiresIn between 10s and 300s (default: 60s)
    const validExpires = Math.min(Math.max(Number(expiresInSeconds) || 60, 10), 300);
    const signedUrl = await storage.createSignedUrl(file.storage_path, validExpires, file.original_filename);

    return {
      signedUrl,
      expiresInSeconds: validExpires,
      filename: file.original_filename,
      mimeType: file.mime_type,
      fileSize: file.file_size
    };
  }

  /**
   * Authorize and prepare all files in a share for ZIP archive download
   */
  async getFilesForZip(rawCode, authToken, ipHash = null) {
    const code = normalizeShareCode(rawCode);
    const share = await db.getShareByCode(code);
    if (!share) {
      const err = new Error('Share not found.');
      err.statusCode = 404;
      throw err;
    }

    if (share.status === 'deleted') {
      const err = new Error('This share has been deleted.');
      err.statusCode = 410;
      throw err;
    }

    if (new Date(share.expires_at) <= new Date() || share.status === 'expired') {
      await db.setShareExpired(share.id);
      const err = new Error('This share has expired.');
      err.statusCode = 410;
      throw err;
    }

    // Password verification
    if (share.password_hash) {
      if (!verifyShareAccessToken(authToken, code, config.shareTokenSecret)) {
        const err = new Error('Unauthorized. Password authentication required for this share.');
        err.statusCode = 401;
        throw err;
      }
    }

    const files = await db.getShareFiles(share.id);
    if (!files || files.length === 0) {
      const err = new Error('No files available to download in this share.');
      err.statusCode = 404;
      throw err;
    }

    // Atomic increment of download count for the ZIP download
    const limitResult = await db.incrementDownloadCount(share.id);
    if (!limitResult.success) {
      const err = new Error('Download limit reached for this share.');
      err.statusCode = 410;
      throw err;
    }

    await db.recordDownloadEvent(share.id, null, 'all_zip', ipHash);

    return {
      share,
      files
    };
  }
}

export const shareService = new ShareService();
