import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeFilename,
  validateFileType,
  validateExpiryMinutes,
  validateDownloadLimit,
  calculateExpiresAt,
  getFileCategory,
  verifyFileSignature
} from '../../src/utils/validation.js';

describe('Validation and Sanitization Utilities', () => {
  it('should sanitize dangerous filenames and strip directory traversal', () => {
    assert.equal(sanitizeFilename('../../etc/passwd.pdf'), 'passwd.pdf');
    assert.equal(sanitizeFilename('..\\..\\windows\\system32.jpg'), 'system32.jpg');
    assert.equal(sanitizeFilename('normal-file.png'), 'normal-file.png');
    assert.equal(sanitizeFilename('.hidden.txt'), 'hidden.txt');
    assert.ok(sanitizeFilename('').startsWith('file_'));

    // Safe handling of spaces, parentheses, unicode, and control characters
    assert.equal(sanitizeFilename('My Vacation Photo (1).png'), 'My Vacation Photo (1).png');
    assert.equal(sanitizeFilename('café_résumé.pdf'), 'café_résumé.pdf');
    assert.equal(sanitizeFilename('日本語_テスト.png'), '日本語_テスト.png');
    assert.equal(sanitizeFilename('dangerous\x00file\x1f\u202E.png'), 'dangerousfile.png');
    assert.equal(sanitizeFilename('file"name*test?.pdf'), 'file_name_test_.pdf');
  });

  it('should validate allowed file extensions and MIME types including GIF and videos', () => {
    // Valid documents and images
    assert.ok(validateFileType('report.pdf', 'application/pdf').valid);
    assert.ok(validateFileType('photo.jpg', 'image/jpeg').valid);
    assert.ok(validateFileType('graphic.png', 'image/png').valid);
    assert.ok(validateFileType('picture.webp', 'image/webp').valid);
    assert.ok(validateFileType('animation.gif', 'image/gif').valid);
    assert.ok(validateFileType('notes.txt', 'text/plain').valid);
    assert.ok(validateFileType('contract.doc', 'application/msword').valid);
    assert.ok(validateFileType('document.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document').valid);

    // Valid videos
    assert.ok(validateFileType('clip.mp4', 'video/mp4').valid);
    assert.ok(validateFileType('stream.webm', 'video/webm').valid);
    assert.ok(validateFileType('recording.mov', 'video/quicktime').valid);

    // Invalid extension
    const invalidExt = validateFileType('malware.exe', 'application/x-msdownload');
    assert.equal(invalidExt.valid, false);

    // Mismatched MIME and extension
    const mismatch = validateFileType('spoofed.jpg', 'application/pdf');
    assert.equal(mismatch.valid, false);
  });

  it('should accurately categorize file types', () => {
    assert.equal(getFileCategory('photo.jpg', 'image/jpeg'), 'image');
    assert.equal(getFileCategory('anim.gif', 'image/gif'), 'image');
    assert.equal(getFileCategory('video.mp4', 'video/mp4'), 'video');
    assert.equal(getFileCategory('clip.webm', 'video/webm'), 'video');
    assert.equal(getFileCategory('doc.pdf', 'application/pdf'), 'pdf');
    assert.equal(getFileCategory('readme.txt', 'text/plain'), 'text');
    assert.equal(getFileCategory('contract.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'), 'document');
  });

  it('should verify file magic byte signatures', () => {
    const pngHeader = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    const jpegHeader = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]);
    const gifHeader = Buffer.from('GIF89a');
    const pdfHeader = Buffer.from('%PDF-1.7');

    assert.ok(verifyFileSignature(pngHeader, 'image/png'));
    assert.ok(verifyFileSignature(jpegHeader, 'image/jpeg'));
    assert.ok(verifyFileSignature(gifHeader, 'image/gif'));
    assert.ok(verifyFileSignature(pdfHeader, 'application/pdf'));

    // Spoofed: JPEG claimed as PNG
    assert.equal(verifyFileSignature(jpegHeader, 'image/png'), false);
    assert.equal(verifyFileSignature(pngHeader, 'application/pdf'), false);
  });

  it('should validate and constrain expiration minutes', () => {
    assert.equal(validateExpiryMinutes(60), 60);
    assert.equal(validateExpiryMinutes(360), 360);
    assert.equal(validateExpiryMinutes(1440), 1440);
    assert.equal(validateExpiryMinutes(4320), 4320);
    assert.equal(validateExpiryMinutes(10080), 10080);

    // Unlisted or missing expiration values default to 1440 (24 hours)
    assert.equal(validateExpiryMinutes(999999), 1440);
    assert.equal(validateExpiryMinutes(-10), 1440);
    assert.equal(validateExpiryMinutes('invalid'), 1440);
    assert.equal(validateExpiryMinutes(undefined), 1440);
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

