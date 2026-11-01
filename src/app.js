import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
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

// 4. Rate Limiting and Search Engine Directives for API routes
app.use('/api', (req, res, next) => {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  next();
});
app.use('/api', generalLimiter);

// 5. SEO Routes: robots.txt and sitemap.xml with production domain support
app.get('/robots.txt', (req, res) => {
  const baseUrl = config.siteUrl || `${req.protocol}://${req.get('host')}`;
  res.type('text/plain');
  res.send(`# F Share robots.txt
User-agent: *
Allow: /
Allow: /upload.html
Allow: /receive.html
Allow: /about.html
Allow: /privacy.html
Allow: /terms.html

# Disallow API and backend endpoints
Disallow: /api/
Disallow: /health

# Disallow dynamic share redirector and parameterized recipient URLs
Disallow: /share.html
Disallow: /receive.html?*
Disallow: /*?*code=
Disallow: /*?*token=

# Disallow local fallback storage folders
Disallow: /uploads/
Disallow: /local-storage/

# Sitemap location
Sitemap: ${baseUrl}/sitemap.xml
`);
});

app.get('/sitemap.xml', (req, res) => {
  const baseUrl = config.siteUrl || `${req.protocol}://${req.get('host')}`;
  res.type('application/xml');
  res.send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${baseUrl}/</loc>
    <lastmod>2026-11-01</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>${baseUrl}/upload.html</loc>
    <lastmod>2026-11-01</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.9</priority>
  </url>
  <url>
    <loc>${baseUrl}/receive.html</loc>
    <lastmod>2026-11-01</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.9</priority>
  </url>
  <url>
    <loc>${baseUrl}/about.html</loc>
    <lastmod>2026-11-01</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>
  <url>
    <loc>${baseUrl}/privacy.html</loc>
    <lastmod>2026-11-01</lastmod>
    <changefreq>yearly</changefreq>
    <priority>0.5</priority>
  </url>
  <url>
    <loc>${baseUrl}/terms.html</loc>
    <lastmod>2026-11-01</lastmod>
    <changefreq>yearly</changefreq>
    <priority>0.5</priority>
  </url>
</urlset>`);
});

// 6. Serve public HTML pages with production canonical URLs injected
const publicHtmlRoutes = {
  '/': 'index.html',
  '/index.html': 'index.html',
  '/upload.html': 'upload.html',
  '/receive.html': 'receive.html',
  '/about.html': 'about.html',
  '/privacy.html': 'privacy.html',
  '/terms.html': 'terms.html'
};

app.use((req, res, next) => {
  const pageFile = publicHtmlRoutes[req.path];
  if (pageFile && req.method === 'GET') {
    const filePath = path.join(rootDir, 'public', pageFile);
    fs.readFile(filePath, 'utf8', (err, html) => {
      if (err) return next(err);
      const baseUrl = config.siteUrl || `${req.protocol}://${req.get('host')}`;
      const rendered = html.replaceAll('{{CANONICAL_URL}}', baseUrl);
      res.type('html').send(rendered);
    });
  } else {
    next();
  }
});

// 7. Serve static files from 'public' directory
app.use(express.static(path.join(rootDir, 'public')));

// 8. Mount API Routes
app.use('/api', healthRoutes);
app.use('/api/shares', sharesRoutes);

// 9. 404 Handler for undefined API routes
app.use('/api', (req, res) => {
  res.status(404).json({
    success: false,
    error: `API endpoint not found: ${req.method} ${req.originalUrl}`
  });
});

// 10. Custom 404 handler for undefined web page routes
app.use((req, res) => {
  const filePath = path.join(rootDir, 'public', '404.html');
  fs.readFile(filePath, 'utf8', (err, html) => {
    if (err) {
      return res.status(404).send('404 - Page Not Found');
    }
    const baseUrl = config.siteUrl || `${req.protocol}://${req.get('host')}`;
    const rendered = html.replaceAll('{{CANONICAL_URL}}', baseUrl);
    res.status(404).type('html').send(rendered);
  });
});

// 9. Centralized Error Handler
app.use(errorHandler);

export default app;
