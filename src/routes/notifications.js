import { Router } from 'express';
import db from '../db.js';

const router = Router();

/**
 * GET /api/notifications
 * Ambil daftar notifikasi terbaru beserta jumlah yang belum dibaca.
 */
router.get('/', (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 40, 1), 100);
  const notifications = db
    .prepare(
      `SELECT n.*, c.title AS channel_title, c.thumbnail_url AS channel_thumbnail
       FROM notifications n
       LEFT JOIN channels c ON c.id = n.channel_id
       ORDER BY n.created_at DESC, n.id DESC
       LIMIT ?`
    )
    .all(limit);

  const unreadRow = db
    .prepare('SELECT COUNT(*) AS count FROM notifications WHERE is_read = 0')
    .get();

  res.json({
    unreadCount: Number(unreadRow?.count || 0),
    notifications,
  });
});

/**
 * PATCH /api/notifications/:id/read
 * Tandai satu notifikasi atau seluruh notifikasi ("all") sebagai sudah dibaca.
 */
router.patch('/:id/read', (req, res) => {
  const rawId = req.params.id;
  if (rawId === 'all') {
    db.prepare('UPDATE notifications SET is_read = 1 WHERE is_read = 0').run();
    return res.json({ message: 'Semua notifikasi ditandai sudah dibaca.' });
  }

  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'ID notifikasi tidak valid.' });
  }

  const result = db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ?').run(id);
  if (result.changes === 0) {
    return res.status(404).json({ error: 'Notifikasi tidak ditemukan.' });
  }

  res.json({ message: 'Notifikasi ditandai sudah dibaca.' });
});

export default router;
