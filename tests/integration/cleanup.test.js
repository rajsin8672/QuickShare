import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../../src/app.js';
import { db } from '../../src/services/db.service.js';
import { storage } from '../../src/services/storage.service.js';
import { cleanupService } from '../../src/services/cleanup.service.js';
import { config } from '../../src/config/env.js';

describe('Complete Automatic File Expiration and Cleanup System Integration', () => {

  const testCronSecret = 'test_cleanup_secret_32_chars_min';

  // 1. Default 24-hour expiration
  it('E1: should set default expiration to 24 hours (1440 minutes) when no expiry option is provided', async () => {
    const res = await request(app)
      .post('/api/shares')
      .field('textContent', 'Testing default expiration');

    assert.equal(res.status, 201);
    const expiresAt = new Date(res.body.data.expiresAt);
    const now = Date.now();
    const diffHours = (expiresAt.getTime() - now) / (1000 * 60 * 60);

    // Should expire in approximately 24 hours (between 23.9 and 24.1 hours)
    assert.ok(diffHours >= 23.9 && diffHours <= 24.1, `Expected ~24h, got ${diffHours}h`);
  });

  // 2. Each supported expiration option
  it('E2: should support each configured expiration option: 1h, 6h, 24h, 3d, 7d', async () => {
    const options = [
      { minutes: 60, expectedHours: 1 },
      { minutes: 360, expectedHours: 6 },
      { minutes: 1440, expectedHours: 24 },
      { minutes: 4320, expectedHours: 72 }, // 3 days
      { minutes: 10080, expectedHours: 168 } // 7 days
    ];

    for (const opt of options) {
      const res = await request(app)
        .post('/api/shares')
        .field('textContent', `Test expiry ${opt.minutes}`)
        .field('expiryMinutes', opt.minutes);

      assert.equal(res.status, 201);
      const expiresAt = new Date(res.body.data.expiresAt);
      const diffHours = (expiresAt.getTime() - Date.now()) / (1000 * 60 * 60);
      assert.ok(
        Math.abs(diffHours - opt.expectedHours) < 0.2,
        `Expected ~${opt.expectedHours}h for ${opt.minutes}m, got ${diffHours.toFixed(2)}h`
      );
    }
  });

  // 3. Expired file access being rejected on all routes
  it('E3: should reject expired shares on all read, download, preview, and signed-url routes even before cleanup runs', async () => {
    const fileBuffer = Buffer.from('Confidential ephemeral document content');
    const createRes = await request(app)
      .post('/api/shares')
      .field('textContent', 'Secret note')
      .attach('files', fileBuffer, 'expired-doc.txt');

    assert.equal(createRes.status, 201);
    const code = createRes.body.data.shareCode;

    const share = await db.getShareByCode(code);
    const files = await db.getShareFiles(share.id);
    const fileId = files[0].id;

    // Mutate share expiration to the past (simulating time passing before cleanup runs)
    share.expires_at = new Date(Date.now() - 30000).toISOString();

    // Route 1: POST /api/shares/receive
    const receiveRes = await request(app)
      .post('/api/shares/receive')
      .send({ code });
    assert.equal(receiveRes.status, 410);
    assert.ok(receiveRes.body.error.includes('expired'));

    // Route 2: GET /api/shares/:code
    const getRes = await request(app)
      .get(`/api/shares/${code}`);
    assert.equal(getRes.status, 410);

    // Route 3: GET /api/shares/:code/files/:fileId/download
    const downloadRes = await request(app)
      .get(`/api/shares/${code}/files/${fileId}/download`);
    assert.equal(downloadRes.status, 410);

    // Route 4: GET /api/shares/:code/files/:fileId/preview
    const previewRes = await request(app)
      .get(`/api/shares/${code}/files/${fileId}/preview`);
    assert.equal(previewRes.status, 410);

    // Route 5: GET /api/shares/:code/download-all
    const zipRes = await request(app)
      .get(`/api/shares/${code}/download-all`);
    assert.equal(zipRes.status, 410);

    // Route 6: GET /api/shares/:code/files/:fileId/signed-url
    const signedRes = await request(app)
      .get(`/api/shares/${code}/files/${fileId}/signed-url`);
    assert.equal(signedRes.status, 410);

    // Route 7: GET /api/shares/:code/qr
    const qrRes = await request(app)
      .get(`/api/shares/${code}/qr`);
    assert.equal(qrRes.status, 410);
  });

  // 4. Non-expired files remaining accessible
  it('E4: should keep active non-expired shares completely accessible when cleanup runs', async () => {
    // Create an active share
    const activeRes = await request(app)
      .post('/api/shares')
      .field('textContent', 'Active non-expired content')
      .field('expiryMinutes', 1440);

    const activeCode = activeRes.body.data.shareCode;

    // Run cleanup pass
    await cleanupService.runCleanup();

    // Verify still active and fully accessible
    const checkRes = await request(app)
      .post('/api/shares/receive')
      .send({ code: activeCode });

    assert.equal(checkRes.status, 200);
    assert.equal(checkRes.body.data.textContent, 'Active non-expired content');
  });

  // 5. Successful Storage deletion and subsequent database deletion
  it('E5: should delete files from Storage and subsequently delete the database record upon expiration', async () => {
    const fileBuffer = Buffer.from('Purge me from storage and db');
    const createRes = await request(app)
      .post('/api/shares')
      .attach('files', fileBuffer, 'purge-target.txt');

    assert.equal(createRes.status, 201);
    const code = createRes.body.data.shareCode;

    const share = await db.getShareByCode(code);
    const files = await db.getShareFiles(share.id);
    const storagePath = files[0].storage_path;

    // Confirm file exists in storage right now
    const initialBuf = await storage.getFileBuffer(storagePath);
    assert.equal(initialBuf.toString(), 'Purge me from storage and db');

    // Expire the share in the database
    share.expires_at = new Date(Date.now() - 5000).toISOString();

    // Execute cleanup
    const cleanupResult = await cleanupService.runCleanup();
    assert.ok(cleanupResult.cleanedCount >= 1);

    // 1. Verify Storage file is deleted
    await assert.rejects(
      async () => await storage.getFileBuffer(storagePath),
      /File not found|Storage/
    );

    // 2. Verify database record is deleted
    const dbRecord = await db.getShareByCode(code);
    assert.equal(dbRecord, null);
  });

  // 6. Storage deletion failure preserving the database record for retry
  it('E6: should preserve database record for retry if Storage deletion fails', async () => {
    const fileBuffer = Buffer.from('Resilient storage test');
    const createRes = await request(app)
      .post('/api/shares')
      .attach('files', fileBuffer, 'retry-test.txt');

    const code = createRes.body.data.shareCode;

    // Backdate expiration
    const shareRecord = await db.getShareByCode(code);
    shareRecord.expires_at = new Date(Date.now() - 5000).toISOString();

    // Temporarily mock storage.deleteFiles to simulate failure (e.g. network partition)
    const originalDeleteFiles = storage.deleteFiles.bind(storage);
    storage.deleteFiles = async () => {
      throw new Error('Simulated network failure connecting to Storage');
    };

    try {
      // Run cleanup pass while storage is failing
      const failedResult = await cleanupService.runCleanup();
      assert.ok(failedResult.failedCount >= 1, 'Should record failed share in failure stats');

      // Crucial verification: The database record MUST still exist for automatic retry
      const preservedShare = await db.getShareByCode(code);
      assert.ok(preservedShare !== null, 'Database record must be preserved when Storage deletion fails');
    } finally {
      // Restore original storage deletion
      storage.deleteFiles = originalDeleteFiles;
    }

    // Now execute cleanup again (retry)
    const retryResult = await cleanupService.runCleanup();
    assert.ok(retryResult.cleanedCount >= 1, 'Retry should successfully purge the deferred share');

    // Verify it is now deleted from the database
    const finalCheck = await db.getShareByCode(code);
    assert.equal(finalCheck, null);
  });

  // 7. Missing Storage objects handled safely & idempotently
  it('E7: should handle already-missing Storage objects safely and still purge the DB record', async () => {
    const fileBuffer = Buffer.from('Ephemeral ghost object');
    const createRes = await request(app)
      .post('/api/shares')
      .attach('files', fileBuffer, 'ghost.txt');

    const code = createRes.body.data.shareCode;
    const share = await db.getShareByCode(code);
    const files = await db.getShareFiles(share.id);
    const storagePath = files[0].storage_path;

    // Pre-delete the storage file manually (simulating out-of-band deletion or missing object)
    await storage.deleteFiles([storagePath]);

    // Backdate expiration
    share.expires_at = new Date(Date.now() - 5000).toISOString();

    // Execute cleanup
    const result = await cleanupService.runCleanup();
    assert.ok(result.cleanedCount >= 1, 'Should safely clean up share with missing storage file');

    // DB record should be cleanly purged
    const dbCheck = await db.getShareByCode(code);
    assert.equal(dbCheck, null);
  });

  // 8. Password-protected file behavior
  it('E8: should reject password verification on expired shares and preserve protection on active ones', async () => {
    // 8a: Create an expired password-protected share
    const expiredRes = await request(app)
      .post('/api/shares')
      .field('textContent', 'Password protected secret')
      .field('password', 'SecretPass123!');

    const expiredCode = expiredRes.body.data.shareCode;
    const expiredRecord = await db.getShareByCode(expiredCode);
    expiredRecord.expires_at = new Date(Date.now() - 10000).toISOString();

    // Password verification must fail with 410 Gone
    const verifyExpired = await request(app)
      .post(`/api/shares/${expiredCode}/verify-password`)
      .send({ password: 'SecretPass123!' });

    assert.equal(verifyExpired.status, 410);
    assert.ok(verifyExpired.body.error.includes('expired'));

    // 8b: Create an active password-protected share
    const activeRes = await request(app)
      .post('/api/shares')
      .field('textContent', 'Active password note')
      .field('password', 'ActivePass123!');

    const activeCode = activeRes.body.data.shareCode;

    // Verify password unlocks active share
    const verifyActive = await request(app)
      .post(`/api/shares/${activeCode}/verify-password`)
      .send({ password: 'ActivePass123!' });

    assert.equal(verifyActive.status, 200);
    assert.ok(verifyActive.body.data.token);
  });

  // 9. Signed URL expiration capping
  it('E9: should clamp signed download URL lifetime to never exceed the share expiration time', async () => {
    const fileBuffer = Buffer.from('Signed URL lifetime clamping test');
    const createRes = await request(app)
      .post('/api/shares')
      .attach('files', fileBuffer, 'cap-test.txt');

    const code = createRes.body.data.shareCode;
    const share = await db.getShareByCode(code);
    const files = await db.getShareFiles(share.id);
    const fileId = files[0].id;

    // Set share to expire in 25 seconds
    share.expires_at = new Date(Date.now() + 25000).toISOString();

    // Client requests signed URL with 300s expiry
    const signedRes = await request(app)
      .get(`/api/shares/${code}/files/${fileId}/signed-url?expiresIn=300`);

    assert.equal(signedRes.status, 200);
    // The returned expiresInSeconds MUST be clamped to remaining share seconds (<= 25s)
    assert.ok(
      signedRes.body.data.expiresInSeconds <= 25,
      `Expected expiresInSeconds <= 25, got ${signedRes.body.data.expiresInSeconds}`
    );
  });

  // 10. Authenticated cleanup endpoint security
  it('E10: should reject unauthorized cleanup requests and execute successfully with valid credentials', async () => {
    // 10a: Unauthorized request without credentials -> 401
    const unauthRes = await request(app)
      .post('/api/cleanup');
    assert.equal(unauthRes.status, 401);
    assert.ok(unauthRes.body.error.includes('Unauthorized'));

    // 10b: Request with incorrect token -> 401
    const badTokenRes = await request(app)
      .post('/api/cleanup')
      .set('Authorization', 'Bearer invalid_wrong_token_123');
    assert.equal(badTokenRes.status, 401);

    // 10c: Authorized request with valid Bearer token -> 200
    const authRes = await request(app)
      .post('/api/cleanup')
      .set('Authorization', `Bearer ${testCronSecret}`);
    assert.equal(authRes.status, 200);
    assert.equal(authRes.body.success, true);
    assert.ok(typeof authRes.body.cleanedCount === 'number');

    // 10d: Authorized request via x-cleanup-key header -> 200
    const headerRes = await request(app)
      .post('/api/cleanup')
      .set('x-cleanup-key', testCronSecret);
    assert.equal(headerRes.status, 200);
    assert.equal(headerRes.body.success, true);

    // 10e: Authorized GET request for simple webhook monitors -> 200
    const getRes = await request(app)
      .get(`/api/cleanup?key=${testCronSecret}`);
    assert.equal(getRes.status, 200);
    assert.equal(getRes.body.success, true);
  });

  // 11. Cleanup idempotency and repeated execution
  it('E11: should execute repeated cleanup passes idempotently without throws or regressions', async () => {
    const res1 = await cleanupService.runCleanup();
    const res2 = await cleanupService.runCleanup();
    const res3 = await cleanupService.runCleanup();

    assert.equal(typeof res1.cleanedCount, 'number');
    assert.equal(typeof res2.cleanedCount, 'number');
    assert.equal(typeof res3.cleanedCount, 'number');
  });

});
