# F Share 🚀
### Fast, Simple & Secure File Sharing

> **Share Files Online in Seconds**  
> Upload files, generate a share code, and let others retrieve them easily. Simple file sharing with configurable expiration and secure downloads.

F Share is a modern, lightweight, full-stack web application designed for fast, hassle-free file and text sharing. Senders upload files or enter confidential text notes, receive a cryptographically generated, unambiguous 6-character sharing code, and share that code with the recipient. Content is stored in private cloud storage and PostgreSQL, guarded by expiration timers, optional passwords, download counters, and owner deletion tokens.

---

## 🌟 Key Features

- **No Accounts Required**: Zero signup, zero registration, and zero third-party tracking pixels or cookies.
- **Unambiguous 6-Character Codes**: Generated using an alphabet (`23456789ABCDEFGHJKLMNPQRSTUVWXYZ`) that removes confusing characters (such as `0` vs `O` and `1` vs `I`/`l`).
- **Rich Content & Media Support**:
  - **Photos & Images**: JPG, JPEG, PNG, WEBP, and GIF with client-side image thumbnail previews before uploading, gallery viewing, and original-quality downloads.
  - **Videos**: MP4, WEBM, and MOV with dimension/duration detection, in-browser HTML5 video player with seeking (HTTP 206 Partial Content Range streaming), and graceful fallback to direct download if a browser lacks codec decoding support.
  - **Documents**: PDF, TXT, Word DOC, and Word DOCX with PDF and plaintext in-browser previews.
  - **Text Sharing**: Plaintext and long messages (up to 10,000 characters) with a real-time character counter.
  - **Multi-File & Mixed Shares**: Combine photos, videos, PDFs, documents, and notes into a single share (up to 10 files, 50MB per file, 100MB total).
- **Configurable Automatic Expiration**: Choose between 30 minutes (default), 1 hour, 6 hours, 24 hours, or 7 days. Once expired, files and records are automatically purged from storage.
- **Password Protection**: Senders can enforce an optional password hashed with bcrypt/salt; receivers must unlock before metadata, text, or files can be accessed.
- **Download Limits & Atomic Accounting**: Senders can enforce a maximum download count (e.g., 1 download for single-use burn-after-reading transfers). Concurrency-safe atomic increments prevent race conditions.
- **Safe Previews**: Browser-safe in-browser previews for PDFs, images, videos, and plain text with strict Content-Security-Policy headers.
- **ZIP Archive Downloads**: Senders and receivers can download all shared files in one click as a single streaming ZIP archive (`FShare_{code}.zip`).
- **Owner Deletion Capability**: Senders receive a secret cryptographic deletion token upon upload to immediately destroy their share at any time before expiration.
- **Brute-Force & Flooding Defense**: Multi-tier Express rate limiting to prevent code guessing, password brute-forcing, and storage flooding.
- **Dual Storage Engine**: Full production support for Supabase PostgreSQL & private Supabase Storage, plus an automatic zero-configuration local fallback engine for offline development and testing.

---

## 🔒 Security & Privacy Architecture

F Share is transparent about its security model:

1. **Private Cloud Storage**: All shared files reside in a dedicated private Supabase Storage bucket (`shared-files`) with Row Level Security (RLS) active. Storage bucket contents cannot be crawled, enumerated, or accessed publicly.
2. **Access Gated by Backend APIs**: Downloads require authentication against active share codes and short-lived HMAC access tokens.
3. **Password Security**: Passwords are never saved in plaintext; they are hashed with bcrypt (salt rounds = 10).
4. **Data Minimization & Ephemeral Lifespan**: Files and database records are permanently deleted by a background worker when their expiration window closes or download limit is exhausted.
5. **No False Claims**: F Share uses strong server-side encryption at rest in private storage. We do not claim client-side end-to-end encryption or zero-knowledge storage.
6. **Zero Tracking**: No Google Analytics, no advertising cookies, no marketing scripts.

---

## 🛠️ Technology Stack

| Layer | Technologies |
|---|---|
| **Frontend** | Vanilla HTML5, Modern CSS3 (Variables, Responsive Grid/Flexbox), Vanilla JavaScript (ES Modules, Fetch API, XHR Upload Progress). No frontend frameworks. |
| **Backend** | Node.js (v18+), Express.js (ES Modules), Helmet, Express Rate Limit, Multer, Bcryptjs, Archiver, QRCode. |
| **Database** | Supabase PostgreSQL with Row Level Security (RLS) and atomic download counters. |
| **Storage** | Supabase Storage (strictly private bucket `shared-files`) with short-lived signed URLs/streams. |
| **Deployment** | Render Web Service (`render.yaml`), Node.js environment. |
| **Testing** | Node.js native test runner (`node:test`) + `supertest`. |

---

## 📁 Project Structure

