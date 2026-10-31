-- QuickShare Storage Bucket Setup Instructions
-- Target: Supabase Storage

-- 1. Create or update the private bucket 'shared-files' to support Text, Images, Videos, PDFs, and Documents:
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'shared-files',
    'shared-files',
    false, -- STRICTLY PRIVATE: no direct anonymous public reads
    52428800, -- 50MB single file limit in bytes (configurable)
    ARRAY[
        'application/pdf',
        'image/jpeg',
        'image/png',
        'image/webp',
        'image/gif',
        'video/mp4',
        'video/webm',
        'video/quicktime',
        'text/plain',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ]
)
ON CONFLICT (id) DO UPDATE SET
    public = false,
    file_size_limit = 52428800,
    allowed_mime_types = ARRAY[
        'application/pdf',
        'image/jpeg',
        'image/png',
        'image/webp',
        'image/gif',
        'video/mp4',
        'video/webm',
        'video/quicktime',
        'text/plain',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ];

-- 2. Storage RLS Security
-- Only backend service_role key should have read/write/delete permissions.
-- Public anonymous users must not list or download files directly from the bucket.
DROP POLICY IF EXISTS "Deny anonymous access on shared-files" ON storage.objects;
CREATE POLICY "Deny anonymous access on shared-files" ON storage.objects
    FOR ALL
    TO anon
    USING (bucket_id = 'shared-files' AND false);
