CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  text TEXT NOT NULL,
  mood TEXT,
  contact TEXT,
  context TEXT,
  user_id INTEGER,
  github_issue INTEGER,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES user(id)
);
