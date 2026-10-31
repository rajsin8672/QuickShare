import express from 'express';
import crypto from 'crypto';
import { createRequire } from 'module';
import QRCode from 'qrcode';

const require = createRequire(import.meta.url);
const archiver = require('archiver');
import { shareService } from '../services/share.service.js';
import { storage } from '../services/storage.service.js';
import { upload, validateTotalUploadSize } from '../middleware/uploadValidation.js';
import { codeGuessLimiter, uploadLimiter } from '../middleware/rateLimiter.js';
import { config } from '../config/env.js';

const router = express.Router();

/**
 * Helper to extract client auth token from headers or query
 */
function extractAuthToken(req) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7).trim();
  }
  if (req.headers['x-share-token']) {
    return req.headers['x-share-token'].trim();
  }
  if (req.query && req.query.token) {
    return req.query.token.trim();
  }
  return null;
}

/**
 * Helper to anonymize IP for audit records
 */
function getIpHash(req) {
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  return crypto.createHash('sha256').update(ip).digest('hex');
}

/**
 * POST /api/shares - Create a new share with files and/or text
 */
router.post('/', uploadLimiter, upload.array('files', config.maxFileCount), validateTotalUploadSize, async (req, res, next) => {
  try {
    const { textContent, password, expiryMinutes, downloadLimit } = req.body;
    const files = req.files || [];

    const result = await shareService.createShare({
      files,
      textContent,
      password,
      expiryMinutes,
      downloadLimit
    });

    res.status(201).json({
      success: true,
      message: 'Share created successfully.',
      data: result
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/shares/receive - Receiver submits share code to get content
 */
router.post('/receive', codeGuessLimiter, async (req, res, next) => {
  try {
    const { code } = req.body;
    const token = extractAuthToken(req) || req.body.token;

    const shareData = await shareService.getShare(code, token);

    res.status(200).json({
      success: true,
      data: shareData
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/shares/:code/verify-password - Verify password for locked share
 */
router.post('/:code/verify-password', codeGuessLimiter, async (req, res, next) => {
  try {
    const { code } = req.params;
    const { password } = req.body;

    const result = await shareService.verifyPassword(code, password);

    res.status(200).json({
      success: true,
      message: 'Password verified successfully.',
      data: result
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/shares/:code - Public metadata check for a share code
 */
router.get('/:code', codeGuessLimiter, async (req, res, next) => {
  try {
    const { code } = req.params;
    const token = extractAuthToken(req);

    const shareData = await shareService.getShare(code, token);

    res.status(200).json({
      success: true,
      data: shareData
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/shares/:code/qr - Generate QR code for the share link
 */
router.get('/:code/qr', async (req, res, next) => {
  try {
    const { code } = req.params;
    const protocol = req.protocol;
    const host = req.get('host');
    const shareUrl = `${protocol}://${host}/receive.html?code=${encodeURIComponent(code)}`;

    const qrDataUrl = await QRCode.toDataURL(shareUrl, {
      margin: 2,
      width: 256,
      color: {
        dark: '#1e1b4b',
        light: '#ffffff'
      }
    });

    res.status(200).json({
      success: true,
      dataUrl: qrDataUrl,
      shareUrl
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/shares/:code/files/:fileId/download - Download a single file
 */
router.get('/:code/files/:fileId/download', async (req, res, next) => {
  try {
    const { code, fileId } = req.params;
    const token = extractAuthToken(req);
    const ipHash = getIpHash(req);

    const { file } = await shareService.getFileDownload(code, fileId, token, false, ipHash);

    // Fetch stream from storage
    const stream = await storage.getFileStream(file.storage_path);

    // Safe disposition and headers
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.original_filename)}"`);
    res.setHeader('Content-Type', file.mime_type || 'application/octet-stream');
    res.setHeader('Content-Length', file.file_size);
    res.setHeader('X-Content-Type-Options', 'nosniff');

    stream.pipe(res);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/shares/:code/files/:fileId/preview - Preview supported file (PDF, Images, Text)
 */
router.get('/:code/files/:fileId/preview', async (req, res, next) => {
  try {
    const { code, fileId } = req.params;
    const token = extractAuthToken(req);

    const { file } = await shareService.getFileDownload(code, fileId, token, true, null);

    // Check preview support
    const previewable = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'text/plain'];
    if (!previewable.includes(file.mime_type)) {
      return res.status(400).json({
        success: false,
        error: 'In-browser preview is not available for this file type. Please download the file.'
      });
    }

    const stream = await storage.getFileStream(file.storage_path);

    // Isolated sandbox headers for preview
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(file.original_filename)}"`);
    res.setHeader('Content-Type', file.mime_type);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'unsafe-inline'; sandbox");

    stream.pipe(res);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/shares/:code/download-all - Download all files as a ZIP archive
 */
router.get('/:code/download-all', async (req, res, next) => {
  try {
    const { code } = req.params;
    const token = extractAuthToken(req);
    const ipHash = getIpHash(req);

    const { share, files } = await shareService.getFilesForZip(code, token, ipHash);

    res.setHeader('Content-Disposition', `attachment; filename="QuickShare_${share.share_code}.zip"`);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    const archive = archiver('zip', {
      zlib: { level: 6 }
    });

    archive.on('error', (err) => {
      console.error('[Archiver Error]:', err);
      if (!res.headersSent) {
        res.status(500).json({ success: false, error: 'Failed to create ZIP archive.' });
      }
    });

    archive.pipe(res);

    for (const file of files) {
      const stream = await storage.getFileStream(file.storage_path);
      archive.append(stream, { name: file.original_filename });
    }

    await archive.finalize();
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/shares/:code - Creator deletes share using secret deletion token
 */
router.delete('/:code', async (req, res, next) => {
  try {
    const { code } = req.params;
    const deletionToken = req.headers['x-deletion-token'] || req.query.token || req.body.deletionToken;

    const result = await shareService.deleteShare(code, deletionToken);

    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
