-- ==============================================================================
-- QuickShare Complete Database & Storage Setup for Supabase
-- Idempotent & Non-destructive: Safe to run on a new or existing database.
-- ==============================================================================

-- 1. Enable Required PostgreSQL Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. Table: shares
CREATE TABLE IF NOT EXISTS public.shares (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    share_code VARCHAR(16) NOT NULL UNIQUE,
    deletion_token_hash VARCHAR(128) NOT NULL,
    text_content TEXT,
    password_hash VARCHAR(255),
    expires_at TIMESTAMPTZ NOT NULL,
    download_limit INTEGER,
    download_count INTEGER NOT NULL DEFAULT 0,
    file_count INTEGER NOT NULL DEFAULT 0,
    total_size_bytes BIGINT NOT NULL DEFAULT 0,
    status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'deleted')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

-- 3. Table: share_files
CREATE TABLE IF NOT EXISTS public.share_files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    share_id UUID NOT NULL REFERENCES public.shares(id) ON DELETE CASCADE,
    storage_path TEXT NOT NULL,
    original_filename TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    file_size BIGINT NOT NULL,
    file_category VARCHAR(20) DEFAULT 'document',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Ensure file_category column exists if migrating from older schema version
ALTER TABLE public.share_files 
ADD COLUMN IF NOT EXISTS file_category VARCHAR(20) DEFAULT 'document';

-- 4. Table: download_events
CREATE TABLE IF NOT EXISTS public.download_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    share_id UUID NOT NULL REFERENCES public.shares(id) ON DELETE CASCADE,
    file_id UUID REFERENCES public.share_files(id) ON DELETE SET NULL,
    download_type VARCHAR(30) NOT NULL DEFAULT 'single_file',
    ip_hash VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Table: abuse_reports
CREATE TABLE IF NOT EXISTS public.abuse_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    share_code VARCHAR(16) NOT NULL,
    reason TEXT NOT NULL,
    reporter_ip_hash VARCHAR(64),
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. Indexes for Performance and Ephemeral Cleanup
CREATE INDEX IF NOT EXISTS idx_shares_share_code ON public.shares(share_code);
CREATE INDEX IF NOT EXISTS idx_shares_status_expires_at ON public.shares(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_shares_created_at ON public.shares(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_share_files_share_id ON public.share_files(share_id);
CREATE INDEX IF NOT EXISTS idx_share_files_category ON public.share_files(file_category);
CREATE INDEX IF NOT EXISTS idx_download_events_share_id ON public.download_events(share_id);

-- 7. Row Level Security (RLS) Enforcement
-- Strict deny policies prevent public anonymous clients from querying or tampering with shares
ALTER TABLE public.shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.share_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.download_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.abuse_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Deny public access on shares" ON public.shares;
CREATE POLICY "Deny public access on shares" ON public.shares
    FOR ALL
    TO anon, authenticated
    USING (false);

DROP POLICY IF EXISTS "Deny public access on share_files" ON public.share_files;
CREATE POLICY "Deny public access on share_files" ON public.share_files
    FOR ALL
    TO anon, authenticated
    USING (false);

DROP POLICY IF EXISTS "Deny public access on download_events" ON public.download_events;
CREATE POLICY "Deny public access on download_events" ON public.download_events
    FOR ALL
    TO anon, authenticated
    USING (false);

DROP POLICY IF EXISTS "Deny public access on abuse_reports" ON public.abuse_reports;
CREATE POLICY "Deny public access on abuse_reports" ON public.abuse_reports
    FOR ALL
    TO anon, authenticated
    USING (false);

-- 8. Atomic Download Counter Function
CREATE OR REPLACE FUNCTION public.increment_download_count(p_share_id UUID)
RETURNS TABLE (
    success BOOLEAN,
    new_count INT,
    configured_limit INT
) AS $$
DECLARE
    v_limit INT;
    v_count INT;
    v_status VARCHAR(20);
    v_expires TIMESTAMPTZ;
BEGIN
    SELECT download_limit, download_count, status, expires_at
    INTO v_limit, v_count, v_status, v_expires
    FROM public.shares
    WHERE id = p_share_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN QUERY SELECT FALSE, 0, 0;
        RETURN;
    END IF;

    IF v_status <> 'active' OR v_expires <= NOW() THEN
        RETURN QUERY SELECT FALSE, v_count, v_limit;
        RETURN;
    END IF;

    IF v_limit IS NOT NULL AND v_count >= v_limit THEN
        RETURN QUERY SELECT FALSE, v_count, v_limit;
        RETURN;
    END IF;

    UPDATE public.shares
    SET download_count = download_count + 1
    WHERE id = p_share_id;

    RETURN QUERY SELECT TRUE, v_count + 1, v_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 9. Private Storage Bucket Setup: 'shared-files'
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'shared-files',
    'shared-files',
    false, -- Strictly private
    52428800, -- 50MB single file limit
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

-- 10. Storage RLS: Deny public/anon access on storage.objects
DROP POLICY IF EXISTS "Deny anonymous access on shared-files" ON storage.objects;
CREATE POLICY "Deny anonymous access on shared-files" ON storage.objects
    FOR ALL
    TO anon
    USING (bucket_id = 'shared-files' AND false);

