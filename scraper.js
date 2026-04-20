// scraper.js — Portal Berita Ekonomi gussur.com
// Alur: RSS → dedup → Gemini rewrite → WordPress draft

const Parser = require('rss-parser');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const path = require('path');

// ─────────────────────────────────────────
// KONFIGURASI
// ─────────────────────────────────────────

const RSS_FEEDS = [
  { name: 'Google News: IHSG',    url: 'https://news.google.com/rss/search?q=IHSG+saham&hl=id&gl=ID&ceid=ID:id' },
  { name: 'Google News: Ekonomi', url: 'https://news.google.com/rss/search?q=ekonomi+Indonesia+pasar+modal&hl=id&gl=ID&ceid=ID:id' },
  { name: 'Google News: IDX',     url: 'https://news.google.com/rss/search?q=Bursa+Efek+Indonesia+emiten&hl=id&gl=ID&ceid=ID:id' },
  { name: 'Google News: Rupiah',  url: 'https://news.google.com/rss/search?q=rupiah+inflasi+BI+rate&hl=id&gl=ID&ceid=ID:id' },
];

const MAX_ARTICLES_PER_RUN = 8;
const DELAY_BETWEEN_REQUESTS = 2500;
const PROCESSED_FILE = path.join(__dirname, 'processed_urls.json');

// Mapping nama kategori → ID WordPress
const CATEGORY_MAP = {
  'IHSG':      606,
  'Emiten':    607,
  'Makro':     608,
  'Komoditas': 609,
  'Obligasi':  610,
};

// ID induk kategori Ekonomi (parent)
const EKONOMI_PARENT_ID = null; // isi jika ada, atau biarkan null

// ─────────────────────────────────────────
// DEDUP
// ─────────────────────────────────────────

function loadProcessed() {
  if (!fs.existsSync(PROCESSED_FILE)) return new Set();
  try {
    const data = JSON.parse(fs.readFileSync(PROCESSED_FILE, 'utf8'));
    return new Set(data);
  } catch {
    return new Set();
  }
}

function saveProcessed(urlSet) {
  const arr = Array.from(urlSet).slice(-500);
  fs.writeFileSync(PROCESSED_FILE, JSON.stringify(arr, null, 2));
}

// ─────────────────────────────────────────
// RSS FETCHER
// ─────────────────────────────────────────

async function fetchFeed(feedUrl, feedName) {
  const parser = new Parser({
    timeout: 10000,
    headers: { 'User-Agent': 'gussur-scraper/1.0' },
  });
  try {
    const feed = await parser.parseURL(feedUrl);
    return feed.items.map(item => ({
      title:   (item.title || '').trim(),
      link:    item.link || '',
      content: item.contentSnippet || item.summary || item.content || '',
      pubDate: item.pubDate || new Date().toISOString(),
      source:  feedName,
    }));
  } catch (err) {
    console.error(`  ⚠️  Gagal ambil ${feedName}: ${err.message}`);
    return [];
  }
}

// ─────────────────────────────────────────
// GEMINI REWRITER
// Sekaligus generate: artikel, kategori, tags, SEO
// ─────────────────────────────────────────