```
F-Share/
├── public/                     # Static frontend assets
│   ├── index.html              # Home landing page with hero, features, use cases, FAQ
│   ├── upload.html             # Upload & share page (drag & drop, text, expiry)
│   ├── receive.html            # Receiver page (code entry, password unlock, previews)
│   ├── share.html              # Share redirect helper
│   ├── about.html              # Technical architecture & security explanation
│   ├── privacy.html            # Zero-retention privacy policy
│   ├── terms.html              # Terms of service
│   ├── 404.html                # Custom 404 error page
│   ├── robots.txt              # Search engine crawler directives
│   ├── sitemap.xml             # XML sitemap for public indexable pages
│   ├── favicon.svg             # Modern vector F Share icon
│   ├── favicon.ico             # 32x32 standard browser favicon
│   ├── apple-touch-icon.png    # 180x180 iOS touch icon
│   ├── og-image.png            # 1200x630 Open Graph preview card
│   ├── site.webmanifest        # Progressive web app manifest
│   ├── css/
│   │   └── style.css           # Complete responsive design system & CSS variables
│   └── js/
│       ├── common.js           # Shared utilities (toasts, clipboard, date formatting)
│       ├── upload.js           # Drag & drop, progress tracking, success modal
│       └── receive.js          # Code entry, password auth, preview modal, downloads
├── src/                        # Backend application source code
│   ├── config/
│   │   └── env.js              # Environment variable validation & parsing
│   ├── middleware/
│   │   ├── errorHandler.js     # Centralized error handler & Multer errors
│   │   ├── rateLimiter.js      # General, code guessing, and upload rate limiters
│   │   └── uploadValidation.js # File format, MIME check, and total payload limits
│   ├── routes/
│   │   ├── health.routes.js    # Health check endpoint (/api/health)
│   │   └── shares.routes.js    # Core REST endpoints (upload, receive, preview, etc.)
│   ├── services/
│   │   ├── db.service.js       # PostgreSQL client & local fallback memory adapter
│   │   ├── storage.service.js  # Supabase Storage & local disk storage service
│   │   ├── share.service.js    # Business logic (creation, auth, expiry, deletion)
│   │   └── cleanup.service.js  # Automated scheduled background file purger
│   ├── utils/
│   │   ├── generateCode.js     # Cryptographic random codes, deletion tokens, HMACs
│   │   └── validation.js       # Filename sanitization, MIME verification, expiry logic
│   └── app.js                  # Express setup, Helmet CSP, CORS, SEO routes
├── database/
│   ├── migrations/
│   │   ├── 001_initial_schema.sql  # Complete PostgreSQL DDL, tables, RLS & functions
│   │   ├── 002_add_file_category.sql
│   │   └── 003_add_missing_shares_columns.sql
│   └── setup_storage.sql       # Supabase Storage bucket setup & policies
├── scripts/
│   ├── test-supabase.js        # Supabase diagnostic audit script
│   └── generate-assets.js      # Favicon and Open Graph asset generator
├── tests/                      # Automated test suite (64 tests across 12 suites)
│   ├── unit/
│   │   ├── generateCode.test.js    # Code generator & token hashing tests
│   │   └── validation.test.js      # Filename sanitization & MIME validation tests
│   └── integration/
│       ├── shares.test.js          # Upload, receive, password, and download tests
│       ├── cleanup.test.js         # Expiration enforcement & cleanup service tests
│       ├── security.test.js        # Cross-share boundaries & 404 security tests
│       ├── concurrency_and_limits.test.js # Atomic download race & limit tests
│       ├── media_and_documents.test.js    # Video streaming & media tests
│       ├── signed-urls.test.js     # Signed URL integration tests
│       ├── storage-key-encoding.test.js   # Storage path & rollback tests
│       └── seo_and_rebrand.test.js # Complete SEO and branding tests
├── .env.example                # Environment variables documentation
├── .gitignore                  # Git ignore rules
├── package.json                # Dependencies and npm scripts
├── render.yaml                 # Render Infrastructure-as-Code deployment blueprint
├── server.js                   # Application server entry point & shutdown handler
└── README.md                   # Complete documentation
```

---

## 🔍 Google Search Console (GSC) Setup Guide

To verify and index F Share with Google Search Console:

### 1. Add Property
1. Visit [Google Search Console](https://search.google.com/search-console).
2. Choose **URL prefix** and enter your production URL (e.g., `https://fshare.example.com` or `https://fshare.onrender.com`).

### 2. Verify Ownership
Choose one of the recommended verification methods:
- **HTML Meta Tag**:
  Copy the `<meta name="google-site-verification" content="...">` tag provided by Google and paste it into the `<head>` of `public/index.html`.
- **HTML File Upload**:
  Download Google's verification file (e.g., `google1234567890.html`) and place it directly into the `public/` directory.
- **DNS TXT Record**:
  Add the TXT record to your domain's DNS provider (recommended if using a custom domain).

### 3. Submit Sitemap
1. In Google Search Console, navigate to **Sitemaps** in the left sidebar.
2. Enter `sitemap.xml` and click **Submit**.
3. Google will crawl the 6 public, indexable pages:
   - `/`
   - `/upload.html`
   - `/receive.html`
   - `/about.html`
   - `/privacy.html`
   - `/terms.html`

### 4. Privacy Safeguards
F Share protects all shared content from search engine indexing:
- `robots.txt` disallows `/api/`, `/share.html`, and all parameterized URLs (`/*?*code=`).
- The `/api/*` endpoints return the `X-Robots-Tag: noindex, nofollow, noarchive` HTTP header.
- The `receive.html` page dynamically applies `<meta name="robots" content="noindex, nofollow">` if any share code is present in the URL query string.
- Sitemaps strictly list public static landing pages and never include user uploads or download URLs.

---

## 🚀 Quick Start (Local Development)

### 1. Clone & Install Dependencies
```bash
git clone https://github.com/rajsin8672/QuickShare.git
cd QuickShare
npm install
```

### 2. Configure Environment
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

If testing in production mode, specify your production canonical URL:
```env
SITE_URL=https://your-production-domain.com
```

### 3. Run Automated Tests
```bash
npm test
```

### 4. Run Supabase Diagnostic Tool
```bash
node scripts/test-supabase.js
```

### 5. Start Development Server
```bash
npm run dev
# Server will start on http://localhost:3000
```

---

## 📄 License & Attribution

Distributed under the MIT License. See [Terms of Service](/terms.html) and [Privacy Policy](/privacy.html) for usage policies.
