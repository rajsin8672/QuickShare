import { db } from './db.service.js';
import { storage } from './storage.service.js';
import { config } from '../config/env.js';

export class CleanupService {
  constructor() {
    this.intervalId = null;
    this.isRunning = false;
  }

  /**
   * Run one pass of cleanup for expired shares and orphaned files
   */
  async runCleanup() {
    if (this.isRunning) {
      console.log('⏳ [Cleanup] Previous cleanup run still active, skipping duplicate pass.');
      return;
    }

    this.isRunning = true;
    try {
      const expiredShares = await db.getExpiredActiveShares();
      if (!expiredShares || expiredShares.length === 0) {
        return { cleanedCount: 0 };
      }

      console.log(`🧹 [Cleanup] Found ${expiredShares.length} expired share(s) to process.`);
      let cleanedCount = 0;

      for (const share of expiredShares) {
        try {
          // 1. Fetch file storage paths for this share
          const files = await db.getShareFiles(share.id);
          const paths = files.map(f => f.storage_path).filter(Boolean);

          // 2. Remove files from storage
          if (paths.length > 0) {
            await storage.deleteFiles(paths);
          }

          // 3. Mark share as expired in DB
          await db.setShareExpired(share.id);
          cleanedCount++;
        } catch (itemErr) {
          console.error(`⚠️ [Cleanup] Error cleaning expired share ${share.share_code}:`, itemErr.message);
        }
      }

      console.log(`✅ [Cleanup] Cleaned up ${cleanedCount} expired share(s).`);
      return { cleanedCount };
    } catch (err) {
      console.error('❌ [Cleanup] Failed during cleanup run:', err.message);
      return { error: err.message };
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

    const intervalMs = Math.max(intervalMinutes, 1) * 60 * 1000;
    console.log(`⏰ [Cleanup] Scheduler active every ${intervalMinutes} minute(s).`);

    // Run once on startup after 10 seconds delay
    setTimeout(() => {
      this.runCleanup().catch(e => console.error('Initial cleanup error:', e.message));
    }, 10000);

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