const SYSTEM_PROMPT = `Kamu adalah editor di blog gussur.com — blog ekonomi dan pasar modal Indonesia dengan gaya khas: 
Bahasa Indonesia formal-intim, kalimat aktif, padat berbasis data, kontemplasi ringan. Bukan hype, bukan motivasi.

Tugas: Tulis ulang berita ekonomi/saham berikut menjadi artikel blog, sekaligus tentukan kategori, tags, dan SEO.

JUDUL:
- Menarik tapi tidak clickbait
- Maksimal 10 kata
- Hindari tanda tanya dan tanda seru

ISI (3–4 paragraf, 200–250 kata total):
- Paragraf 1: fakta utama berita langsung tanpa basa-basi
- Paragraf 2–3: konteks dan detail penting
- Paragraf 4: satu kalimat analitik yang memberi perspektif pasar IDX
- Sertakan kode ticker jika ada ($BBCA, $TLKM, $GOTO, dst)
- Kalimat terakhir: atribusi sumber — "Sumber: [nama media]."

HINDARI:
"Tahukah kamu", "Yuk simak", "Di era modern ini", "Sangat penting untuk", 
kata serapan Inggris yang tidak perlu, kalimat pasif berlebihan.

KATEGORI — pilih TEPAT SATU dari daftar ini:
- IHSG: berita indeks, pergerakan pasar harian, analisis IHSG
- Emiten: berita spesifik perusahaan/saham, laporan keuangan, aksi korporasi
- Makro: kebijakan BI, inflasi, kurs, pertumbuhan ekonomi, ekspor-impor
- Komoditas: batu bara, CPO, nikel, emas, minyak, komoditas lain
- Obligasi: SBN, obligasi korporasi, yield, suku bunga

TAGS — buat 4–6 tag relevan, format huruf kecil, gunakan nama spesifik:
Contoh: ihsg, bank central asia, bbca, saham perbankan, idx, net sell asing

META DESCRIPTION — 1 kalimat ringkas 120–155 karakter untuk mesin pencari.
Harus deskriptif, mengandung kata kunci utama, tidak diakhiri titik-titik.

FOCUS KEYWORD — 2–4 kata kunci utama artikel ini (frasa, bukan kalimat).
Contoh: "saham BBCA hari ini" atau "IHSG melemah asing jual"

Balas HANYA dengan JSON valid tanpa markdown, tanpa backtick:
{
  "title": "...",
  "content": "...",
  "category": "IHSG",
  "tags": ["ihsg", "bursa efek indonesia", "saham"],
  "meta_description": "...",
  "focus_keyword": "..."
}`;

async function rewriteWithGemini(article) {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

  const userMessage = `Sumber: ${article.source}
Judul asli: ${article.title}
Isi: ${article.content.substring(0, 1500)}`;

  const result = await model.generateContent([
    { text: SYSTEM_PROMPT },
    { text: userMessage },
  ]);

  const raw = result.response.text().trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '');

  try {
    return JSON.parse(raw);
  } catch {
    console.warn('  ⚠️  JSON parse gagal, pakai judul asli');
    return {
      title: article.title,
      content: raw,
      category: 'IHSG',
      tags: [],
      meta_description: article.title,
      focus_keyword: article.title.split(' ').slice(0, 3).join(' '),
    };
  }
}

// ─────────────────────────────────────────
// WORDPRESS POSTER
// ─────────────────────────────────────────

