-- IRIS LUMERA LMS: due dates for learner course assignments
ALTER TABLE enrollments ADD COLUMN due_at TEXT;
CREATE INDEX IF NOT EXISTS idx_enrollments_due ON enrollments(due_at);
