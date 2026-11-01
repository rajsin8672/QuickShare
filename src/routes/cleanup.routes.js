import express from 'express';
import crypto from 'crypto';
import { cleanupService } from '../services/cleanup.service.js';
import { config } from '../config/env.js';

const router = express.Router();

/**
 * Authentication middleware for scheduled cleanup endpoint.
 * Requires a pre-shared secret via Authorization Bearer, x-cleanup-key header, or ?key query.
 * Uses constant-time comparison to prevent timing attacks.
 */
function authenticateCleanup(req, res, next) {
  const configuredSecret = config.cronSecret;

  // In test environment, allow test secret if configured or fallback for testing
  const isTest = process.env.NODE_ENV === 'test';
  const effectiveSecret = configuredSecret || (isTest ? 'test_cleanup_secret_32_chars_min' : '');

  if (!effectiveSecret || effectiveSecret.length < 8) {
    return res.status(503).json({
      success: false,
      error: 'Scheduled cleanup endpoint is unavailable because CRON_SECRET is not configured on the server.'
    });
  }

  let providedToken = '';
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    providedToken = authHeader.substring(7).trim();
  } else if (req.headers['x-cleanup-key']) {
    providedToken = String(req.headers['x-cleanup-key']).trim();
  } else if (req.query && (req.query.key || req.query.token)) {
    providedToken = String(req.query.key || req.query.token).trim();
  }

  if (!providedToken) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized: Missing cleanup authentication token.'
    });
  }

  // Constant-time comparison
  const expectedBuf = Buffer.from(effectiveSecret, 'utf8');
  const providedBuf = Buffer.from(providedToken, 'utf8');

  if (expectedBuf.length !== providedBuf.length || !crypto.timingSafeEqual(expectedBuf, providedBuf)) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized: Invalid cleanup authentication token.'
    });
  }

  next();
}

/**
 * POST /api/cleanup - Secure trigger for automatic file expiration and cleanup
 */
router.post('/cleanup', authenticateCleanup, async (req, res, next) => {
  try {
    const rawBatchSize = req.query.batchSize || req.body?.batchSize;
    const batchSize = Math.min(Math.max(parseInt(rawBatchSize || '50', 10) || 50, 1), 200);

    const result = await cleanupService.runCleanup(batchSize);

    res.status(200).json({
      success: true,
      message: 'Automatic cleanup executed successfully.',
      ...result
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/cleanup - Supports simple webhook callers using authenticated GET
 */
router.get('/cleanup', authenticateCleanup, async (req, res, next) => {
  try {
    const rawBatchSize = req.query.batchSize;
    const batchSize = Math.min(Math.max(parseInt(rawBatchSize || '50', 10) || 50, 1), 200);

    const result = await cleanupService.runCleanup(batchSize);

    res.status(200).json({
      success: true,
      message: 'Automatic cleanup executed successfully.',
      ...result
    });
  } catch (err) {
    next(err);
  }
});

export default router;
