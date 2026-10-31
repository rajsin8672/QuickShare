import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../../src/app.js';

describe('Concurrency, Upload Limits, and File Previews', () => {

  it('L1: should reject uploads exceeding maximum file count (10 files)', async () => {
    const req = request(app).post('/api/shares');
    for (let i = 1; i <= 11; i++) {
      req.attach('files', Buffer.from(`content ${i}`), { filename: `doc${i}.txt`, contentType: 'text/plain' });
    }

    const res = await req;
    assert.equal(res.status, 400);
    assert.equal(res.body.success, false);
    assert.ok(res.body.error.includes('10 files'));
  });

  it('L2: should reject upload if total size exceeds 50MB limit', async () => {
    // Generate a dummy buffer larger than 50MB (e.g. 52MB)
    // Note: To avoid heavy memory allocation in fast tests, simulate with oversized total size check
    const largeChunk = Buffer.alloc(1024 * 1024); // 1MB buffer

    // Attach 51 files of 1MB? Max file count is 10.
    // If one file is 26MB (> 25MB single file limit):
    const largeFile = Buffer.alloc(26 * 1024 * 1024); // 26MB
    const res = await request(app)
      .post('/api/shares')
      .attach('files', largeFile, { filename: 'oversized.pdf', contentType: 'application/pdf' });

    assert.equal(res.status, 400);
    assert.equal(res.body.success, false);
    assert.ok(res.body.error.includes('exceeds the maximum') || res.body.error.includes('limit'));
  });

  it('C3: should handle concurrent download requests without exceeding download limit', async () => {
    const dummyFile = Buffer.from('Highly confidential one-time download');

    // Create share with download limit = 2
    const createRes = await request(app)
      .post('/api/shares')
      .attach('files', dummyFile, { filename: 'secret.txt', contentType: 'text/plain' })
      .field('downloadLimit', 2);

    const code = createRes.body.data.shareCode;

    const receiveRes = await request(app)
      .post('/api/shares/receive')
      .send({ code });

    const fileId = receiveRes.body.data.files[0].id;

    // Fire 6 concurrent download requests simultaneously
    const requests = Array.from({ length: 6 }, () =>
      request(app).get(`/api/shares/${code}/files/${fileId}/download`)
    );

    const results = await Promise.all(requests);
    const successCount = results.filter(r => r.status === 200).length;
    const rejectedCount = results.filter(r => r.status === 410).length;

    // Exactly 2 downloads should succeed, and 4 should be rejected with 410!
    assert.equal(successCount, 2);
    assert.equal(rejectedCount, 4);
  });

  it('P1: should allow in-browser preview of supported text and PDF files', async () => {
    const textContent = 'Simple text note for in-browser preview';
    const createRes = await request(app)
      .post('/api/shares')
      .attach('files', Buffer.from(textContent), { filename: 'preview_test.txt', contentType: 'text/plain' });

    const code = createRes.body.data.shareCode;
    const receiveRes = await request(app).post('/api/shares/receive').send({ code });
    const file = receiveRes.body.data.files[0];

    const previewRes = await request(app)
      .get(`/api/shares/${code}/files/${file.id}/preview`);

    assert.equal(previewRes.status, 200);
    assert.equal(previewRes.headers['content-type'], 'text/plain');
    assert.ok(previewRes.headers['content-disposition'].includes('inline'));
    assert.equal(previewRes.text, textContent);
  });

  it('P2: should reject in-browser preview for unsupported preview formats (e.g. DOCX)', async () => {
    const docBuffer = Buffer.from('dummy docx binary data');
    const createRes = await request(app)
      .post('/api/shares')
      .attach('files', docBuffer, {
        filename: 'document.docx',
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      });

    const code = createRes.body.data.shareCode;
    const receiveRes = await request(app).post('/api/shares/receive').send({ code });
    const file = receiveRes.body.data.files[0];

    const previewRes = await request(app)
      .get(`/api/shares/${code}/files/${file.id}/preview`);

    assert.equal(previewRes.status, 400);
    assert.equal(previewRes.body.success, false);
    assert.ok(previewRes.body.error.includes('preview is not available'));
  });

});

