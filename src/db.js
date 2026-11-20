import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

// Tentukan lokasi file database SQLite dari environment atau default ./data/tracker.db
const dbPath = path.resolve(process.env.DB_PATH || './data/tracker.db');
const dbDir = path.dirname(dbPath);

if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

// Inisialisasi koneksi SQLite dengan mode WAL untuk performa baca/tulis bersamaan
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Buat skema tabel utama jika belum tersedia
db.exec(`
  CREATE TABLE IF NOT EXISTS channels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    youtube_id TEXT NOT NULL UNIQUE,
    handle TEXT,
    title TEXT NOT NULL,
    description TEXT,
    thumbnail_url TEXT,
    uploads_playlist_id TEXT,
    subscriber_target INTEGER NOT NULL DEFAULT 0,
    current_subscribers INTEGER NOT NULL DEFAULT 0,
    current_views INTEGER NOT NULL DEFAULT 0,
    current_videos INTEGER NOT NULL DEFAULT 0,
    total_likes_tracked INTEGER NOT NULL DEFAULT 0,
    last_checked_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS channel_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel_id INTEGER NOT NULL,
    subscribers INTEGER NOT NULL,
    views INTEGER NOT NULL,
    video_count INTEGER NOT NULL,
    likes_total INTEGER NOT NULL DEFAULT 0,
    recorded_at TEXT NOT NULL,
    FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_snapshots_channel_time
    ON channel_snapshots (channel_id, recorded_at);

  CREATE TABLE IF NOT EXISTS videos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel_id INTEGER NOT NULL,
    youtube_video_id TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    thumbnail_url TEXT,
    published_at TEXT NOT NULL,
    views INTEGER NOT NULL DEFAULT 0,
    likes INTEGER NOT NULL DEFAULT 0,
    comments_count INTEGER NOT NULL DEFAULT 0,
    last_updated_at TEXT NOT NULL,
    FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_videos_channel_published
    ON videos (channel_id, published_at DESC);

  CREATE TABLE IF NOT EXISTS video_sentiments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    video_id INTEGER NOT NULL UNIQUE,
    positive_count INTEGER NOT NULL DEFAULT 0,
    neutral_count INTEGER NOT NULL DEFAULT 0,
    negative_count INTEGER NOT NULL DEFAULT 0,
    total_analyzed INTEGER NOT NULL DEFAULT 0,
    sentiment_score REAL NOT NULL DEFAULT 0,
    sample_comments_json TEXT NOT NULL DEFAULT '[]',
    weekly_trend_json TEXT NOT NULL DEFAULT '[]',
    analyzed_at TEXT NOT NULL,
    FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel_id INTEGER,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    link_url TEXT,
    is_read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_notifications_unread
    ON notifications (is_read, created_at DESC);

  CREATE TABLE IF NOT EXISTS app_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    level TEXT NOT NULL,
    source TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Normalisasi data lama yang mungkin memiliki nilai NULL agar aman dibaca frontend & backend
  UPDATE channels
  SET current_subscribers = COALESCE(current_subscribers, 0),
      current_views = COALESCE(current_views, 0),
      current_videos = COALESCE(current_videos, 0),
      total_likes_tracked = COALESCE(total_likes_tracked, 0),
      subscriber_target = COALESCE(subscriber_target, 0)
  WHERE current_subscribers IS NULL
     OR current_views IS NULL
     OR current_videos IS NULL
     OR total_likes_tracked IS NULL
     OR subscriber_target IS NULL;

  UPDATE videos
  SET views = COALESCE(views, 0),
      likes = COALESCE(likes, 0),
      comments_count = COALESCE(comments_count, 0)
  WHERE views IS NULL OR likes IS NULL OR comments_count IS NULL;
`);

// Migrasi aman untuk database lama agar kolom weekly_trend_json tersedia
const sentimentCols = db.prepare('PRAGMA table_info(video_sentiments)').all();
if (!sentimentCols.some((col) => col.name === 'weekly_trend_json')) {
  db.exec("ALTER TABLE video_sentiments ADD COLUMN weekly_trend_json TEXT NOT NULL DEFAULT '[]';");
}

// Migrasi aman agar kolom category_id dan category_name tersedia pada tabel videos
const videoCols = db.prepare('PRAGMA table_info(videos)').all();
if (!videoCols.some((col) => col.name === 'category_id')) {
  db.exec('ALTER TABLE videos ADD COLUMN category_id TEXT;');
}
if (!videoCols.some((col) => col.name === 'category_name')) {
  db.exec('ALTER TABLE videos ADD COLUMN category_name TEXT;');
}

/**
 * Catat log aktivitas atau error bot ke database dan konsol.
 */
export function writeLog(level, source, message) {
  const cleanMsg = String(message || '').slice(0, 1000);
  try {
    db.prepare(
      'INSERT INTO app_logs (level, source, message, created_at) VALUES (?, ?, ?, ?)'
    ).run(level, source, cleanMsg, new Date().toISOString());

    // Jaga agar log tidak menumpuk terlalu besar (simpan 500 entri terbaru)
    db.prepare(`
      DELETE FROM app_logs
      WHERE id NOT IN (
        SELECT id FROM app_logs ORDER BY id DESC LIMIT 500
      )
    `).run();
  } catch (err) {
    console.error('[DB Log Error]', err);
  }

  const prefix = `[${new Date().toISOString()}] [${level.toUpperCase()}] [${source}]`;
  if (level === 'error') {
    console.error(`${prefix} ${cleanMsg}`);
  } else if (level === 'warn') {
    console.warn(`${prefix} ${cleanMsg}`);
  } else {
    console.log(`${prefix} ${cleanMsg}`);
  }
}

export default db;