async function getOrCreateTags(tagNames, auth, wpUrl) {
  const tagIds = [];

  for (const name of tagNames) {
    if (!name || !name.trim()) continue;
    const cleanName = name.trim().toLowerCase();

    // Cek apakah tag sudah ada
    const searchRes = await fetch(
      `${wpUrl}/wp-json/wp/v2/tags?search=${encodeURIComponent(cleanName)}&per_page=5`,
      { headers: { 'Authorization': `Basic ${auth}` } }
    );
    const existing = await searchRes.json();
    const found = existing.find(t => t.name.toLowerCase() === cleanName);

    if (found) {
      tagIds.push(found.id);
    } else {
      // Buat tag baru
      const createRes = await fetch(`${wpUrl}/wp-json/wp/v2/tags`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${auth}`,
        },
        body: JSON.stringify({ name: cleanName }),
      });
      if (createRes.ok) {
        const newTag = await createRes.json();
        tagIds.push(newTag.id);
      }
    }
  }

  return tagIds;
}

async function postToWordPress(article, rewritten) {
  const { WP_URL, WP_USER, WP_APP_PASSWORD } = process.env;

  if (!WP_URL || !WP_USER || !WP_APP_PASSWORD) {
    throw new Error('Kredensial WordPress belum diset di environment variables');
  }

  const auth = Buffer.from(`${WP_USER}:${WP_APP_PASSWORD}`).toString('base64');

  // Resolve category ID
  const categoryName = rewritten.category || 'IHSG';
  const categoryId = CATEGORY_MAP[categoryName] || CATEGORY_MAP['IHSG'];

  // Resolve atau buat tag IDs
  const tagIds = await getOrCreateTags(rewritten.tags || [], auth, WP_URL);

  // Format konten HTML
  const htmlContent = rewritten.content
    .split('\n\n')
    .filter(p => p.trim())
    .map(p => `<p>${p.trim()}</p>`)
    .join('\n');

  const disclaimer = `\n<hr>\n<p><em>Artikel ini dibuat secara otomatis berdasarkan berita dari ${article.source}. Bukan rekomendasi investasi. Selalu lakukan riset mandiri sebelum mengambil keputusan.</em></p>`;

  const payload = {
    title:      rewritten.title,
    content:    htmlContent + disclaimer,
    excerpt:    rewritten.meta_description || '',
    status:     'draft',
    categories: [categoryId],
    tags:       tagIds,
    meta: {
      // Rank Math SEO fields
      rank_math_focus_keyword:  rewritten.focus_keyword || '',
      rank_math_description:    rewritten.meta_description || '',
      // Source tracking
      _source_url:  article.link,
      _source_name: article.source,
    },
  };

  const res = await fetch(`${WP_URL}/wp-json/wp/v2/posts`, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Basic ${auth}`,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`WordPress ${res.status}: ${errText.substring(0, 200)}`);
  }

  return await res.json();
}

// ─────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────

async function main() {
  const startTime = new Date();
  console.log(`\n🗞️  gussur.com Scraper — ${startTime.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB\n`);

  const processed = loadProcessed();
  let candidates = [];

  for (const feed of RSS_FEEDS) {
    console.log(`📡 Mengambil: ${feed.name}`);
    const items = await fetchFeed(feed.url, feed.name);
    const fresh = items.filter(item =>
      item.link &&
      item.content.length > 20 &&
      !processed.has(item.link)
    );
    console.log(`   → ${fresh.length} artikel baru dari ${items.length} total`);
    candidates.push(...fresh);
  }

  console.log(`\n📰 Total kandidat: ${candidates.length} artikel`);

  if (candidates.length === 0) {
    console.log('ℹ️  Tidak ada artikel baru. Selesai.\n');
    return;
  }

  const toProcess = candidates.slice(0, MAX_ARTICLES_PER_RUN);
  console.log(`⚙️  Memproses ${toProcess.length} artikel...\n`);

  let successCount = 0;
  let failCount = 0;

  for (const article of toProcess) {
    console.log(`▶  ${article.title.substring(0, 60)}...`);
    try {
      const rewritten = await rewriteWithGemini(article);
      const wpPost = await postToWordPress(article, rewritten);

      processed.add(article.link);
      successCount++;
      console.log(`   ✅ Draft: "${rewritten.title}"`);
      console.log(`      Kategori: ${rewritten.category} | Tags: ${(rewritten.tags || []).join(', ')}`);
      console.log(`      SEO: ${rewritten.focus_keyword}`);
    } catch (err) {
      failCount++;
      console.error(`   ❌ Gagal: ${err.message}`);
    }

    await new Promise(r => setTimeout(r, DELAY_BETWEEN_REQUESTS));
  }

  saveProcessed(processed);

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n🏁 Selesai dalam ${duration}s — ${successCount} berhasil, ${failCount} gagal\n`);
  console.log('📋 Silakan buka WordPress dashboard untuk review dan publish.\n');
}

main().catch(err => {
  console.error('💥 Fatal error:', err.message);
  process.exit(1);
}).then(() => {
  process.exit(0);
});
