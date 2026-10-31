import rateLimit from 'express-rate-limit';
import { config } from '../config/env.js';

// General API Rate Limiter
export const generalLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.maxRequests,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many requests from this IP. Please try again later.'
  },
  skip: (req) => process.env.NODE_ENV === 'test'
});

// Code Guessing & Password Attempt Rate Limiter (Brute-Force Protection)
export const codeGuessLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: config.rateLimit.codeGuessMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many code entry or password attempts. For security, please wait 15 minutes before trying again.'
  },
  skip: (req) => process.env.NODE_ENV === 'test'
});

// Upload Rate Limiter (Denial of Service / Storage Flooding Protection)
export const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: config.rateLimit.uploadMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'You have reached the upload limit for this hour. Please try again later.'
  },
  skip: (req) => process.env.NODE_ENV === 'test'
});
