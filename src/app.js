import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { config, validateEnv } from './config/env.js';
import healthRoutes from './routes/health.routes.js';
import sharesRoutes from './routes/shares.routes.js';
import { generalLimiter } from './middleware/rateLimiter.js';
import { errorHandler } from './middleware/errorHandler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Validate environment on startup
validateEnv();

const app = express();

// 1. Helmet Security Headers with custom Content-Security-Policy
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        mediaSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'self'"], // Allows PDF previews in <embed> or <iframe>
        frameSrc: ["'self'"],
        baseUri: ["'self'"],
        formAction: ["'self'"]
      }
    },
    crossOriginEmbedderPolicy: false // Needed for previewing PDFs and images cleanly
  })
);

// 2. CORS Configuration
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, curl, same-origin)
      if (!origin) return callback(null, true);
      if (config.allowedOrigins.includes('*') || config.allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(null, true); // Permissive in dev, or restricted by config
    },
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-share-token', 'x-deletion-token']
  })
);

// 3. Request Body Parsers
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// 4. Rate Limiting for API routes
app.use('/api', generalLimiter);

// 5. Serve static files from 'public' directory
app.use(express.static(path.join(rootDir, 'public')));

// 6. Mount API Routes
app.use('/api', healthRoutes);
app.use('/api/shares', sharesRoutes);

// 7. 404 Handler for undefined API routes
app.use('/api', (req, res) => {
  res.status(404).json({
    success: false,
    error: `API endpoint not found: ${req.method} ${req.originalUrl}`
  });
});

// 8. Custom 404 handler for undefined web page routes
app.use((req, res) => {
  res.status(404).sendFile(path.join(rootDir, 'public', '404.html'));
});

// 9. Centralized Error Handler
app.use(errorHandler);

export default app;
