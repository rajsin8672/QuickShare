import express from 'express';
import crypto from 'crypto';
import path from 'path';
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
 * GET /api/shares/:code/files/:fileId/signed-url - Generate short-lived signed download URL
 */
router.get('/:code/files/:fileId/signed-url', codeGuessLimiter, async (req, res, next) => {
  try {
    const { code, fileId } = req.params;
    const token = extractAuthToken(req);
    const ipHash = getIpHash(req);
    const expiresIn = parseInt(req.query.expiresIn || '60', 10);

    const result = await shareService.getSignedDownloadUrl(code, fileId, token, ipHash, expiresIn);

    res.status(200).json({
      success: true,
      data: result
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/shares/:code/files/:fileId/download - Download a single file (stream or signed redirect)
 */
router.get('/:code/files/:fileId/download', async (req, res, next) => {
  try {
    const { code, fileId } = req.params;
    const token = extractAuthToken(req);
    const ipHash = getIpHash(req);

    // Support redirect to short-lived signed URL if requested
    if (req.query.redirect === 'true' || req.query.signed === 'true') {
      const expiresIn = parseInt(req.query.expiresIn || '60', 10);
      const result = await shareService.getSignedDownloadUrl(code, fileId, token, ipHash, expiresIn);
      return res.redirect(302, result.signedUrl);
    }

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
 * GET /api/shares/local-storage/download - Download file via verified local signed URL
 */
router.get('/local-storage/download', async (req, res, next) => {
  try {
    const { path: storagePath, expires, sig } = req.query;
    if (!storagePath || !expires || !sig) {
      return res.status(400).json({ success: false, error: 'Missing signed download parameters.' });
    }

    const expiresTimestamp = parseInt(expires, 10);
    const currentTimestamp = Math.floor(Date.now() / 1000);
    if (isNaN(expiresTimestamp) || currentTimestamp > expiresTimestamp) {
      return res.status(410).json({ success: false, error: 'Signed download URL has expired.' });
    }

    // Verify HMAC signature
    const dataToSign = `${storagePath}:${expires}`;
    const expectedSig = crypto.createHmac('sha256', config.shareTokenSecret).update(dataToSign).digest('hex');
    const sigBuffer = Buffer.from(sig);
    const expectedBuffer = Buffer.from(expectedSig);

    if (sigBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
      return res.status(403).json({ success: false, error: 'Invalid or tampered signed URL signature.' });
    }

    const stream = await storage.getFileStream(storagePath);
    const requestedFilename = req.query.filename ? decodeURIComponent(req.query.filename) : null;
    const defaultFilename = path.posix.basename(storagePath.replace(/\\/g, '/')).replace(/^[a-f0-9-]+-/, '');
    const filename = requestedFilename || defaultFilename;
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    stream.pipe(res);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/shares/:code/files/:fileId/preview - Preview supported file (PDF, Photos, Videos, Text)
 */
router.get('/:code/files/:fileId/preview', async (req, res, next) => {
  try {
    const { code, fileId } = req.params;
    const token = extractAuthToken(req);

    const { file } = await shareService.getFileDownload(code, fileId, token, true, null);

    // Check preview support (Images, Videos, PDF, Plaintext)
    const previewable = [
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/gif',
      'video/mp4',
      'video/webm',
      'video/quicktime',
      'text/plain'
    ];
    if (!previewable.includes(file.mime_type)) {
      return res.status(400).json({
        success: false,
        error: 'In-browser preview is not available for this file type. Please download the file.'
      });
    }

    const fileSize = Number(file.file_size);
    const range = req.headers.range;

    // Support HTTP Range requests for video seeking and streaming
    if (range && fileSize > 0) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

      if (start >= fileSize || end >= fileSize) {
        res.setHeader('Content-Range', `bytes */${fileSize}`);
        return res.status(416).end();
      }

      const chunkSize = (end - start) + 1;
      const stream = await storage.getFileStream(file.storage_path, { start, end });

      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Length', chunkSize);
      res.setHeader('Content-Type', file.mime_type);
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(file.original_filename)}"`);
      res.setHeader('X-Content-Type-Options', 'nosniff');

      return stream.pipe(res);
    }

    const stream = await storage.getFileStream(file.storage_path);

    res.status(200);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(file.original_filename)}"`);
    res.setHeader('Content-Type', file.mime_type);
    res.setHeader('Content-Length', fileSize);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'unsafe-inline'; media-src 'self' blob: data:; sandbox allow-scripts allow-same-origin");

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

    res.setHeader('Content-Disposition', `attachment; filename="FShare_${share.share_code}.zip"`);
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
