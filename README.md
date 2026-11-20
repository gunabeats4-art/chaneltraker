# YouTube Channel Tracker

Aplikasi dashboard web dan bot penjadwal backend untuk memantau serta menganalisis pertumbuhan channel YouTube publik (**subscriber**, **total views**, **likes video terlacak**, performa video terbaru, serta **perbandingan sentimen komentar video**).

> **Catatan Etika & Kebijakan:** Aplikasi ini murni alat pemantauan dan analisis data publik menggunakan **YouTube Data API v3**. Aplikasi ini **tidak** memiliki dan tidak mendukung fitur penambahan subscriber, like, maupun views secara otomatis atau palsu.

---

## Fitur Utama

### 1. Website Dashboard (`public/`)
- **Tambah Channel Fleksibel**: Mendukung URL channel, `@handle`, maupun ID channel (`UC...`), plus target subscriber opsional.
- **Kartu Ringkasan Channel**: Avatar, nama, jumlah subscriber, total views, total likes dari video terlacak, jumlah video, milestone tertinggi, serta indikator progres target.
- **Grafik Riwayat (Chart.js)**: Grafik historis subscriber dan total views dengan pilihan rentang `7 Hari`, `30 Hari`, atau `Semua`, lengkap dengan titik penanda lonjakan.
- **Analisis Pertumbuhan Subscriber**:
  - **Laju Pertumbuhan**: Pertambahan subscriber & views per hari dan per minggu beserta persentase naik/turun dibanding periode 7 hari sebelumnya.
  - **Proyeksi Target (Regresi Linear)**: Perkiraan tanggal tercapainya target subscriber menggunakan Ordinary Least Squares (OLS) dari data snapshot historis.
  - **Milestone Otomatis**: Badge otomatis saat mencapai `100`, `1K`, `10K`, `50K`, `100K`, `500K`, `1M`, dst.
  - **Korelasi Video & Lonjakan**: Mendeteksi lonjakan harian (`> 2x` rata-rata 7 hari) dan menampilkan video yang diupload dalam ±48 jam di sekitar lonjakan.
  - **Perbandingan Antar Channel**: Menggabungkan beberapa channel dalam satu grafik (Subscriber, Views, atau Pertumbuhan %).
- **Analisis Performa Video & Sentimen Komentar**:
  - Peringkat video berdasarkan **views per jam** sejak upload, likes, dan engagement rate.
  - Analisis **jam upload terbaik (WIB)** berdasarkan rata-rata views/jam historis.
  - **Perbandingan Sentimen Komentar Video**: Mengambil komentar publik via `commentThreads.list`, mengklasifikasikan sentimen Positif / Netral / Negatif (mendukung Bahasa Indonesia, Inggris, negasi, penguat, dan emoji), lalu memvisualisasikan perbandingan beberapa video dalam satu grafik batang bertumpuk beserta contoh komentarnya.
- **Pusat Notifikasi & Notifikasi Browser**: Ikon lonceng untuk video baru, target subscriber tercapai, milestone baru, dan lonjakan subscriber.
- **Ekspor CSV & Mode Gelap/Terang**: Ekspor riwayat snapshot + video ke CSV (kompatibel Excel) serta switch tema gelap/terang.

### 2. Bot Penjadwal & Hemat Kuota (`src/jobs/checker.js`)
- Berjalan berkala menggunakan `node-cron` (default tiap 10 menit: `*/10 * * * *`, dapat diatur via `.env`).
- **Hemat Kuota (10.000 unit/hari)**:
  - Menggabungkan banyak channel sekaligus ke `channels.list` (maksimal 50 ID per request = **1 unit kuota**).
  - Mengambil daftar video terbaru lewat `playlistItems.list` (**1 unit**) alih-alih `search.list` (**100 unit**).
  - Mengambil statistik views, likes, dan komentar video secara batch lewat `videos.list` (**1 unit per 50 video**).
- Mencatat error (kuota habis, API key tidak valid, channel tidak ditemukan, timeout) ke tabel `app_logs` dan menampilkannya di tab **Log Bot**.

---

## Cara Mendapatkan YouTube API Key

