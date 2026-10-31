import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeFilename,
  validateFileType,
  validateExpiryMinutes,
  validateDownloadLimit,
  calculateExpiresAt
} from '../../src/utils/validation.js';

describe('Validation and Sanitization Utilities', () => {
  it('should sanitize dangerous filenames and strip directory traversal', () => {
    assert.equal(sanitizeFilename('../../etc/passwd.pdf'), 'passwd.pdf');
    assert.equal(sanitizeFilename('..\\..\\windows\\system32.jpg'), 'system32.jpg');
    assert.equal(sanitizeFilename('normal-file.png'), 'normal-file.png');
    assert.equal(sanitizeFilename('.hidden.txt'), 'hidden.txt');
    assert.ok(sanitizeFilename('').startsWith('file_'));
  });

  it('should validate allowed file extensions and MIME types', () => {
    // Valid types
    assert.ok(validateFileType('report.pdf', 'application/pdf').valid);
    assert.ok(validateFileType('photo.jpg', 'image/jpeg').valid);
    assert.ok(validateFileType('graphic.png', 'image/png').valid);
    assert.ok(validateFileType('picture.webp', 'image/webp').valid);
    assert.ok(validateFileType('notes.txt', 'text/plain').valid);
    assert.ok(validateFileType('contract.doc', 'application/msword').valid);
    assert.ok(validateFileType('document.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document').valid);

    // Invalid extension
    const invalidExt = validateFileType('malware.exe', 'application/x-msdownload');
    assert.equal(invalidExt.valid, false);

    // Mismatched MIME and extension
    const mismatch = validateFileType('spoofed.jpg', 'application/pdf');
    assert.equal(mismatch.valid, false);
  });

  it('should validate and constrain expiration minutes', () => {
    assert.equal(validateExpiryMinutes(30), 30);
    assert.equal(validateExpiryMinutes(60), 60);
    assert.equal(validateExpiryMinutes(360), 360);
    assert.equal(validateExpiryMinutes(1440), 1440);
    assert.equal(validateExpiryMinutes(10080), 10080);

    // Unlisted expiration values default to 30
    assert.equal(validateExpiryMinutes(999999), 30);
    assert.equal(validateExpiryMinutes(-10), 30);
    assert.equal(validateExpiryMinutes('invalid'), 30);
  });

  it('should validate optional download limits', () => {
    assert.equal(validateDownloadLimit(1), 1);
    assert.equal(validateDownloadLimit(5), 5);
    assert.equal(validateDownloadLimit('10'), 10);
    assert.equal(validateDownloadLimit(null), null);
    assert.equal(validateDownloadLimit(''), null);
    assert.equal(validateDownloadLimit(undefined), null);
    assert.equal(validateDownloadLimit(0), null);
    assert.equal(validateDownloadLimit(-5), null);
    assert.equal(validateDownloadLimit(99999), null); // Exceeds max 1000
  });

  it('should calculate valid future expiration timestamps', () => {
    const expiresAt = calculateExpiresAt(30);
    const now = Date.now();
    const diffMins = (expiresAt.getTime() - now) / (60 * 1000);
    assert.ok(diffMins >= 29 && diffMins <= 31);
  });
});

