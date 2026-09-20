-- IRIS LUMERA LMS: estimated course duration
ALTER TABLE courses ADD COLUMN estimated_minutes INTEGER NOT NULL DEFAULT 30;
