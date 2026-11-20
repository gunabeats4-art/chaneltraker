import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';

import './db.js';
import channelsRouter from './routes/channels.js';
import videosRouter from './routes/videos.js';
import notificationsRouter from './routes/notifications.js';
import systemRouter from './routes/system.js';
import { startScheduler } from './jobs/checker.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.resolve(__dirname, '../public');

const app = express();
const PORT = Number(process.env.PORT || 3000);

// Middleware parsing JSON
app.use(express.json({ limit: '1mb' }));

// Daftarkan rute REST API
app.use('/api/channels', channelsRouter);
app.use('/api/videos', videosRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api', systemRouter);

// Sajikan pustaka jsPDF lokal untuk pembuatan laporan PDF di browser
app.get('/vendor/jspdf.umd.min.js', (_req, res) => {
  res.sendFile(path.resolve(__dirname, '../node_modules/jspdf/dist/jspdf.umd.min.js'));
});

// Sajikan file frontend statis dari folder public/
app.use(express.static(publicDir));

// Fallback SPA ke public/index.html untuk rute non-API
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Endpoint API tidak ditemukan.' });
  }
  res.sendFile(path.join(publicDir, 'index.html'), (err) => {
    if (err) next(err);
  });
});

// Middleware penanganan error global
app.use((err, _req, res, _next) => {
  console.error('[Server Error]', err);
  res.status(err.status || 500).json({
    error: err.message || 'Terjadi kesalahan internal pada server.',
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`YouTube Channel Tracker berjalan di http://localhost:${PORT}`);
  startScheduler();
});
