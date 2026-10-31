import path from 'path';

// Allowed MIME types and their corresponding valid extensions
export const ALLOWED_FILE_TYPES = {
  'application/pdf': ['.pdf'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/webp': ['.webp'],
  'text/plain': ['.txt'],
  'application/msword': ['.doc'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx']
};

export const ALLOWED_EXTENSIONS = new Set([
  '.pdf', '.jpg', '.jpeg', '.png', '.webp', '.txt', '.doc', '.docx'
]);

// Allowed expiration periods in minutes
export const ALLOWED_EXPIRATION_MINUTES = [30, 60, 360, 1440, 10080]; // 30m, 1h, 6h, 24h, 7d

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
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateFileType(filename, mimeType) {
  const ext = path.extname(filename || '').toLowerCase();

  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return {
      valid: false,
      error: `File type "${ext}" is not supported. Supported: PDF, JPG, PNG, WEBP, TXT, DOC, DOCX.`
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
