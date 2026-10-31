-- QuickShare Migration 002: Add file_category column to share_files table
ALTER TABLE share_files 
ADD COLUMN IF NOT EXISTS file_category VARCHAR(20) DEFAULT 'document';

-- Update existing records based on mime_type
UPDATE share_files
SET file_category = CASE
    WHEN mime_type LIKE 'image/%' THEN 'image'
    WHEN mime_type LIKE 'video/%' THEN 'video'
    WHEN mime_type = 'application/pdf' THEN 'pdf'
    WHEN mime_type = 'text/plain' THEN 'text'
    ELSE 'document'
END
WHERE file_category IS NULL OR file_category = 'document';

-- Index for file_category queries
CREATE INDEX IF NOT EXISTS idx_share_files_category ON share_files(file_category);

