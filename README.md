# gussur-scraper

Scraper berita ekonomi otomatis untuk portal saham di gussur.com.  
Berjalan tiap pagi jam 05:00 WIB via GitHub Actions, posting ke WordPress sebagai draft.

---

## Cara Setup

### 1. Buat repo GitHub baru (private)

Upload ketiga file ini: `scraper.js`, `package.json`, `.github/workflows/scrape.yml`

### 2. Dapatkan Gemini API Key

- Buka [aistudio.google.com](https://aistudio.google.com) dengan akun Gmail personal
- Klik **Get API key** → **Create API key**
- Simpan key-nya

### 3. Buat WordPress Application Password

- Login ke WordPress > Users > Profile
- Scroll ke bawah ke bagian **Application Passwords**
- Ketik nama (misal: "gussur-scraper") → klik **Add New**
- Salin password yang muncul (hanya tampil sekali)

### 4. Isi GitHub Secrets

Di repo GitHub: **Settings → Secrets and variables → Actions → New repository secret**

| Secret | Nilai |
|--------|-------|
| `GEMINI_API_KEY` | API key dari AI Studio |
| `WP_URL` | URL blog kamu, misal: `https://gussur.com` |
| `WP_USER` | Username WordPress kamu |
| `WP_APP_PASSWORD` | Application password dari langkah 3 |

### 5. Jalankan manual pertama kali

Di repo GitHub → tab **Actions** → **Scrape Berita Ekonomi** → **Run workflow**

Cek hasilnya di WordPress dashboard → Posts → Drafts.

---

## Kustomisasi

**Ganti sumber RSS** — edit array `RSS_FEEDS` di `scraper.js`

**Tambah kategori WordPress** — isi `WP_CATEGORY_IDS` dengan ID kategori yang diinginkan  
(cari ID di WordPress: Posts → Categories, lihat URL saat hover nama kategori)

**Ubah jumlah artikel per hari** — edit `MAX_ARTICLES_PER_RUN`

**Ganti jadwal** — edit baris `cron` di workflow YAML  
Format: menit jam * * * (UTC)  
05:00 WIB = 22:00 UTC = `0 22 * * *`

---

## Disclaimer

Artikel yang dihasilkan bukan rekomendasi investasi.  
Selalu tambahkan disclaimer di halaman portal.
