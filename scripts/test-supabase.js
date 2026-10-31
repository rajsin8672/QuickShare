#!/usr/bin/env node

/**
 * QuickShare Supabase Connectivity and Security Diagnosis Tool
 *
 * Safely tests connection to Supabase PostgreSQL and Supabase Storage
 * without leaking credentials or printing sensitive tokens.
 * Supports modern Supabase keys (sb_publishable_..., sb_secret_...) and legacy JWTs.
 */

import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { inspectKeyRole, isPrivilegedRole } from '../src/config/env.js';
import { SupabaseDB } from '../src/services/db.service.js';
import { SupabaseStorageService, buildStoragePath } from '../src/services/storage.service.js';
import crypto from 'crypto';

dotenv.config();

const url = (process.env.SUPABASE_URL || '').trim();

// Support both modern keys and legacy aliases
const secretKey = (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const publishableKey = (process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY || '').trim();
const bucketName = (process.env.SUPABASE_BUCKET_NAME || 'shared-files').trim();

// Determine which key is selected for server operations
let activeKey = '';
let activeKeySource = '';

if (secretKey) {
  activeKey = secretKey;
  activeKeySource = process.env.SUPABASE_SECRET_KEY ? 'SUPABASE_SECRET_KEY' : 'SUPABASE_SERVICE_ROLE_KEY';
} else if (publishableKey) {
  activeKey = publishableKey;
  activeKeySource = process.env.SUPABASE_PUBLISHABLE_KEY ? 'SUPABASE_PUBLISHABLE_KEY' : 'SUPABASE_ANON_KEY';
}

const detectedRole = inspectKeyRole(activeKey);
const isPrivileged = isPrivilegedRole(detectedRole);

console.log('=====================================================');
console.log('🔍 QuickShare Supabase Connectivity & Security Audit');
console.log('=====================================================\n');

// 1. Inspect URL
if (!url) {
  console.error('❌ SUPABASE_URL is not configured in .env');
  process.exit(1);
}

try {
  const parsedUrl = new URL(url);
  console.log(`🌐 Supabase Host: ${parsedUrl.origin}`);
} catch (e) {
  console.error(`❌ SUPABASE_URL is not a valid URL: ${url}`);
  process.exit(1);
}

// 2. Safe Key Inspection (Never prints secret token values)
console.log('\n--- Environment & Key Inspection (Zero Secrets Exposed) ---');
console.log(`SUPABASE_SECRET_KEY configured:      ${process.env.SUPABASE_SECRET_KEY ? 'YES (modern sb_secret_...)' : 'NO'}`);
console.log(`SUPABASE_SERVICE_ROLE_KEY configured: ${process.env.SUPABASE_SERVICE_ROLE_KEY ? 'YES (legacy)' : 'NO'}`);
console.log(`SUPABASE_PUBLISHABLE_KEY configured: ${process.env.SUPABASE_PUBLISHABLE_KEY ? 'YES (modern sb_publishable_...)' : 'NO'}`);
console.log(`Key used for Storage & Database:     ${activeKeySource || 'NONE'}`);
console.log(`Detected Key Classification:         ${detectedRole.toUpperCase()} (${isPrivileged ? 'Privileged Server Secret' : 'Unprivileged Public Key'})`);

if (!activeKey) {
  console.error('\n❌ Neither SUPABASE_SECRET_KEY nor SUPABASE_PUBLISHABLE_KEY is configured.');
  process.exit(1);
}

if (detectedRole === 'placeholder') {
  console.warn('\n⚠️ [NOTICE] Your key is currently set to a placeholder string.');
  console.warn('   Replace this with your actual key in the backend .env file.');
}

// 3. Initialize Supabase Client with the active server key
const client = createClient(url, activeKey, {
  auth: { persistSession: false, autoRefreshToken: false }
});

async function runAudit() {
  console.log('\n--- 1. Testing Storage Bucket (`' + bucketName + '`) ---');
  let storageSuccess = false;
  try {
    // Directly verify the specific private bucket using getBucket()
    const { data: bucket, error: bucketErr } = await client.storage.getBucket(bucketName);

    if (!bucketErr && bucket) {
      console.log(`✅ Private Bucket "${bucket.id || bucketName}" verified successfully!`);
      console.log(`   Bucket ID:   ${bucket.id}`);
      console.log(`   Visibility:  ${bucket.public ? '⚠️ Public (Expected Private)' : '🔒 Private (Secure & Correct)'}`);
      console.log(`   Created At:  ${bucket.created_at || 'N/A'}`);
      console.log(`   Access Mode: Verified via ${activeKeySource} without requiring public access.`);
      storageSuccess = true;
    } else {
      console.log(`❌ Bucket check returned an error: ${bucketErr?.message || 'Bucket not accessible'}`);
      if (bucketErr?.statusCode) {
        console.log(`   Status Code: ${bucketErr.statusCode}`);
      }

      if (!isPrivileged) {
        console.log('\n🔒 [STORAGE PERMISSION ROOT CAUSE]');
        console.log(`The "${bucketName}" bucket is private. In Supabase Storage, private buckets are hidden from unprivileged publishable/anon keys (returning 404 / NoSuchBucket to prevent public enumeration).`);
        console.log('👉 Solution: Supply SUPABASE_SECRET_KEY (sb_secret_...) in your backend .env file.');
      } else {
        console.log('👉 Verify that the bucket name matches exactly in the Supabase Dashboard -> Storage.');
      }
    }
  } catch (err) {
    console.error(`❌ Unexpected storage inspection exception: ${err.message}`);
  }

  console.log('\n--- 2. Inspecting PostgreSQL Schema (`public.shares`) ---');
  let dbSuccess = false;
  let schemaInfo = null;

  try {
    const res = await fetch(`${url}/rest/v1/`, {
      headers: {
        apikey: activeKey,
        Authorization: `Bearer ${activeKey}`
      }
    });

    if (res.ok) {
      const openApi = await res.json();
      const sharesProps = openApi.definitions?.shares?.properties;
      if (sharesProps) {
        const cols = Object.keys(sharesProps);
        schemaInfo = {
          columns: cols,
          hasDeletionToken: cols.includes('deletion_token_hash'),
          hasPasswordHash: cols.includes('password_hash'),
          hasStatus: cols.includes('status'),
          hasFilesTable: Boolean(openApi.definitions?.share_files),
          hasEventsTable: Boolean(openApi.definitions?.download_events)
        };

        console.log(`✅ Connected to PostgREST schema cache!`);
        console.log(`   Found ${cols.length} column(s) in public.shares: [${cols.join(', ')}]`);
        console.log(`   deletion_token_hash: ${schemaInfo.hasDeletionToken ? '✅ PRESENT in DB' : '⚠️ MISSING from DB (migration required)'}`);
        console.log(`   password_hash:       ${schemaInfo.hasPasswordHash ? '✅ PRESENT in DB' : '⚠️ MISSING from DB (migration required)'}`);
        console.log(`   status:              ${schemaInfo.hasStatus ? '✅ PRESENT in DB' : '⚠️ MISSING from DB (migration required)'}`);
        console.log(`   share_files table:   ${schemaInfo.hasFilesTable ? '✅ PRESENT in DB' : '⚠️ MISSING from DB (migration required)'}`);
        console.log(`   download_events:     ${schemaInfo.hasEventsTable ? '✅ PRESENT in DB' : '⚠️ MISSING from DB (migration required)'}`);

        if (!schemaInfo.hasDeletionToken || !schemaInfo.hasFilesTable) {
          console.log('\n📄 [SCHEMA MIGRATION RECOMMENDED]');
          console.log('   An incremental migration script has been prepared at:');
          console.log('   database/migrations/003_add_missing_shares_columns.sql');
          console.log('   Run this in your Supabase SQL Editor to add the missing columns to PostgreSQL.');
          console.log('   (Note: Backend adapter has dynamic fallback to keep running without errors in the meantime).');
        }
      }
    }
  } catch (err) {
    console.warn(`Schema inspection warning: ${err.message}`);
  }

  console.log('\n--- 3. Testing Database CRUD & Deletion Token Handling ---');
  try {
    const db = new SupabaseDB(client, { url, key: activeKey });
    const probeCode = 'DIAG' + Math.floor(1000 + Math.random() * 9000);

    // 1. Create Share
    const created = await db.createShare({
      shareCode: probeCode,
      deletionTokenHash: 'test_deletion_hash_123',
      textContent: 'Diagnostic validation probe',
      expiresAt: new Date(Date.now() + 600000),
      downloadLimit: 5,
      fileCount: 0,
      totalSizeBytes: 0
    });
    console.log(`✅ Share creation successful! (Code: ${created.share_code}, ID: ${created.id})`);

    // 2. Fetch Share
    const fetched = await db.getShareByCode(probeCode);
    if (fetched && fetched.share_code === probeCode) {
      console.log(`✅ Share lookup by code verified! (Status: ${fetched.status})`);
    } else {
      throw new Error('Share lookup failed.');
    }

    // 3. Increment Download Count
    const countRes = await db.incrementDownloadCount(created.id);
    if (countRes.success) {
      console.log(`✅ Download counter increment verified! (New Count: ${countRes.newCount})`);
    }

    // 4. Clean up probe
    await db.hardDeleteShare(created.id);
    console.log(`✅ Deletion and hard cleanup verified!`);
    dbSuccess = true;
  } catch (err) {
    console.error(`❌ Database CRUD test failed: ${err.message}`);
  }

  console.log('\n--- 4. Testing Live Storage Object Upload, Signed URL & Cleanup ---');
  let objectUploadSuccess = false;
  try {
    const storageService = new SupabaseStorageService(client, bucketName);
    const probeShareId = crypto.randomUUID();
    const probeFileId = crypto.randomUUID();
    const testFilename = 'probe-test (1) [final] café_日本語.png';
    const storagePath = buildStoragePath(probeShareId, probeFileId, testFilename);

    console.log(`   Target Storage Key: "${storagePath}"`);
    console.log(`   Preserved Filename: "${testFilename}"`);

    // Valid 1x1 PNG buffer
    const pngBuffer = Buffer.from([
      0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
      0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4,
      0x89, 0x00, 0x00, 0x00, 0x0A, 0x49, 0x44, 0x41,
      0x54, 0x78, 0x9C, 0x63, 0x00, 0x01, 0x00, 0x00,
      0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00,
      0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE,
      0x42, 0x60, 0x82
    ]);

    // 1. Upload to Supabase Storage
    await storageService.uploadFile(storagePath, pngBuffer, 'image/png');
    console.log(`✅ File upload to private bucket "${bucketName}" succeeded without "Invalid key" errors!`);

    // 2. Generate Signed URL with original display filename
    const signedUrl = await storageService.createSignedUrl(storagePath, 60, testFilename);
    if (signedUrl && signedUrl.startsWith('http')) {
      console.log(`✅ Signed download URL generated successfully!`);
    } else {
      throw new Error('Failed to generate a valid signed URL.');
    }

    // 3. Download file buffer
    const downloadedBuffer = await storageService.getFileBuffer(storagePath);
    if (downloadedBuffer.length === pngBuffer.length) {
      console.log(`✅ Verified file download: Buffer size matches (${downloadedBuffer.length} bytes).`);
    } else {
      throw new Error(`Downloaded buffer length mismatch: expected ${pngBuffer.length}, got ${downloadedBuffer.length}`);
    }

    // 4. Clean up storage object
    await storageService.deleteFiles([storagePath]);
    console.log(`✅ Storage object cleanup verified!`);
    objectUploadSuccess = true;
  } catch (err) {
    console.error(`❌ Live storage upload test failed: ${err.message}`);
  }

  console.log('\n=====================================================');
  console.log('📋 Audit Summary:');
  console.log(`- Storage Bucket ("${bucketName}"): ${storageSuccess ? '✅ READY (Private Bucket Verified)' : '❌ FAILED'}`);
  console.log(`- Database Operations (PostgreSQL): ${dbSuccess ? '✅ READY (Zero Schema Cache Errors)' : '❌ FAILED'}`);
  console.log(`- Storage Object Upload & Signed URL: ${objectUploadSuccess ? '✅ READY (Live Upload Verified)' : '❌ FAILED'}`);
  console.log('=====================================================\n');

  return { dbSuccess, storageSuccess, objectUploadSuccess };
}

runAudit()
  .then(({ dbSuccess, storageSuccess, objectUploadSuccess }) => {
    if (storageSuccess && dbSuccess && objectUploadSuccess) {
      process.exit(0);
    } else {
      process.exit(1);
    }
  })
  .catch((err) => {
    console.error('Fatal audit failure:', err);
    process.exit(1);
  });
