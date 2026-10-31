import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../../src/app.js';

describe('Share Creation, Receiving, and Downloading API Integration', () => {

  it('A1: should create a text-only share successfully', async () => {
    const res = await request(app)
      .post('/api/shares')
      .field('textContent', 'Hello from QuickShare automated test!')
      .field('expiryMinutes', 30);

    assert.equal(res.status, 201);
    assert.equal(res.body.success, true);
    assert.ok(res.body.data.shareCode);
    assert.equal(res.body.data.fileCount, 0);
    assert.ok(res.body.data.deletionToken);
  });

  it('A2: should create a single-file share successfully', async () => {
    const dummyPdf = Buffer.from('%PDF-1.4 dummy pdf binary stream');

    const res = await request(app)
      .post('/api/shares')
      .attach('files', dummyPdf, { filename: 'test-document.pdf', contentType: 'application/pdf' })
      .field('expiryMinutes', 60);

    assert.equal(res.status, 201);
    assert.equal(res.body.success, true);
    assert.ok(res.body.data.shareCode);
    assert.equal(res.body.data.fileCount, 1);
  });

  it('A3: should create a multiple-file share with text', async () => {
    const file1 = Buffer.from('console.log("hello");');
    const file2 = Buffer.from('data:image/png;base64,dummyimagecontent');

    const res = await request(app)
      .post('/api/shares')
      .attach('files', file1, { filename: 'notes.txt', contentType: 'text/plain' })
      .attach('files', file2, { filename: 'screenshot.png', contentType: 'image/png' })
      .field('textContent', 'Shared project assets')
      .field('expiryMinutes', 1440);

    assert.equal(res.status, 201);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.fileCount, 2);
  });

  it('A4: should reject completely empty shares (no text and no files)', async () => {
    const res = await request(app)
      .post('/api/shares')
      .field('textContent', '')
      .field('expiryMinutes', 30);

    assert.equal(res.status, 400);
    assert.equal(res.body.success, false);
    assert.ok(res.body.error.includes('empty'));
  });

  it('A5: should reject unsupported file extensions', async () => {
    const scriptBuffer = Buffer.from('#!/bin/bash\necho dangerous');

    const res = await request(app)
      .post('/api/shares')
      .attach('files', scriptBuffer, { filename: 'script.sh', contentType: 'application/x-sh' });

    assert.equal(res.status, 400);
    assert.equal(res.body.success, false);
    assert.ok(res.body.error.includes('not supported'));
  });

  it('B1: should retrieve share details by valid code', async () => {
    // First create a share
    const createRes = await request(app)
      .post('/api/shares')
      .field('textContent', 'Verification message');

    const code = createRes.body.data.shareCode;

    // Lookup code
    const receiveRes = await request(app)
      .post('/api/shares/receive')
      .send({ code });

    assert.equal(receiveRes.status, 200);
    assert.equal(receiveRes.body.success, true);
    assert.equal(receiveRes.body.data.textContent, 'Verification message');
    assert.equal(receiveRes.body.data.requiresPassword, false);
  });

  it('B2: should return 404 for non-existent code', async () => {
    const res = await request(app)
      .post('/api/shares/receive')
      .send({ code: 'NOTFND' });

    assert.equal(res.status, 404);
    assert.equal(res.body.success, false);
  });

  it('B3: should handle password-protected shares securely', async () => {
    const sampleText = 'Confidential financial details';
    const createRes = await request(app)
      .post('/api/shares')
      .field('textContent', sampleText)
      .field('password', 'SuperSecretPass123!');

    const code = createRes.body.data.shareCode;

    // Receive without password should lock content
    const lockedRes = await request(app)
      .post('/api/shares/receive')
      .send({ code });

    assert.equal(lockedRes.status, 200);
    assert.equal(lockedRes.body.data.requiresPassword, true);
    assert.equal(lockedRes.body.data.textContent, undefined); // Sensitive text NOT disclosed!

    // Incorrect password verification
    const wrongPassRes = await request(app)
      .post(`/api/shares/${code}/verify-password`)
      .send({ password: 'WrongPassword' });

    assert.equal(wrongPassRes.status, 401);
    assert.equal(wrongPassRes.body.success, false);

    // Correct password verification
    const correctPassRes = await request(app)
      .post(`/api/shares/${code}/verify-password`)
      .send({ password: 'SuperSecretPass123!' });

    assert.equal(correctPassRes.status, 200);
    assert.equal(correctPassRes.body.success, true);
    assert.ok(correctPassRes.body.data.token);
    assert.equal(correctPassRes.body.data.share.textContent, sampleText);
  });

  it('C1: should download an authorized file and enforce download limits', async () => {
    const dummyFile = Buffer.from('Quarterly report data');

    const createRes = await request(app)
      .post('/api/shares')
      .attach('files', dummyFile, { filename: 'q3_report.txt', contentType: 'text/plain' })
      .field('downloadLimit', 1);

    const code = createRes.body.data.shareCode;

    // Get fileId
    const receiveRes = await request(app)
      .post('/api/shares/receive')
      .send({ code });

    const file = receiveRes.body.data.files[0];
    assert.ok(file && file.id);

    // First download succeeds
    const dl1 = await request(app)
      .get(`/api/shares/${code}/files/${file.id}/download`);

    assert.equal(dl1.status, 200);
    assert.equal(dl1.text, 'Quarterly report data');

    // Second download rejected because limit of 1 was reached!
    const dl2 = await request(app)
      .get(`/api/shares/${code}/files/${file.id}/download`);

    assert.equal(dl2.status, 410); // Gone / Limit reached
    assert.ok(dl2.body.error.includes('limit reached'));
  });

  it('C2: should stream multiple files as a ZIP archive', async () => {
    const f1 = Buffer.from('First file content');
    const f2 = Buffer.from('Second file content');

    const createRes = await request(app)
      .post('/api/shares')
      .attach('files', f1, { filename: 'file1.txt', contentType: 'text/plain' })
      .attach('files', f2, { filename: 'file2.txt', contentType: 'text/plain' });

    const code = createRes.body.data.shareCode;

    const zipRes = await request(app)
      .get(`/api/shares/${code}/download-all`)
      .buffer(true)
      .parse((res, cb) => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });

    assert.equal(zipRes.status, 200);
    assert.equal(zipRes.headers['content-type'], 'application/zip');
    assert.ok(zipRes.body && zipRes.body.length > 0);
  });

  it('D1: should allow owner to delete share and reject invalid deletion tokens', async () => {
    const createRes = await request(app)
      .post('/api/shares')
      .field('textContent', 'Content to be deleted soon');

    const code = createRes.body.data.shareCode;
    const deletionToken = createRes.body.data.deletionToken;

    // Attempt delete with invalid token
    const fakeDelRes = await request(app)
      .delete(`/api/shares/${code}`)
      .set('x-deletion-token', 'fake-random-token-here');

    assert.equal(fakeDelRes.status, 403);

    // Attempt delete with correct owner deletion token
    const realDelRes = await request(app)
      .delete(`/api/shares/${code}`)
      .set('x-deletion-token', deletionToken);

    assert.equal(realDelRes.status, 200);
    assert.equal(realDelRes.body.success, true);

    // Verify share is gone when receiver checks it
    const postDelRes = await request(app)
      .post('/api/shares/receive')
      .send({ code });

    assert.equal(postDelRes.status, 410);
    assert.ok(postDelRes.body.error.includes('deleted by the owner'));
  });

});
