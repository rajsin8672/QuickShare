import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../../src/app.js';

describe('Security & Authorization Boundary Tests', () => {

  it('S1: health endpoint should return 200 without exposing database or storage secrets', async () => {
    const res = await request(app).get('/api/health');

    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'healthy');
    assert.equal(res.body.serviceRoleKey, undefined);
    assert.equal(res.body.supabaseServiceRoleKey, undefined);
    assert.equal(res.body.shareTokenSecret, undefined);
  });

  it('S2: should prevent accessing a file using another share code', async () => {
    // Share 1 with file
    const res1 = await request(app)
      .post('/api/shares')
      .attach('files', Buffer.from('Share 1 content'), { filename: 'file1.txt', contentType: 'text/plain' });
    const code1 = res1.body.data.shareCode;

    // Share 2
    const res2 = await request(app)
      .post('/api/shares')
      .field('textContent', 'Share 2 text only');
    const code2 = res2.body.data.shareCode;

    // Get fileId from Share 1
    const share1Details = await request(app).post('/api/shares/receive').send({ code: code1 });
    const fileId1 = share1Details.body.data.files[0].id;

    // Attempt to download fileId1 using code2!
    const spoofRes = await request(app)
      .get(`/api/shares/${code2}/files/${fileId1}/download`);

    assert.equal(spoofRes.status, 404);
    assert.ok(spoofRes.body.error.includes('not found in this share'));
  });

  it('S3: should return custom 404 for undefined API endpoints', async () => {
    const res = await request(app).get('/api/non-existent-endpoint');
    assert.equal(res.status, 404);
    assert.equal(res.body.success, false);
  });

  it('S4: should return HTML 404 page for undefined web routes', async () => {
    const res = await request(app).get('/non-existent-web-page.html');
    assert.equal(res.status, 404);
    assert.ok(res.text.includes('Page Not Found'));
  });

});

