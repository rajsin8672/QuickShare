import path from 'path';

// Allowed MIME types and their corresponding valid extensions
export const ALLOWED_FILE_TYPES = {
  // Documents & Text
  'application/pdf': ['.pdf'],
  'text/plain': ['.txt'],
  'application/msword': ['.doc'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],

  // Images / Photos
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/webp': ['.webp'],
  'image/gif': ['.gif'],

  // Videos
  'video/mp4': ['.mp4'],
  'video/webm': ['.webm'],
  'video/quicktime': ['.mov']
};

export const ALLOWED_EXTENSIONS = new Set([
  '.pdf', '.txt', '.doc', '.docx',
  '.jpg', '.jpeg', '.png', '.webp', '.gif',
  '.mp4', '.webm', '.mov'
]);

// Allowed expiration periods in minutes
export const ALLOWED_EXPIRATION_MINUTES = [30, 60, 360, 1440, 10080]; // 30m, 1h, 6h, 24h, 7d

/**
 * Determine file category from extension and MIME type
 * @param {string} filename 
 * @param {string} mimeType 
 * @returns {'image' | 'video' | 'pdf' | 'document' | 'text'}
 */
export function getFileCategory(filename, mimeType = '') {
  const ext = path.extname(filename || '').toLowerCase();
  const lowerMime = (mimeType || '').toLowerCase();

  if (['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext) || lowerMime.startsWith('image/')) {
    return 'image';
  }
  if (['.mp4', '.webm', '.mov'].includes(ext) || lowerMime.startsWith('video/')) {
    return 'video';
  }
  if (ext === '.pdf' || lowerMime === 'application/pdf') {
    return 'pdf';
  }
  if (ext === '.txt' || lowerMime === 'text/plain') {
    return 'text';
  }
  return 'document';
}

/**
 * Inspect file magic bytes signature to prevent extension spoofing (e.g. exe renamed to jpg)
 * @param {Buffer} buffer 
 * @param {string} mimeType 
 * @returns {boolean}
 */
export function verifyFileSignature(buffer, mimeType) {
  if (!buffer || buffer.length < 4) return true; // If buffer not provided or too small, skip

  // PNG: 89 50 4E 47
  if (mimeType === 'image/png') {
    return buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47;
  }

  // JPEG: FF D8 FF
  if (mimeType === 'image/jpeg') {
    return buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF;
  }

  // GIF: GIF87a or GIF89a (47 49 46 38)
  if (mimeType === 'image/gif') {
    return buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38;
  }

  // WEBP: RIFF....WEBP (52 49 46 46 .... 57 45 42 50)
  if (mimeType === 'image/webp') {
    if (buffer.length < 12) return false;
    const isRiff = buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46;
    const isWebp = buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50;
    return isRiff && isWebp;
  }

  // PDF: %PDF (25 50 44 46)
  if (mimeType === 'application/pdf') {
    return buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46;
  }

  // MP4 / MOV: usually has 'ftyp' or 'moov' at offset 4
  if (mimeType === 'video/mp4' || mimeType === 'video/quicktime') {
    if (buffer.length < 12) return true;
    const boxType = buffer.toString('ascii', 4, 8);
    return ['ftyp', 'moov', 'mdat', 'wide', 'skip'].includes(boxType) || buffer.indexOf('ftyp') >= 0;
  }

  // WEBM: 1A 45 DF A3 (EBML header)
  if (mimeType === 'video/webm') {
    return buffer[0] === 0x1A && buffer[1] === 0x45 && buffer[2] === 0xDF && buffer[3] === 0xA3;
  }

  return true;
}

/**
 * Sanitize filename to prevent directory traversal and special character injection
 * @param {string} originalName 
 * @returns {string} Safe filename
 */
export function sanitizeFilename(originalName) {
  if (!originalName || typeof originalName !== 'string') {
    return 'file_' + Date.now();
  }

  // Normalize backslashes to forward slashes for cross-platform compatibility
  const normalized = originalName.replace(/\\/g, '/');
  // Extract base filename without directories
  const basename = path.posix.basename(normalized);

  // Replace null bytes, control characters, and slashes
  let cleanName = basename
    .replace(/[\/\\]/g, '')
    .replace(/[\x00-\x1f\x7f-\x9f]/g, '')
    .trim();

  // Remove leading dots to prevent hidden files
  cleanName = cleanName.replace(/^\.+/, '');

  if (!cleanName) {
    cleanName = 'file_' + Date.now();
  }

  // Preserve extension and clamp length to 200 characters
  const ext = path.extname(cleanName).toLowerCase();
  const nameWithoutExt = path.basename(cleanName, ext);
  const truncatedBase = nameWithoutExt.substring(0, 180);

  return `${truncatedBase}${ext}`;
}

/**
 * Validate file extension and MIME type against allowed list
 * @param {string} filename 
 * @param {string} mimeType 
 * @param {Buffer} [buffer] - Optional buffer for magic bytes inspection
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateFileType(filename, mimeType, buffer = null) {
  const ext = path.extname(filename || '').toLowerCase();

  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return {
      valid: false,
      error: `File type "${ext}" is not supported. Supported: Photos (JPG, PNG, WEBP, GIF), Videos (MP4, WEBM, MOV), PDFs, and Documents (TXT, DOC, DOCX).`
    };
  }

  const validExtensionsForMime = ALLOWED_FILE_TYPES[mimeType];
  // Allow text/plain fallback for txt
  if (!validExtensionsForMime && mimeType !== 'text/plain') {
    return {
      valid: false,
      error: `Unsupported MIME type: ${mimeType}`
    };
  }

  if (validExtensionsForMime && !validExtensionsForMime.includes(ext)) {
    return {
      valid: false,
      error: `MIME type "${mimeType}" does not match file extension "${ext}".`
    };
  }

  // Verify file signature if buffer provided
  if (buffer && !verifyFileSignature(buffer, mimeType)) {
    return {
      valid: false,
      error: `File signature mismatch: File content does not match the claimed MIME type "${mimeType}".`
    };
  }

  return { valid: true };
}

/**
 * Validate expiration minutes
 * @param {number|string} minutes 
 * @returns {number} Validated minutes
 */
export function validateExpiryMinutes(minutes) {
  const parsed = parseInt(minutes, 10);
  if (ALLOWED_EXPIRATION_MINUTES.includes(parsed)) {
    return parsed;
  }
  return 30; // Default to 30 minutes
}

/**
 * Validate optional download limit
 * @param {any} limit 
 * @returns {number|null} Validated limit or null
 */
export function validateDownloadLimit(limit) {
  if (limit === undefined || limit === null || limit === '') {
    return null;
  }
  const parsed = parseInt(limit, 10);
  if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 1000) {
    return parsed;
  }
  return null;
}

/**
 * Calculate expiration timestamp given duration in minutes
 * @param {number} minutes 
 * @returns {Date}
 */
export function calculateExpiresAt(minutes) {
  const validMinutes = validateExpiryMinutes(minutes);
  return new Date(Date.now() + validMinutes * 60 * 1000);
}
