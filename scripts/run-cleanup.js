#!/usr/bin/env node

/**
 * F Share Standalone Cleanup Runner
 *
 * Designed to be executed directly by scheduled runners, Render Cron Jobs,
 * or administrative maintenance scripts:
 *   node scripts/run-cleanup.js
 */

import dotenv from 'dotenv';
dotenv.config();

import { cleanupService } from '../src/services/cleanup.service.js';

async function main() {
  console.log(`[${new Date().toISOString()}] 🚀 Initiating scheduled file expiration cleanup...`);
  try {
    const result = await cleanupService.runCleanup();
    if (result.error) {
      console.error(`❌ Cleanup failed:`, result.error);
      process.exit(1);
    }
    console.log(`✨ Cleanup completed successfully: ${result.cleanedCount} share(s) purged, ${result.failedCount || 0} failed/deferred.`);
    process.exit(0);
  } catch (err) {
    console.error(`💥 Unhandled exception during cleanup:`, err.message);
    process.exit(1);
  }
}

main();
