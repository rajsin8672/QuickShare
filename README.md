# QuickShare 🚀
### Production-Grade Code-Based Ephemeral File Sharing Platform

QuickShare is a secure, modern, full-stack web application designed for fast, hassle-free file and text sharing. Senders upload files or enter confidential text notes, receive a cryptographically generated, unambiguous 6-character sharing code, and share that code with the recipient. Content is stored in private cloud storage and PostgreSQL, guarded by expiration timers, optional passwords, download counters, and owner deletion tokens.

---

## 🌟 Key Features

- **No Accounts Required**: Zero signup, zero registration, and zero third-party tracking pixels or cookies.
- **Unambiguous 6-Character Codes**: Generated using an alphabet (`23456789ABCDEFGHJKLMNPQRSTUVWXYZ`) that removes confusing characters (such as `0` vs `O` and `1` vs `I`/`l`).
- **Flexible Content Sharing**:
  - Multiple file uploads (up to 10 files per share).
  - Supported formats: PDF, JPG, JPEG, PNG, WEBP, TXT, DOC, DOCX.
  - Text-only sharing (up to 100,000 characters) without requiring file uploads.
  - Hybrid sharing: combine text notes and files in a single transfer.
- **Configurable Automatic Expiration**: Choose between 30 minutes (default), 1 hour, 6 hours, 24 hours, or 7 days. Once expired, files and records are automatically purged from storage.
- **Password Protection**: Senders can enforce a password hashed with bcrypt/salt; receivers must unlock before metadata, text, or files can be accessed.
- **Download Limits & Atomic Accounting**: Senders can enforce a maximum download count (e.g., 1 download for single-use burn-after-reading transfers). Concurrency-safe atomic increments prevent race conditions.
- **Safe Previews**: Browser-safe in-browser previews for PDFs, images, and plain text with strict Content-Security-Policy headers.
- **ZIP Archive Downloads**: Senders and receivers can download all shared files in one click as a single streaming ZIP archive.
- **Owner Deletion Capability**: Senders receive a secret cryptographic deletion token upon upload to immediately destroy their share at any time before expiration.
- **Brute-Force & Flooding Defense**: Multi-tier Express rate limiting to prevent code guessing, password brute-forcing, and storage flooding.
- **Dual Storage Engine**: Full production support for Supabase PostgreSQL & private Supabase Storage, plus an automatic zero-configuration local fallback engine for offline development and testing.

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
quickshare/
├── public/                     # Static frontend assets
│   ├── index.html              # Home landing page with hero, features, FAQ
│   ├── upload.html             # Upload & share page (drag & drop, text, expiry)
│   ├── receive.html            # Receiver page (code entry, password unlock, previews)
│   ├── share.html              # Share redirect helper
│   ├── about.html              # Technical architecture & security explanation
│   ├── privacy.html            # Zero-retention privacy policy
│   ├── terms.html              # Terms of service
│   ├── 404.html                # Custom 404 error page
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
│   └── app.js                  # Express application setup, Helmet CSP, CORS
├── database/
│   ├── migrations/
│   │   └── 001_initial_schema.sql  # Complete PostgreSQL DDL, tables, RLS & functions
│   └── setup_storage.sql       # Supabase Storage bucket setup & policies
├── tests/                      # Automated test suite
│   ├── unit/
│   │   ├── generateCode.test.js    # Code generator & token hashing tests
│   │   └── validation.test.js      # Filename sanitization & MIME validation tests
│   └── integration/
│       ├── shares.test.js          # Upload, receive, password, and download tests
│       ├── cleanup.test.js         # Expiration enforcement & cleanup service tests
│       ├── security.test.js        # Cross-share boundaries & 404 security tests
│       └── concurrency_and_limits.test.js # Atomic download race & limit tests
├── .env.example                # Environment variables documentation
├── .gitignore                  # Git ignore rules
├── package.json                # Dependencies and npm scripts
├── render.yaml                 # Render Infrastructure-as-Code deployment blueprint
├── server.js                   # Application server entry point & shutdown handler
└── README.md                   # Complete documentation
```

---

## ⚡ Quick Start (Local Setup)

### Prerequisites
- Node.js v18.0.0 or higher (`node -v`)
- npm v9.0.0 or higher (`npm -v`)
- Git

### 1. Clone the repository
```bash
git clone <your-repo-url>
cd quickshare
```

### 2. Install dependencies
```bash
npm install
```

### 3. Environment configuration
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

> **Note on Local Storage Mode**: QuickShare includes an automatic local storage and memory database adapter. If you do not configure `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, the application will seamlessly run in local offline mode storing files under `uploads/shared-files/`. You can start using and testing the application immediately!

### 4. Start the server
For development with automatic reload:
```bash
npm run dev
```

For production mode:
```bash
npm start
```

The application will be live at: **`http://localhost:3000`**

---

