import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../../src/app.js';
import { db } from '../../src/services/db.service.js';
import { cleanupService } from '../../src/services/cleanup.service.js';

describe('Expiration Enforcement and Cleanup Service Integration', () => {

  it('E1: should reject access to expired shares even before cleanup executes', async () => {
    // Create an active share
    const createRes = await request(app)
      .post('/api/shares')
      .field('textContent', 'Ephemeral test message');

    const code = createRes.body.data.shareCode;

    // Manually mutate expiration in db to past timestamp
    const shareRecord = await db.getShareByCode(code);
    shareRecord.expires_at = new Date(Date.now() - 10000).toISOString();

    // Receiver attempts to access expired share
    const receiveRes = await request(app)
      .post('/api/shares/receive')
      .send({ code });

    assert.equal(receiveRes.status, 410);
    assert.ok(receiveRes.body.error.includes('expired'));
  });

  it('E2: should run cleanup service, purge expired files, and maintain active shares', async () => {
    // Create an active share that expires in the future
    const activeShareRes = await request(app)
      .post('/api/shares')
      .field('textContent', 'I should remain active');
    const activeCode = activeShareRes.body.data.shareCode;

    // Create an expired share
    const expiredShareRes = await request(app)
      .post('/api/shares')
      .field('textContent', 'I should be cleaned up');
    const expiredCode = expiredShareRes.body.data.shareCode;

    // Backdate expiration
    const expiredRecord = await db.getShareByCode(expiredCode);
    expiredRecord.expires_at = new Date(Date.now() - 60000).toISOString();

    // Execute cleanup
    const result = await cleanupService.runCleanup();
    assert.ok(result.cleanedCount >= 1);

    // Verify expired share status is updated to expired
    const checkExpired = await db.getShareByCode(expiredCode);
    assert.equal(checkExpired.status, 'expired');

    // Verify active share is still active and accessible!
    const activeCheck = await request(app)
      .post('/api/shares/receive')
      .send({ code: activeCode });

    assert.equal(activeCheck.status, 200);
    assert.equal(activeCheck.body.data.textContent, 'I should remain active');
  });

  it('E3: should execute cleanup idempotently without throwing errors', async () => {
    // Running multiple consecutive times should be safe
    const res1 = await cleanupService.runCleanup();
    const res2 = await cleanupService.runCleanup();
    assert.ok(typeof res1.cleanedCount === 'number');
    assert.ok(typeof res2.cleanedCount === 'number');
  });

});
