import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateShareCode,
  normalizeShareCode,
  generateDeletionToken,
  hashToken,
  verifyToken,
  createShareAccessToken,
  verifyShareAccessToken,
  CODE_ALPHABET
} from '../../src/utils/generateCode.js';

describe('Code Generation and Cryptography Utilities', () => {
  it('should generate a 6-character uppercase code by default', () => {
    const code = generateShareCode();
    assert.equal(typeof code, 'string');
    assert.equal(code.length, 6);
  });

  it('should only use characters from unambiguous alphabet (no 0, O, 1, I, l)', () => {
    for (let i = 0; i < 50; i++) {
      const code = generateShareCode();
      for (const char of code) {
        assert.ok(CODE_ALPHABET.includes(char), `Character "${char}" not in unambiguous alphabet`);
        assert.ok(!['0', 'O', '1', 'I', 'l'].includes(char), `Confusing character "${char}" found`);
      }
    }
  });

  it('should normalize user input correctly', () => {
    assert.equal(normalizeShareCode('  abc-123  '), 'ABC123');
    assert.equal(normalizeShareCode('x y z_9'), 'XYZ9');
    assert.equal(normalizeShareCode(''), '');
    assert.equal(normalizeShareCode(null), '');
  });

  it('should generate unique owner deletion tokens and verify token hashes', () => {
    const token1 = generateDeletionToken();
    const token2 = generateDeletionToken();
    assert.notEqual(token1, token2);
    assert.equal(token1.length, 64); // 32 bytes hex

    const hash1 = hashToken(token1);
    assert.ok(verifyToken(token1, hash1));
    assert.ok(!verifyToken(token2, hash1));
    assert.ok(!verifyToken('invalid-token', hash1));
  });

  it('should generate and verify short-lived HMAC share access tokens', () => {
    const secret = 'test-secret-key-at-least-32-characters-long!';
    const shareCode = 'ABC234';

    const token = createShareAccessToken(shareCode, secret, 60);
    assert.ok(verifyShareAccessToken(token, shareCode, secret));

    // Wrong code
    assert.ok(!verifyShareAccessToken(token, 'WRONG9', secret));
    // Wrong secret
    assert.ok(!verifyShareAccessToken(token, shareCode, 'different-secret-key-32-chars-long!'));
    // Expired token (expiresInSeconds = -10)
    const expiredToken = createShareAccessToken(shareCode, secret, -10);
    assert.ok(!verifyShareAccessToken(expiredToken, shareCode, secret));
  });
});
