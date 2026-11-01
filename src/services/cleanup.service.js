import { db } from './db.service.js';
import { storage } from './storage.service.js';
import { config } from '../config/env.js';

export class CleanupService {
  constructor() {
    this.intervalId = null;
    this.isRunning = false;
  }

  /**
   * Run one pass of cleanup for expired shares and orphaned files.
   * Batches queries to prevent API limit exhaustion.
   * Strictly deletes the database record ONLY after Storage deletion succeeds or files confirmed absent.
   * Preserves database records for retry if Storage deletion fails.
   * Idempotent: safe to run repeatedly.
   *
   * @param {number} [batchSize=50] - Number of expired shares to process per batch
   * @returns {Promise<{ cleanedCount: number, failedCount: number, totalProcessed: number, timestamp: string }>}
   */
  async runCleanup(batchSize = 50) {
    if (this.isRunning) {
      console.log('⏳ [Cleanup] Previous cleanup run still active, skipping duplicate pass.');
      return { cleanedCount: 0, failedCount: 0, totalProcessed: 0, skipped: true };
    }

    this.isRunning = true;
    const startTime = Date.now();
    try {
      const expiredShares = await db.getExpiredActiveShares(batchSize);
      if (!expiredShares || expiredShares.length === 0) {
        return {
          cleanedCount: 0,
          failedCount: 0,
          totalProcessed: 0,
          timestamp: new Date().toISOString()
        };
      }

      console.log(`🧹 [Cleanup] Found ${expiredShares.length} expired share(s) to process.`);
      let cleanedCount = 0;
      let failedCount = 0;

      for (const share of expiredShares) {
        try {
          // 1. Fetch file storage paths for this share
          const files = await db.getShareFiles(share.id);
          const paths = (files || [])
            .map(f => f.storage_path)
            .filter(p => typeof p === 'string' && p.trim().length > 0);

          // 2. Remove files from Supabase Storage (or local storage fallback)
          if (paths.length > 0) {
            await storage.deleteFiles(paths);
          }

          // 3. Delete database record ONLY AFTER storage deletion succeeds or files confirmed absent
          await db.hardDeleteShare(share.id);
          cleanedCount++;
        } catch (itemErr) {
          failedCount++;
          // Safe log: Never print secret keys or private file payloads
          console.error(`⚠️ [Cleanup] Error cleaning expired share ${share.share_code}:`, itemErr.message);
          // Crucial: The database record is NOT deleted on error, preserving it for automatic retry on next run!
        }
      }

      console.log(`✅ [Cleanup] Batch complete in ${Date.now() - startTime}ms: ${cleanedCount} purged, ${failedCount} failed/deferred.`);
      return {
        cleanedCount,
        failedCount,
        totalProcessed: expiredShares.length,
        timestamp: new Date().toISOString()
      };
    } catch (err) {
      console.error('❌ [Cleanup] Failed during cleanup run:', err.message);
      return {
        error: err.message,
        cleanedCount: 0,
        failedCount: 0,
        totalProcessed: 0,
        timestamp: new Date().toISOString()
      };
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Start the recurring cleanup timer
   */
  startScheduler(intervalMinutes = config.cleanupIntervalMinutes) {
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }

    const validInterval = Math.max(parseInt(intervalMinutes, 10) || 5, 1);
    const intervalMs = validInterval * 60 * 1000;
    console.log(`⏰ [Cleanup] Scheduler active every ${validInterval} minute(s).`);

    // Run once on startup after 5 seconds delay
    setTimeout(() => {
      this.runCleanup().catch(e => console.error('Initial cleanup error:', e.message));
    }, 5000);

    this.intervalId = setInterval(() => {
      this.runCleanup().catch(e => console.error('Recurring cleanup error:', e.message));
    }, intervalMs);
  }

  /**
   * Stop the scheduled cleanup job
   */
  stopScheduler() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }
}

export const cleanupService = new CleanupService();

