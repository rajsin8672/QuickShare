-- QuickShare Database Schema Migration 001
-- Targets: Supabase PostgreSQL

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. Table: shares
CREATE TABLE IF NOT EXISTS shares (
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

-- 2. Table: share_files
CREATE TABLE IF NOT EXISTS share_files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    share_id UUID NOT NULL REFERENCES shares(id) ON DELETE CASCADE,
    storage_path TEXT NOT NULL,
    original_filename TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    file_size BIGINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Table: download_events
CREATE TABLE IF NOT EXISTS download_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    share_id UUID NOT NULL REFERENCES shares(id) ON DELETE CASCADE,
    file_id UUID REFERENCES share_files(id) ON DELETE SET NULL,
    download_type VARCHAR(20) NOT NULL DEFAULT 'single_file',
    ip_hash VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Table: abuse_reports (Optional supporting table)
CREATE TABLE IF NOT EXISTS abuse_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    share_code VARCHAR(16) NOT NULL,
    reason TEXT NOT NULL,
    reporter_ip_hash VARCHAR(64),
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for performant lookups and cleanup
CREATE INDEX IF NOT EXISTS idx_shares_share_code ON shares(share_code);
CREATE INDEX IF NOT EXISTS idx_shares_status_expires_at ON shares(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_shares_created_at ON shares(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_share_files_share_id ON share_files(share_id);
CREATE INDEX IF NOT EXISTS idx_download_events_share_id ON download_events(share_id);

-- Row Level Security (RLS) configuration
-- Enforce backend-only access through service role key
ALTER TABLE shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE share_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE download_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE abuse_reports ENABLE ROW LEVEL SECURITY;

-- Deny all direct anonymous or public authenticated role access
-- The Express backend interacts with PostgreSQL via the service_role secret key which bypasses RLS
DROP POLICY IF EXISTS "Deny public access on shares" ON shares;
CREATE POLICY "Deny public access on shares" ON shares
    FOR ALL
    TO anon, authenticated
    USING (false);

DROP POLICY IF EXISTS "Deny public access on share_files" ON share_files;
CREATE POLICY "Deny public access on share_files" ON share_files
    FOR ALL
    TO anon, authenticated
    USING (false);

DROP POLICY IF EXISTS "Deny public access on download_events" ON download_events;
CREATE POLICY "Deny public access on download_events" ON download_events
    FOR ALL
    TO anon, authenticated
    USING (false);

DROP POLICY IF EXISTS "Deny public access on abuse_reports" ON abuse_reports;
CREATE POLICY "Deny public access on abuse_reports" ON abuse_reports
    FOR ALL
    TO anon, authenticated
    USING (false);

-- Atomic download limit enforcement function
CREATE OR REPLACE FUNCTION increment_download_count(p_share_id UUID)
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
    -- Lock row for concurrency safety
    SELECT download_limit, download_count, status, expires_at
    INTO v_limit, v_count, v_status, v_expires
    FROM shares
    WHERE id = p_share_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN QUERY SELECT FALSE, 0, 0;
        RETURN;
    END IF;

    -- Verify active and not expired
    IF v_status <> 'active' OR v_expires <= NOW() THEN
        RETURN QUERY SELECT FALSE, v_count, v_limit;
        RETURN;
    END IF;

    -- Check if limit already reached
    IF v_limit IS NOT NULL AND v_count >= v_limit THEN
        RETURN QUERY SELECT FALSE, v_count, v_limit;
        RETURN;
    END IF;

    -- Increment count
    UPDATE shares
    SET download_count = download_count + 1
    WHERE id = p_share_id;

    RETURN QUERY SELECT TRUE, v_count + 1, v_limit;
END;
$$ LANGUAGE plpgsql;

