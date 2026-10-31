-- ==============================================================================
-- QuickShare Migration 003: Safe Incremental Schema Evolution
-- Fixes missing 'deletion_token_hash', 'password_hash', 'status', and multi-file columns.
-- Idempotent, non-destructive: Safe to run on existing databases with active data.
-- ==============================================================================

-- 1. Safely add missing columns to existing public.shares table
ALTER TABLE public.shares
ADD COLUMN IF NOT EXISTS deletion_token_hash VARCHAR(128);

ALTER TABLE public.shares
ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255);

ALTER TABLE public.shares
ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'expired', 'deleted'));

ALTER TABLE public.shares
ADD COLUMN IF NOT EXISTS file_count INTEGER DEFAULT 0;

ALTER TABLE public.shares
ADD COLUMN IF NOT EXISTS total_size_bytes BIGINT DEFAULT 0;

ALTER TABLE public.shares
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- 2. Relax NOT NULL on legacy content_type and provide default if column exists
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'shares' 
        AND column_name = 'content_type'
    ) THEN
        ALTER TABLE public.shares ALTER COLUMN content_type DROP NOT NULL;
        ALTER TABLE public.shares ALTER COLUMN content_type SET DEFAULT 'text';
    END IF;
END $$;

-- 3. Backfill status for existing rows where status is NULL
UPDATE public.shares
SET status = CASE 
    WHEN expires_at <= NOW() THEN 'expired' 
    ELSE 'active' 
END
WHERE status IS NULL;

-- 4. Create public.share_files table for multi-file support if not exists
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

-- Ensure file_category exists if share_files was created earlier
ALTER TABLE public.share_files 
ADD COLUMN IF NOT EXISTS file_category VARCHAR(20) DEFAULT 'document';

-- 5. Backfill share_files from existing single-file shares (if any legacy rows exist)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'shares' 
        AND column_name = 'file_path'
    ) THEN
        INSERT INTO public.share_files (share_id, storage_path, original_filename, mime_type, file_size, file_category, created_at)
        SELECT
            id,
            file_path,
            COALESCE(original_filename, 'file'),
            COALESCE(mime_type, 'application/octet-stream'),
            COALESCE(file_size, 0),
            CASE
                WHEN mime_type LIKE 'image/%' THEN 'image'
                WHEN mime_type LIKE 'video/%' THEN 'video'
                WHEN mime_type = 'application/pdf' THEN 'pdf'
                WHEN mime_type = 'text/plain' THEN 'text'
                ELSE 'document'
            END,
            created_at
        FROM public.shares
        WHERE file_path IS NOT NULL
        AND id NOT IN (SELECT share_id FROM public.share_files);

        -- Update file_count and total_size_bytes on legacy rows
        UPDATE public.shares
        SET file_count = 1, 
            total_size_bytes = COALESCE(file_size, 0)
        WHERE file_path IS NOT NULL AND (file_count IS NULL OR file_count = 0);
    END IF;
END $$;

-- 6. Create public.download_events table if not exists
CREATE TABLE IF NOT EXISTS public.download_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    share_id UUID NOT NULL REFERENCES public.shares(id) ON DELETE CASCADE,
    file_id UUID REFERENCES public.share_files(id) ON DELETE SET NULL,
    download_type VARCHAR(30) NOT NULL DEFAULT 'single_file',
    ip_hash VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. Performance and Lifecycle Indexes
CREATE INDEX IF NOT EXISTS idx_shares_share_code ON public.shares(share_code);
CREATE INDEX IF NOT EXISTS idx_shares_status_expires_at ON public.shares(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_shares_created_at ON public.shares(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_share_files_share_id ON public.share_files(share_id);
CREATE INDEX IF NOT EXISTS idx_share_files_category ON public.share_files(file_category);
CREATE INDEX IF NOT EXISTS idx_download_events_share_id ON public.download_events(share_id);

-- 8. Row Level Security Policies (Strict backend-only access)
ALTER TABLE public.shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.share_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.download_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Deny public access on shares" ON public.shares;
CREATE POLICY "Deny public access on shares" ON public.shares
    FOR ALL TO anon, authenticated USING (false);

DROP POLICY IF EXISTS "Deny public access on share_files" ON public.share_files;
CREATE POLICY "Deny public access on share_files" ON public.share_files
    FOR ALL TO anon, authenticated USING (false);

DROP POLICY IF EXISTS "Deny public access on download_events" ON public.download_events;
CREATE POLICY "Deny public access on download_events" ON public.download_events
    FOR ALL TO anon, authenticated USING (false);

-- 9. Atomic Download Count Function
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

    IF (v_status IS NOT NULL AND v_status <> 'active') OR v_expires <= NOW() THEN
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

-- 10. Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';

