import multer from 'multer';

/**
 * Centralized application error handling middleware
 */
export function errorHandler(err, req, res, next) {
  // Check if headers already sent
  if (res.headersSent) {
    return next(err);
  }

  // Handle Multer-specific errors
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        error: 'One or more files exceed the maximum permitted file size limit (25MB).'
      });
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({
        success: false,
        error: 'Too many files uploaded. Maximum allowed is 10 files.'
      });
    }
    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({
        success: false,
        error: `Unexpected field in upload: ${err.field}`
      });
    }
    return res.status(400).json({
      success: false,
      error: `Upload processing error: ${err.message}`
    });
  }

  // Determine status code
  const statusCode = err.statusCode || (res.statusCode >= 400 ? res.statusCode : 500);

  // Safe error message for client
  const isServerFault = statusCode >= 500;
  const clientMessage = isServerFault && process.env.NODE_ENV === 'production'
    ? 'An unexpected server error occurred. Please try again later.'
    : err.message || 'An error occurred processing your request.';

  if (isServerFault) {
    console.error('💥 [Server Error]:', err);
  }

  res.status(statusCode).json({
    success: false,
    error: clientMessage
  });
}

