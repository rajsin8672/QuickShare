import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../../src/app.js';

describe('Regression: File-Only Upload & Constraint Verification', () => {
  it('R1: should successfully create a file-only share without text content', async () => {
    const res = await request(app)
      .post('/api/shares')
      .attach('files', Buffer.from('File-only upload regression test buffer'), 'file-only-test.txt');

    assert.equal(res.status, 201);
    assert.equal(res.body.success, true);
    assert.ok(res.body.data.shareCode);
    assert.ok(res.body.data.deletionToken);
    assert.equal(res.body.data.fileCount, 1);

    const shareCode = res.body.data.shareCode;

    // Retrieve the file-only share
    const getRes = await request(app).get(`/api/shares/${shareCode}`);
    assert.equal(getRes.status, 200);
    assert.equal(getRes.body.data.hasText, undefined); // text_content is null/empty
    assert.equal(getRes.body.data.textContent, null);
    assert.equal(getRes.body.data.files.length, 1);
    assert.equal(getRes.body.data.files[0].originalFilename, 'file-only-test.txt');

    // Clean up with deletion token
    const delRes = await request(app)
      .delete(`/api/shares/${shareCode}`)
      .set('x-deletion-token', res.body.data.deletionToken);
    assert.equal(delRes.status, 200);
    assert.equal(delRes.body.success, true);
  });

  it('R2: should successfully create a text-only share without any uploaded files', async () => {
    const res = await request(app)
      .post('/api/shares')
      .field('textContent', 'Pure text message without attachments');

    assert.equal(res.status, 201);
    assert.equal(res.body.success, true);
    assert.ok(res.body.data.shareCode);
    assert.equal(res.body.data.fileCount, 0);

    const shareCode = res.body.data.shareCode;

    // Retrieve text-only share
    const getRes = await request(app).get(`/api/shares/${shareCode}`);
    assert.equal(getRes.status, 200);
    assert.equal(getRes.body.data.textContent, 'Pure text message without attachments');
    assert.equal(getRes.body.data.files.length, 0);

    // Clean up
    await request(app)
      .delete(`/api/shares/${shareCode}`)
      .set('x-deletion-token', res.body.data.deletionToken);
  });

  it('R3: should successfully create a mixed share containing both text and uploaded files', async () => {
    const res = await request(app)
      .post('/api/shares')
      .field('textContent', 'Mixed share message text')
      .attach('files', Buffer.from('Attached file contents'), 'attachment.txt');

    assert.equal(res.status, 201);
    assert.equal(res.body.success, true);
    assert.ok(res.body.data.shareCode);
    assert.equal(res.body.data.fileCount, 1);

    const shareCode = res.body.data.shareCode;

    // Retrieve mixed share
    const getRes = await request(app).get(`/api/shares/${shareCode}`);
    assert.equal(getRes.status, 200);
    assert.equal(getRes.body.data.textContent, 'Mixed share message text');
    assert.equal(getRes.body.data.files.length, 1);

    // Clean up
    await request(app)
      .delete(`/api/shares/${shareCode}`)
      .set('x-deletion-token', res.body.data.deletionToken);
  });
});

