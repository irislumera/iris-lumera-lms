PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  employee_id TEXT UNIQUE,
  department TEXT NOT NULL DEFAULT '',
  job_title TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'learner' CHECK (role IN ('admin','learner')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  must_change_password INTEGER NOT NULL DEFAULT 0,
  xp INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  last_login_at TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_users_role_status ON users(role,status);
CREATE INDEX IF NOT EXISTS idx_users_name ON users(last_name,first_name);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  csrf_token TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS courses (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  short_description TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'Professional Skills',
  level TEXT NOT NULL DEFAULT 'Foundation',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  cover_asset_id TEXT,
  xp_reward INTEGER NOT NULL DEFAULT 200,
  certificate_enabled INTEGER NOT NULL DEFAULT 1,
  passing_score INTEGER NOT NULL DEFAULT 70,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (cover_asset_id) REFERENCES assets(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_courses_status ON courses(status);

CREATE TABLE IF NOT EXISTS modules (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL DEFAULT 1,
  xp_reward INTEGER NOT NULL DEFAULT 40,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_modules_course_position ON modules(course_id,position);

CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  course_id TEXT,
  storage_key TEXT NOT NULL UNIQUE,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  size_bytes INTEGER NOT NULL DEFAULT 0,
  kind TEXT NOT NULL DEFAULT 'general',
  created_by TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_assets_course ON assets(course_id,kind);

CREATE TABLE IF NOT EXISTS scorm_packages (
  id TEXT PRIMARY KEY,
  course_id TEXT,
  asset_id TEXT NOT NULL,
  title TEXT NOT NULL,
  version TEXT NOT NULL DEFAULT '1.2',
  launch_path TEXT NOT NULL,
  manifest_xml TEXT NOT NULL DEFAULT '',
  storage_prefix TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT,
  FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE SET NULL,
  FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_scorm_course ON scorm_packages(course_id);

CREATE TABLE IF NOT EXISTS lessons (
  id TEXT PRIMARY KEY,
  module_id TEXT NOT NULL,
  title TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'text' CHECK (type IN ('text','video','audio','pdf','presentation','external','quiz','scorm')),
  body TEXT NOT NULL DEFAULT '',
  asset_id TEXT,
  external_url TEXT,
  quiz_id TEXT,
  scorm_package_id TEXT,
  duration_minutes INTEGER NOT NULL DEFAULT 10,
  position INTEGER NOT NULL DEFAULT 1,
  is_required INTEGER NOT NULL DEFAULT 1,
  xp_reward INTEGER NOT NULL DEFAULT 20,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (module_id) REFERENCES modules(id) ON DELETE CASCADE,
  FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE SET NULL,
  FOREIGN KEY (quiz_id) REFERENCES quizzes(id) ON DELETE SET NULL,
  FOREIGN KEY (scorm_package_id) REFERENCES scorm_packages(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_lessons_module_position ON lessons(module_id,position);

CREATE TABLE IF NOT EXISTS enrollments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  course_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked','completed')),
  enrolled_at TEXT NOT NULL,
  expires_at TEXT,
  completed_at TEXT,
  UNIQUE(user_id,course_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_enrollments_user ON enrollments(user_id,status);
CREATE INDEX IF NOT EXISTS idx_enrollments_course ON enrollments(course_id,status);

CREATE TABLE IF NOT EXISTS lesson_progress (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  lesson_id TEXT NOT NULL,
  completed INTEGER NOT NULL DEFAULT 0,
  score REAL,
  started_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id,lesson_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (lesson_id) REFERENCES lessons(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_progress_user ON lesson_progress(user_id,completed);

CREATE TABLE IF NOT EXISTS quizzes (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  passing_score INTEGER NOT NULL DEFAULT 70,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS quiz_questions (
  id TEXT PRIMARY KEY,
  quiz_id TEXT NOT NULL,
  question_text TEXT NOT NULL,
  question_type TEXT NOT NULL DEFAULT 'single' CHECK (question_type IN ('single','multiple','boolean','short_answer')),
  points INTEGER NOT NULL DEFAULT 1,
  position INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (quiz_id) REFERENCES quizzes(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_quiz_questions ON quiz_questions(quiz_id,position);

CREATE TABLE IF NOT EXISTS quiz_options (
  id TEXT PRIMARY KEY,
  question_id TEXT NOT NULL,
  option_text TEXT NOT NULL,
  is_correct INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY (question_id) REFERENCES quiz_questions(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_quiz_options ON quiz_options(question_id,position);

CREATE TABLE IF NOT EXISTS quiz_attempts (
  id TEXT PRIMARY KEY,
  quiz_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  score REAL NOT NULL,
  passed INTEGER NOT NULL DEFAULT 0,
  answers_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (quiz_id) REFERENCES quizzes(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_user ON quiz_attempts(user_id,created_at);

CREATE TABLE IF NOT EXISTS scorm_registrations (
  id TEXT PRIMARY KEY,
  package_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  lesson_status TEXT NOT NULL DEFAULT 'not attempted',
  score_raw REAL,
  suspend_data TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  total_time_seconds INTEGER NOT NULL DEFAULT 0,
  cmi_json TEXT NOT NULL DEFAULT '{}',
  started_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE(package_id,user_id),
  FOREIGN KEY (package_id) REFERENCES scorm_packages(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_scorm_reg_user ON scorm_registrations(user_id);

CREATE TABLE IF NOT EXISTS certificate_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  background_asset_id TEXT,
  config_json TEXT NOT NULL DEFAULT '{}',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (background_asset_id) REFERENCES assets(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_certificate_templates_active ON certificate_templates(active);

CREATE TABLE IF NOT EXISTS certificates (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  course_id TEXT NOT NULL,
  template_id TEXT,
  certificate_number TEXT NOT NULL UNIQUE,
  snapshot_first_name TEXT NOT NULL,
  snapshot_last_name TEXT NOT NULL,
  snapshot_course_title TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
  FOREIGN KEY (template_id) REFERENCES certificate_templates(id) ON DELETE SET NULL,
  UNIQUE(user_id,course_id)
);
CREATE INDEX IF NOT EXISTS idx_certificates_user ON certificates(user_id,issued_at);

CREATE TABLE IF NOT EXISTS xp_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  reference_id TEXT NOT NULL,
  points INTEGER NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(user_id,event_type,reference_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_xp_events_user ON xp_events(user_id,created_at);

CREATE TABLE IF NOT EXISTS achievements (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  icon TEXT NOT NULL DEFAULT '✦',
  threshold_xp INTEGER,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_achievements (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  achievement_id TEXT NOT NULL,
  awarded_at TEXT NOT NULL,
  UNIQUE(user_id,achievement_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (achievement_id) REFERENCES achievements(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);

INSERT OR IGNORE INTO achievements(id,code,name,description,icon,threshold_xp,created_at) VALUES
('ach_first_step','FIRST_STEP','First Step','Complete your first learning item.','◉',20,datetime('now')),
('ach_250xp','XP_250','Quarter-K','Reach 250 XP.','✦',250,datetime('now')),
('ach_1000xp','XP_1000','Momentum','Reach 1,000 XP.','◆',1000,datetime('now')),
('ach_course','COURSE_COMPLETE','Course Complete','Complete your first course.','✓',NULL,datetime('now'));

INSERT OR IGNORE INTO certificate_templates(id,name,description,config_json,active,created_at,updated_at)
VALUES(
 'tpl_default','Aurora Executive','Default IRIS LUMERA certificate template.',
 '{"orientation":"landscape","accent":"#7158ff","eyebrow":"IRIS LUMERA","title":"Certificate of Completion","subtitle":"This is proudly presented to","body":"for successfully completing","footer":"Learn. Apply. Become.","nameStyle":"xl"}',
 1,datetime('now'),datetime('now')
);
