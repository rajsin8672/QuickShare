import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../../src/app.js';
import { inspectKeyRole, isPrivilegedRole, config } from '../../src/config/env.js';

describe('Supabase Environment & Key Role Detection', () => {
  it('K1: should identify placeholder keys correctly', () => {
    assert.equal(inspectKeyRole('YOUR_COPIED_PUBLISHABLE_KEY'), 'placeholder');
    assert.equal(inspectKeyRole('YOUR_COPIED_SERVICE_ROLE_KEY'), 'placeholder');
    assert.equal(inspectKeyRole(''), 'none');
    assert.equal(inspectKeyRole(null), 'none');
  });

  it('K2: should safely detect modern sb_publishable and sb_secret keys', () => {
    assert.equal(inspectKeyRole('sb_publishable_abc123XYZ'), 'publishable');
    assert.equal(isPrivilegedRole('publishable'), false);

    assert.equal(inspectKeyRole('sb_secret_def456UVW'), 'secret');
    assert.equal(isPrivilegedRole('secret'), true);
  });

  it('K3: should safely detect legacy service_role and anon JWT payload roles without logging', () => {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64');
    
    const anonPayload = Buffer.from(JSON.stringify({ role: 'anon', iss: 'supabase' })).toString('base64');
    const anonJwt = `${header}.${anonPayload}.signatureMock`;
    assert.equal(inspectKeyRole(anonJwt), 'anon');
    assert.equal(isPrivilegedRole('anon'), false);

    const serviceRolePayload = Buffer.from(JSON.stringify({ role: 'service_role', iss: 'supabase' })).toString('base64');
    const serviceRoleJwt = `${header}.${serviceRolePayload}.signatureMock`;
    assert.equal(inspectKeyRole(serviceRoleJwt), 'service_role');
    assert.equal(isPrivilegedRole('service_role'), true);
  });

  it('K4: should never expose database keys or tokens in /api/health', async () => {
    const res = await request(app).get('/api/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'healthy');

    const bodyString = JSON.stringify(res.body);
    assert.equal(bodyString.includes('YOUR_COPIED'), false);
    assert.equal(bodyString.includes('sb_secret_'), false);
    assert.equal(bodyString.includes('sb_publishable_'), false);
    assert.equal(bodyString.includes('serviceRoleKey'), false);
    assert.equal(bodyString.includes('publishableKey'), false);
    assert.equal(bodyString.includes('secretKey'), false);
    assert.equal(bodyString.includes('shareTokenSecret'), false);
  });
});