1. Buka [Google Cloud Console](https://console.cloud.google.com/).
2. Buat project baru (atau pilih project yang sudah ada).
3. Masuk ke menu **APIs & Services -> Library**.
4. Cari **YouTube Data API v3**, lalu klik **Enable**.
5. Buka menu **APIs & Services -> Credentials**.
6. Klik **Create Credentials -> API key**, lalu salin API key tersebut.
7. *(Disarankan)* Klik **Edit API key** dan batasi akses hanya ke **YouTube Data API v3** di bagian API restrictions.

---

## Instalasi & Menjalankan Aplikasi

1. **Install dependensi**:
   ```bash
   npm install
   ```

2. **Konfigurasi file `.env`**:
   Salin `.env.example` menjadi `.env`, lalu isi `YOUTUBE_API_KEY`:
   ```bash
   cp .env.example .env
   ```
   Contoh isi `.env`:
   ```env
   YOUTUBE_API_KEY="AIzaSy..."
   PORT=3000
   CHECK_INTERVAL="*/10 * * * *"
   DB_PATH="./data/tracker.db"
   ```

3. **Jalankan server**:
   ```bash
   npm run dev
   ```
   atau untuk produksi:
   ```bash
   npm start
   ```

4. Buka browser dan akses `http://localhost:3000`.

---

## Struktur Folder

```text
├── .env.example
├── .gitignore
├── package.json
├── README.md
├── public/
│   ├── index.html          # Struktur dashboard statis (HTML + Chart.js CDN)
│   ├── style.css           # Tema terang/gelap responsif
│   └── app.js              # Logika UI, fetch API, dan render grafik
└── src/
    ├── server.js           # Entry point Express & penjadwal cron
    ├── db.js               # Koneksi SQLite (better-sqlite3) & skema tabel
    ├── jobs/
    │   └── checker.js      # Cron bot pengecek berkala & pembuat notifikasi
    ├── routes/
    │   ├── channels.js     # CRUD channel, history, analytics, target
    │   ├── videos.js       # Video terbaru & perbandingan sentimen komentar
    │   ├── notifications.js# Pusat notifikasi & mark-as-read
    │   └── system.js       # Compare channel, ekspor CSV, cek manual, status/log
    └── services/
        ├── youtube.js      # Wrapper YouTube Data API v3 hemat kuota
        ├── analytics.js    # Laju pertumbuhan, regresi linear, korelasi, video
        └── sentiment.js    # Analisis sentimen komentar dwibahasa (ID/EN)
```

---

## Contoh Format Input & Output Analisis

### Contoh Input `POST /api/channels`
```json
{
  "input": "@GoogleDevelopers",
  "subscriberTarget": 2500000
}
```
Format `input` lain yang diterima:
- `"https://www.youtube.com/@mkbhd"`
- `"https://www.youtube.com/channel/UC_x5XG1OV2P6uZZ5FSM9Ttw"`
- `"UC_x5XG1OV2P6uZZ5FSM9Ttw"`

### Contoh Output `GET /api/channels/1/analytics`
```json
{
  "channel": {
    "id": 1,
    "youtube_id": "UC_x5XG1OV2P6uZZ5FSM9Ttw",
    "title": "Google for Developers",
    "current_subscribers": 2410000,
    "current_views": 315000000,
    "total_likes_tracked": 14250,
    "subscriber_target": 2500000,
    "targetProgressPct": 96.4
  },
  "growth": {
    "dailySubscribers": 850,
    "weeklySubscribers": 5950,
    "growthChangePct": 14.2,
    "trend": "up",
    "dailyViews": 62000,
    "weeklyViews": 434000,
    "viewsChangePct": 9.8
  },
  "projection": {
    "status": "ok",
    "slopePerDay": 842.5,
    "daysRemaining": 107,
    "estimatedDate": "2027-03-07",
    "projected30Days": 2435275,
    "rSquared": 0.941
  },
  "milestones": {
    "highestBadge": { "value": 1000000, "label": "1M" },
    "nextMilestone": { "value": 5000000, "label": "5M", "remaining": 2590000, "progressPct": 35.3 }
  },
  "spikes": [
    {
      "date": "2026-11-18",
      "delta": 2400,
      "avg7d": 810.5,
      "multiplier": 3.0,
      "correlatedVideos": [
        {
          "youtubeVideoId": "abc123xyz",
          "title": "What's new in Web Platform",
          "views": 185000,
          "likes": 7400
        }
      ]
    }
  ]
}
```

### Contoh Output `GET /api/videos/sentiment/compare?ids=1,2`
```json
{
  "comparisons": [
    {
      "videoId": 1,
      "title": "Tutorial Build API Express",
      "positivePct": 74.3,
      "neutralPct": 20.0,
      "negativePct": 5.7,
      "totalAnalyzed": 35,
      "sentimentScore": 48.2
    },
    {
      "videoId": 2,
      "title": "Review Update Terbaru",
      "positivePct": 51.4,
      "neutralPct": 31.4,
      "negativePct": 17.2,
      "totalAnalyzed": 35,
      "sentimentScore": 21.5
    }
  ]
}
```

---

## Langkah Uji Coba

1. Pastikan `.env` sudah terisi `YOUTUBE_API_KEY` yang valid, lalu jalankan `npm run dev`.
2. Buka `http://localhost:3000`.
3. Pada menu **Ringkasan**, masukkan `@GoogleDevelopers` dan target `3000000`, lalu klik **Tambah Channel**. Pastikan kartu channel muncul dengan avatar, subscriber, views, likes video, dan progress bar.
4. Tambahkan 1–2 channel lagi (misal `@mkbhd` atau `@Fireship`) untuk menguji fitur multi-channel.
5. Klik tombol **Cek Sekarang** di header kanan atas untuk memicu siklus bot manual dan lihat hasilnya pada **Log Bot** dan **Pusat Notifikasi**.
6. Buka menu **Analisis Channel**, uji filter `7 Hari` / `30 Hari` / `Semua`, ubah target subscriber, lalu klik **Ekspor CSV** dan pastikan file `.csv` terunduh.
7. Buka menu **Perbandingan**, centang 2–3 channel, lalu ganti metrik `Subscriber` / `Views` / `Pertumbuhan (%)`.
8. Buka menu **Video & Sentimen**, centang 2 video pada tabel, klik **Bandingkan Sentimen**, dan periksa grafik batang bertumpuk serta cuplikan komentar yang diklasifikasikan.
9. Uji tombol toggle **Mode Gelap / Terang** di pojok kanan atas.

---

## Cara Upload ke GitHub & Hosting Online (Bisa Dibuka di Browser)

> **Penting tentang GitHub Pages:** GitHub Pages (`username.github.io`) hanya bisa menghosting file statis (HTML/CSS/JS) dan **tidak** mendukung server Node.js, penjadwal `node-cron`, database SQLite, maupun penyimpanan aman `YOUTUBE_API_KEY`. Karena itu, langkah terbaik adalah menyimpan kode di **GitHub**, lalu menghubungkan repo GitHub tersebut ke layanan hosting Node.js seperti **Render**, **Railway**, atau **Koyeb**.

### 1. Upload Proyek ke GitHub
1. Buat repository baru di [github.com/new](https://github.com/new) (misalnya `youtube-channel-tracker`).
2. Jalankan perintah berikut di folder proyek (file `.env` dan `data/*.db` otomatis diabaikan oleh `.gitignore` agar API key Anda tidak bocor):
   ```bash
   git init
   git add .
   git commit -m "Initial commit YouTube Channel Tracker"
   git branch -M main
   git remote add origin https://github.com/USERNAME_ANDA/youtube-channel-tracker.git
   git push -u origin main
   ```

### 2. Hosting Gratis dari GitHub Menggunakan Render (Rekomendasi)
Proyek ini sudah dilengkapi file `render.yaml` dan `Dockerfile` sehingga langsung siap dideploy:
1. Daftar/masuk ke [render.com](https://render.com) menggunakan akun **GitHub** Anda.
2. Pilih **New + -> Web Service** (atau **Blueprint** jika ingin membaca `render.yaml` otomatis).
3. Pilih repository GitHub `youtube-channel-tracker`.
4. Pastikan pengaturan berikut:
   - **Runtime:** `Node`
   - **Build Command:** `npm install --omit=dev`
   - **Start Command:** `npm start`
5. Di bagian **Environment Variables**, tambahkan:
   - `YOUTUBE_API_KEY` = *(API key YouTube Data API v3 Anda)*
   - `CHECK_INTERVAL` = `*/10 * * * *`
6. Klik **Create Web Service**. Setelah build selesai, Anda akan mendapatkan URL publik (`https://youtube-channel-tracker-xxxx.onrender.com`) yang bisa langsung dibuka dari browser mana saja.

*(Alternatif lain: gunakan **Railway**, **Koyeb**, atau **Fly.io** yang juga mendukung koneksi langsung ke repository GitHub memakai `Dockerfile` di proyek ini. Catatan: pada paket gratis Render yang menggunakan disk sementara, data SQLite akan ter-reset saat instance restart kecuali Anda menambahkan Persistent Disk.)*

