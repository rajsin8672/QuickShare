import crypto from 'crypto';

// Unambiguous alphabet: 32 characters (excludes 0, O, 1, I, l)
// 32^6 = 1,073,741,824 combinations for 6 characters
export const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

/**
 * Generate a cryptographically secure random share code
 * @param {number} length - Default length 6
 * @returns {string} Random uppercase code
 */
export function generateShareCode(length = 6) {
  let result = '';
  const alphabetLength = CODE_ALPHABET.length;
  for (let i = 0; i < length; i++) {
    const randomIndex = crypto.randomInt(0, alphabetLength);
    result += CODE_ALPHABET[randomIndex];
  }
  return result;
}

/**
 * Normalize a user-entered share code (trim, remove hyphens/spaces, uppercase)
 * @param {string} code 
 * @returns {string} Normalized code
 */
export function normalizeShareCode(code) {
  if (typeof code !== 'string') return '';
  return code.trim().replace(/[\s-_]/g, '').toUpperCase();
}

/**
 * Generate a cryptographically secure owner deletion token (32 bytes hex)
 * @returns {string}
 */
export function generateDeletionToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Hash a sensitive token (such as the deletion token) with SHA-256
 * @param {string} token 
 * @returns {string}
 */
export function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

/**
 * Verify a deletion token against its stored SHA-256 hash
 * @param {string} rawToken 
 * @param {string} storedHash 
 * @returns {boolean}
 */
export function verifyToken(rawToken, storedHash) {
  if (!rawToken || !storedHash) return false;
  const computedHash = hashToken(rawToken);
  const bufA = Buffer.from(computedHash, 'hex');
  const bufB = Buffer.from(storedHash, 'hex');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Create a signed, short-lived session token for password-verified receivers
 * @param {string} shareCode 
 * @param {string} secret 
 * @param {number} expiresInSeconds 
 * @returns {string}
 */
export function createShareAccessToken(shareCode, secret, expiresInSeconds = 3600) {
  const expiresAt = Math.floor(Date.now() / 1000) + expiresInSeconds;
  const payload = `${shareCode}:${expiresAt}`;
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  const token = Buffer.from(`${payload}:${signature}`).toString('base64url');
  return token;
}

/**
 * Verify a share access token
 * @param {string} token 
 * @param {string} shareCode 
 * @param {string} secret 
 * @returns {boolean}
 */
export function verifyShareAccessToken(token, shareCode, secret) {
  if (!token || typeof token !== 'string') return false;
  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf8');
    const parts = decoded.split(':');
    if (parts.length !== 3) return false;

    const [tokenCode, expiresAtStr, receivedSig] = parts;
    const expiresAt = parseInt(expiresAtStr, 10);

    if (tokenCode !== shareCode) return false;
    if (Date.now() / 1000 > expiresAt) return false; // Token expired

    const payload = `${tokenCode}:${expiresAtStr}`;
    const expectedSig = crypto.createHmac('sha256', secret).update(payload).digest('hex');

    const bufA = Buffer.from(receivedSig, 'hex');
    const bufB = Buffer.from(expectedSig, 'hex');
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  } catch (err) {
    return false;
  }
}