## ☁️ Supabase Cloud Configuration

To connect QuickShare to Supabase PostgreSQL and Supabase Storage in production:

### 1. Create a Supabase Project
1. Log in to your [Supabase Dashboard](https://supabase.com).
2. Create a new project.
3. Note your **Project URL** and **`service_role` Secret API Key** (found under Project Settings -> API).
   > ⚠️ **IMPORTANT**: Always use the `service_role` secret key on the backend server. Never expose this key in frontend code.

### 2. Apply Database Migrations
1. In the Supabase Dashboard, open the **SQL Editor**.
2. Copy and paste the contents of [`database/migrations/001_initial_schema.sql`](file:///Users/karankumar/Desktop/QuickShare/database/migrations/001_initial_schema.sql).
3. Click **Run**. This creates:
   - `shares` table with indexed `share_code` and status checks.
   - `share_files` table with foreign key cascade deletions.
   - `download_events` table for anonymized audit tracking.
   - `increment_download_count` stored procedure for concurrency-safe atomic download limits.
   - Row Level Security (RLS) policies denying all anonymous public direct access.

### 3. Set Up the Storage Bucket
1. Go to **Storage** -> **Create a new bucket**.
2. Name the bucket: **`shared-files`**.
3. Toggle **Public bucket** to **OFF** (Keep it strictly private).
4. Set the file size limit to `26214400` bytes (25MB).
5. Alternatively, run the SQL script [`database/setup_storage.sql`](file:///Users/karankumar/Desktop/QuickShare/database/setup_storage.sql) in the SQL Editor.

### 4. Update `.env` with Supabase Credentials
```env
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-secret-key
SUPABASE_BUCKET_NAME=shared-files
```

Restart your server. You will see:
```
⚡ [DB] Initialized with live Supabase PostgreSQL backend.
⚡ [Storage] Initialized with Supabase Storage bucket "shared-files".
```

---

## 🧪 Running Automated Tests

QuickShare includes a comprehensive automated test suite testing unit logic, end-to-end API integration, security boundaries, race conditions, and cleanup services.

Run the test suite with:
```bash
npm test
```

### Test Coverage Highlights:
- **Share Creation**: Text-only, single-file, multi-file, combined text/file, empty-share rejection, oversized file rejection, and file extension checks.
- **Receiving & Security**: Valid code lookups, 404 on invalid codes, password-protected lock state, incorrect password rejection (401), and successful unlock token issuing.
- **Download Limits & Race Conditions**: Atomic download counting tested with simultaneous concurrent requests (e.g. 6 parallel requests against a limit of 2).
- **Multi-File Streaming**: Verification of on-the-fly streaming ZIP archives (`application/zip`).
- **Owner Deletion**: Validation of owner deletion tokens (403 on invalid tokens, 200 on valid tokens, and 410 Gone on subsequent accesses).
- **Scheduled Cleanup**: Testing that expired shares are purged while active shares remain untouched.

---

## 📡 REST API Documentation

All API responses return standardized JSON payloads:
```json
{
  "success": true,
  "data": { ... }
}
```
Or upon error:
```json
{
  "success": false,
  "error": "Error description"
}
```

### 1. Create a Share
- **`POST /api/shares`**
- **Content-Type**: `multipart/form-data`
- **Fields**:
  - `files`: File array (max 10 files, 25MB each, 50MB total)
  - `textContent`: Optional plain text message (max 100,000 characters)
  - `expiryMinutes`: `30`, `60`, `360`, `1440`, or `10080` (default: `30`)
  - `password`: Optional password string
  - `downloadLimit`: Optional integer (1 to 1000)
- **Response `201 Created`**:
```json
{
  "success": true,
  "message": "Share created successfully.",
  "data": {
    "shareCode": "7K2M9X",
    "expiresAt": "2026-10-31T14:30:00.000Z",
    "fileCount": 2,
    "totalSizeBytes": 140294,
    "downloadLimit": 5,
    "deletionToken": "a8f3b2c...64_char_hex_token"
  }
}
```
> *Note: `deletionToken` is only returned once to the uploader in this response.*

### 2. Lookup Share (Receive)
- **`POST /api/shares/receive`**
- **Body**: `{ "code": "7K2M9X", "token": "optional_access_token" }`
- **Response (Unlocked) `200 OK`**:
```json
{
  "success": true,
  "data": {
    "requiresPassword": false,
    "shareCode": "7K2M9X",
    "textContent": "Sample note",
    "fileCount": 1,
    "totalSizeBytes": 45120,
    "expiresAt": "2026-10-31T14:30:00.000Z",
    "downloadLimit": 5,
    "downloadCount": 1,
    "files": [
      {
        "id": "uuid",
        "originalFilename": "presentation.pdf",
        "mimeType": "application/pdf",
        "fileSize": 45120,
        "canPreview": true
      }
    ]
  }
}
```
- **Response (Password-Protected) `200 OK`**:
```json
{
  "success": true,
  "data": {
    "requiresPassword": true,
    "shareCode": "7K2M9X",
    "fileCount": 1,
    "hasText": true,
    "expiresAt": "2026-10-31T14:30:00.000Z"
  }
}
```

### 3. Verify Password
- **`POST /api/shares/:code/verify-password`**
- **Body**: `{ "password": "user_password" }`
- **Response `200 OK`**:
```json
{
  "success": true,
  "message": "Password verified successfully.",
  "data": {
    "token": "signed_hmac_session_token",
    "share": { ...unlocked_share_data... }
  }
}
```

### 4. Download Single File
- **`GET /api/shares/:code/files/:fileId/download`**
- **Headers/Query**: `Authorization: Bearer <token>` or `?token=<token>`
- **Response**: Binary stream with `Content-Disposition: attachment; filename="original_name.ext"`. Atomically increments the download counter.

### 5. Preview File
- **`GET /api/shares/:code/files/:fileId/preview`**
- **Supported**: PDF, JPG, PNG, WEBP, TXT.
- **Response**: Stream with `Content-Disposition: inline` and sandboxed Content-Security-Policy headers. Does not increment the download count.

### 6. Download All Files as ZIP
- **`GET /api/shares/:code/download-all`**
- **Response**: `application/zip` stream containing all files. Increments download counter.

### 7. Delete Share (Owner)
- **`DELETE /api/shares/:code`**
- **Headers**: `x-deletion-token: <secret_deletion_token>`
- **Response `200 OK`**:
```json
{
  "success": true,
  "message": "Share and associated files have been permanently deleted."
}
```

### 8. System Health
- **`GET /api/health`**
- **Response `200 OK`**:
```json
{
  "status": "healthy",
  "timestamp": "2026-10-31T13:30:00.000Z",
  "uptime": 124,
  "environment": "production",
  "storageBackend": "supabase"
}
```

---

## 🚀 Deployment on Render

QuickShare is ready for deployment on [Render](https://render.com).

### Option A: Deploy via Blueprint (`render.yaml`)
1. Push your repository to GitHub.
2. In Render, click **New** -> **Blueprint**.
3. Select your repository. Render will automatically detect [`render.yaml`](file:///Users/karankumar/Desktop/QuickShare/render.yaml).
4. Fill in the required environment variables:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
5. Click **Apply**. Render will build and deploy the web service with automatic health checks at `/api/health`.

### Option B: Manual Web Service Setup on Render
1. In Render, select **New Web Service**.
2. Connect your GitHub repository.
3. Configure the following service settings:
   - **Environment**: `Node`
   - **Build Command**: `npm ci`
   - **Start Command**: `node server.js`
   - **Health Check Path**: `/api/health`
4. Add the following **Environment Variables**:
   | Variable | Value / Description |
   |---|---|
   | `NODE_ENV` | `production` |
   | `SUPABASE_URL` | Your Supabase project URL (`https://xyz.supabase.co`) |
   | `SUPABASE_SERVICE_ROLE_KEY` | Your Supabase `service_role` secret key |
   | `SUPABASE_BUCKET_NAME` | `shared-files` |
   | `SHARE_TOKEN_SECRET` | Generate a random 32+ character string |
   | `MAX_FILE_SIZE_BYTES` | `26214400` (25MB) |
   | `MAX_TOTAL_SIZE_BYTES` | `52428800` (50MB) |
   | `MAX_FILE_COUNT` | `10` |
   | `CLEANUP_INTERVAL_MINUTES` | `15` |
   | `ALLOWED_ORIGINS` | `*` or your custom domain |
5. Click **Create Web Service**.

---

## 🛡️ Security Architecture & Limitations

1. **Private Storage & RLS**: Files in `shared-files` are never publicly browsable. Supabase Row Level Security blocks direct anonymous client access. Only the backend Node.js service communicates with storage using backend credentials.
2. **Owner Isolation**: Senders receive a secret 32-byte hexadecimal deletion token upon creation. Senders can destroy the share, but anyone who merely knows the 6-character code cannot delete it.
3. **No innerHTML Injection**: Uploaded text is rendered strictly using `textContent` and preformatted text blocks to prevent Cross-Site Scripting (XSS).
4. **Brute-Force Rate Limiting**: The code verification endpoint throttles guessing attempts to mitigate automated code scanning.
5. **Download Accounting Limitations**: Download limits are enforced by backend access authorization. Note that network interruptions after a download stream begins cannot un-count the download.
6. **Maximum Limits**: Uploads are capped at 25MB per file, 50MB per share, and 10 files per share.

---

## 🤝 Contributing & License

QuickShare is distributed under the MIT License. See [Terms of Service](/terms.html) and [Privacy Policy](/privacy.html) for usage policies.

