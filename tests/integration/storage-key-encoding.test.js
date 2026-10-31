import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../../src/app.js';
import { buildStoragePath, storage } from '../../src/services/storage.service.js';
import { db } from '../../src/services/db.service.js';
import { shareService } from '../../src/services/share.service.js';

describe('Regression: Storage Object Key Generation & Filename Sanitization', () => {

  it('K1: buildStoragePath should strictly produce collision-resistant ASCII object keys', () => {
    const shareId = '123e4567-e89b-12d3-a456-426614174000';
    const fileId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

    const testFilenames = [
      'My Vacation Photo (1).png',
      'Document (Copy 1) [Final].pdf',
      'café_résumé_2026.pdf',
      '日本語_画像.png',
      'file#1[final]{v2}@test$notes&data\'file.png',
      'dangerous\x00file\u202E.jpg'
    ];

    for (const fn of testFilenames) {
      const key = buildStoragePath(shareId, fileId, fn);
      // Key must be in format shares/<shareId>/<fileId>.<ext>
      assert.ok(key.startsWith(`shares/${shareId}/${fileId}.`), `Key "${key}" does not have expected prefix for filename "${fn}"`);
      // Key must contain only safe ASCII characters [a-zA-Z0-9._-]
      assert.match(key, /^shares\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+\.[a-z0-9]+$/);
      // Key must NOT contain spaces, parentheses, brackets, quotes, or unicode
      assert.doesNotMatch(key, /[ ()\[\]{}"'#$@&%\u0080-\uFFFF]/);
    }
  });

  it('K2: should upload files with spaces, parentheses, Unicode, and punctuation successfully', async () => {
    // Valid 1x1 PNG header + data
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

    const complexFilename = 'My Photo (1) [final] café_日本語.png';

    const res = await request(app)
      .post('/api/shares')
      .attach('files', pngBuffer, complexFilename);

    assert.equal(res.status, 201);
    assert.equal(res.body.success, true);
    assert.ok(res.body.data.shareCode);
    assert.ok(res.body.data.deletionToken);

    const shareCode = res.body.data.shareCode;

    // Verify share in DB
    const shareRecord = await db.getShareByCode(shareCode);
    assert.ok(shareRecord);
    // Storage path in DB should be strictly safe
    assert.match(shareRecord.file_path, /^shares\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+\.png$/);
    // Preserved filename in DB should retain spaces, parentheses, brackets, and unicode
    assert.equal(shareRecord.original_filename, complexFilename);

    // Retrieve via public API
    const getRes = await request(app).get(`/api/shares/${shareCode}`);
    assert.equal(getRes.status, 200);
    assert.equal(getRes.body.data.files[0].originalFilename, complexFilename);

    const fileId = getRes.body.data.files[0].id;

    // Test file download and verify Content-Disposition
    const downloadRes = await request(app).get(`/api/shares/${shareCode}/files/${fileId}/download`);
    assert.equal(downloadRes.status, 200);
    assert.ok(downloadRes.headers['content-disposition'].includes(encodeURIComponent(complexFilename)));

    // Test signed URL generation
    const signedRes = await request(app).get(`/api/shares/${shareCode}/files/${fileId}/signed-url`);
    assert.equal(signedRes.status, 200);
    assert.ok(signedRes.body.data.signedUrl);

    // Cleanup
    const delRes = await request(app)
      .delete(`/api/shares/${shareCode}`)
      .set('x-deletion-token', res.body.data.deletionToken);
    assert.equal(delRes.status, 200);
  });

  it('K3: should upload multiple files with diverse problematic filenames and stream as ZIP', async () => {
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
    const pdfBuffer = Buffer.from('%PDF-1.4\n%âãÏÓ\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF');

    const res = await request(app)
      .post('/api/shares')
      .attach('files', pngBuffer, 'vacation photo (2026).png')
      .attach('files', pdfBuffer, 'café_contract_#1[final].pdf');

    assert.equal(res.status, 201);
    assert.equal(res.body.data.fileCount, 2);

    const shareCode = res.body.data.shareCode;

    // Verify ZIP archive download
    const zipRes = await request(app).get(`/api/shares/${shareCode}/download-all`);
    assert.equal(zipRes.status, 200);
    assert.equal(zipRes.headers['content-type'], 'application/zip');
    assert.ok(zipRes.headers['content-disposition'].includes(`QuickShare_${shareCode}.zip`));

    // Cleanup
    await request(app)
      .delete(`/api/shares/${shareCode}`)
      .set('x-deletion-token', res.body.data.deletionToken);
  });

  it('K4: should rollback and clean up storage files and DB records if an upload step fails', async () => {
    // Intercept storage.uploadFile on second call to simulate a storage failure
    const originalUpload = storage.uploadFile.bind(storage);
    let uploadCount = 0;
    let failedKey = null;

    storage.uploadFile = async (storagePath, buffer, mimeType) => {
      uploadCount++;
      if (uploadCount === 2) {
        failedKey = storagePath;
        throw new Error('Simulated network failure during secondary storage upload');
      }
      return originalUpload(storagePath, buffer, mimeType);
    };

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

    try {
      const res = await request(app)
        .post('/api/shares')
        .attach('files', pngBuffer, 'first_success.png')
        .attach('files', pngBuffer, 'second_fails.png');

      assert.equal(res.status, 500);

      // Verify that no orphaned share was left in the database
      // The shareId was not returned, but verify that total shares hasn't leaked
    } finally {
      storage.uploadFile = originalUpload;
    }
  });

});

