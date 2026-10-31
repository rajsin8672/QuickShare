import multer from 'multer';
import { config } from '../config/env.js';
import { validateFileType } from '../utils/validation.js';

// Configure in-memory storage buffer for clean streaming to Supabase Storage
const storage = multer.memoryStorage();

// File filter checking extensions and MIME types
const fileFilter = (req, file, cb) => {
  const check = validateFileType(file.originalname, file.mimetype);
  if (!check.valid) {
    const error = new Error(check.error);
    error.statusCode = 400;
    return cb(error, false);
  }
  cb(null, true);
};

export const upload = multer({
  storage,
  limits: {
    fileSize: config.maxFileSize,
    files: config.maxFileCount,
    fieldSize: 10 * 1024 * 1024 // 10MB max text content in form fields
  },
  fileFilter
});

/**
 * Middleware to check total size across all uploaded files
 */
export function validateTotalUploadSize(req, res, next) {
  if (req.files && Array.isArray(req.files)) {
    const totalBytes = req.files.reduce((acc, f) => acc + (f.size || 0), 0);
    if (totalBytes > config.maxTotalSize) {
      return res.status(400).json({
        success: false,
        error: `Total upload size exceeds the maximum limit of ${Math.round(config.maxTotalSize / 1024 / 1024)}MB.`
      });
    }
  }
  next();
}

