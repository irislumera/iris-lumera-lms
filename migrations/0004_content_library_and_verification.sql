-- IRIS LUMERA LMS: content library metadata + email verification
ALTER TABLE assets ADD COLUMN title TEXT NOT NULL DEFAULT '';
ALTER TABLE assets ADD COLUMN description TEXT NOT NULL DEFAULT '';
ALTER TABLE assets ADD COLUMN status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived'));
ALTER TABLE assets ADD COLUMN duration_minutes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE assets ADD COLUMN published_at TEXT;

ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN verification_code_hash TEXT;
ALTER TABLE users ADD COLUMN verification_expires_at TEXT;
ALTER TABLE users ADD COLUMN verification_attempts INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_assets_status ON assets(status);
CREATE INDEX IF NOT EXISTS idx_assets_kind_status ON assets(kind,status);
