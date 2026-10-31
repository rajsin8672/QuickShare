import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../../src/app.js';
import { db } from '../../src/services/db.service.js';

describe('Short-Lived Signed Download URLs Integration', () => {
  it('U1: should generate short-lived signed URL for an authorized share file', async () => {
    // 1. Create a share with a text file
    const uploadRes = await request(app)
      .post('/api/shares')
      .field('textContent', 'Testing signed URL download endpoint')
      .attach('files', Buffer.from('Confidential QuickShare test document contents'), 'signed-test.txt');

    assert.equal(uploadRes.status, 201);
    const { shareCode } = uploadRes.body.data;

    // 2. Retrieve share metadata to obtain fileId
    const getRes = await request(app).get(`/api/shares/${shareCode}`);
    assert.equal(getRes.status, 200);
    const files = getRes.body.data.files;
    assert.equal(files.length, 1);
    const fileId = files[0].id;

    // 3. Request short-lived signed URL (valid for 60 seconds)
    const signedUrlRes = await request(app)
      .get(`/api/shares/${shareCode}/files/${fileId}/signed-url?expiresIn=60`);

    assert.equal(signedUrlRes.status, 200);
    assert.equal(signedUrlRes.body.success, true);
    assert.ok(signedUrlRes.body.data.signedUrl);
    assert.equal(signedUrlRes.body.data.expiresInSeconds, 60);
    assert.equal(signedUrlRes.body.data.filename, 'signed-test.txt');

    // 4. Download file using the signed URL
    const signedUrl = signedUrlRes.body.data.signedUrl;
    const downloadRes = await request(app).get(signedUrl);

    assert.equal(downloadRes.status, 200);
    const content = downloadRes.text || downloadRes.body.toString('utf8');
    assert.equal(content, 'Confidential QuickShare test document contents');
    assert.ok(downloadRes.headers['content-disposition'].includes('signed-test.txt'));
  });

  it('U2: should reject tampered signed URL signature', async () => {
    // Attempt download with an altered signature
    const tamperedUrl = '/api/shares/local-storage/download?path=shares/test/123-file.txt&expires=9999999999&sig=tampered_invalid_hex_signature_abcdef123456';
    const res = await request(app).get(tamperedUrl);

    assert.equal(res.status, 403);
    assert.equal(res.body.success, false);
    assert.ok(res.body.error.includes('signature') || res.body.error.includes('tampered'));
  });

  it('U3: should reject expired signed URL', async () => {
    // URL with past expiration timestamp
    const pastExpires = Math.floor(Date.now() / 1000) - 30; // 30 seconds ago
    const res = await request(app).get(`/api/shares/local-storage/download?path=shares/test/doc.txt&expires=${pastExpires}&sig=anysig`);

    assert.equal(res.status, 410);
    assert.equal(res.body.success, false);
    assert.ok(res.body.error.includes('expired'));
  });

  it('U4: should support 302 redirect on download endpoint when redirect=true is passed', async () => {
    // 1. Create a share
    const uploadRes = await request(app)
      .post('/api/shares')
      .attach('files', Buffer.from('Redirect test data'), 'redirect-test.txt');

    assert.equal(uploadRes.status, 201);
    const { shareCode } = uploadRes.body.data;

    const getRes = await request(app).get(`/api/shares/${shareCode}`);
    const fileId = getRes.body.data.files[0].id;

    // 2. Call download endpoint with redirect=true
    const redirectRes = await request(app)
      .get(`/api/shares/${shareCode}/files/${fileId}/download?redirect=true`)
      .redirects(0); // do not follow redirect to assert 302

    assert.equal(redirectRes.status, 302);
    assert.ok(redirectRes.headers.location);
    assert.ok(redirectRes.headers.location.includes('download'));
  });

  it('U5: should enforce download limit when requesting signed URLs', async () => {
    // Create share with download limit of 1
    const uploadRes = await request(app)
      .post('/api/shares')
      .field('downloadLimit', '1')
      .attach('files', Buffer.from('One-time signed file'), 'onetime.txt');

    assert.equal(uploadRes.status, 201);
    const { shareCode } = uploadRes.body.data;
    const getRes = await request(app).get(`/api/shares/${shareCode}`);
    const fileId = getRes.body.data.files[0].id;

    // First signed URL generation: should succeed
    const firstRes = await request(app).get(`/api/shares/${shareCode}/files/${fileId}/signed-url`);
    assert.equal(firstRes.status, 200);

    // Second signed URL generation: should be rejected because limit is reached
    const secondRes = await request(app).get(`/api/shares/${shareCode}/files/${fileId}/signed-url`);
    assert.equal(secondRes.status, 410);
    assert.ok(secondRes.body.error.includes('limit reached'));
  });
});
