// scraper.js — Portal Berita Ekonomi gussur.com
// Alur: RSS → dedup → Gemini rewrite → data/berita.json → git push → Vercel redeploy

const Parser = require('rss-parser');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ─────────────────────────────────────────
// KONFIGURASI
// ─────────────────────────────────────────

const RSS_FEEDS = [
  // ── IHSG ──────────────────────────────────
  { name: 'Kontan: Pasar Modal',    url: 'https://news.google.com/rss/search?q=site:kontan.co.id+IHSG+saham&hl=id&gl=ID&ceid=ID:id',                  category: 'IHSG'      },
  { name: 'CNBC: Pasar Modal',      url: 'https://news.google.com/rss/search?q=site:cnbcindonesia.com+IHSG+bursa&hl=id&gl=ID&ceid=ID:id',              category: 'IHSG'      },

  // ── Emiten ────────────────────────────────
  { name: 'Kontan: Emiten',         url: 'https://news.google.com/rss/search?q=site:kontan.co.id+emiten+saham&hl=id&gl=ID&ceid=ID:id',                 category: 'Emiten'    },
  { name: 'Bisnis: Emiten',         url: 'https://news.google.com/rss/search?q=site:bisnis.com+emiten+laporan+keuangan&hl=id&gl=ID&ceid=ID:id',        category: 'Emiten'    },

  // ── Makro ─────────────────────────────────
  { name: 'Kontan: Makro',          url: 'https://news.google.com/rss/search?q=site:kontan.co.id+inflasi+OR+BI+rate+OR+rupiah&hl=id&gl=ID&ceid=ID:id', category: 'Makro'     },
  { name: 'Bloomberg Technoz',      url: 'https://news.google.com/rss/search?q=site:bloombergtechnoz.com&hl=id&gl=ID&ceid=ID:id',                      category: 'Makro'     },

  // ── Komoditas ─────────────────────────────
  { name: 'Kontan: Komoditas',      url: 'https://news.google.com/rss/search?q=site:kontan.co.id+komoditas+OR+batu+bara+OR+nikel+OR+CPO&hl=id&gl=ID&ceid=ID:id', category: 'Komoditas' },
  { name: 'CNBC: Komoditas',        url: 'https://news.google.com/rss/search?q=site:cnbcindonesia.com+komoditas+OR+emas+OR+minyak&hl=id&gl=ID&ceid=ID:id',      category: 'Komoditas' },

  // ── Obligasi ──────────────────────────────
  { name: 'Bisnis: Obligasi',       url: 'https://news.google.com/rss/search?q=site:bisnis.com+obligasi+OR+SBN+OR+yield&hl=id&gl=ID&ceid=ID:id',      category: 'Obligasi'  },
  { name: 'CNBC: Perbankan',        url: 'https://news.google.com/rss/search?q=site:cnbcindonesia.com+BI+rate+OR+suku+bunga+OR+perbankan&hl=id&gl=ID&ceid=ID:id', category: 'Obligasi'  },
];

const MAX_PER_CATEGORY    = 2; // 5 kategori × 2 = 10 artikel/hari
const DELAY_BETWEEN_REQUESTS = 2500;
const PROCESSED_FILE      = path.join(__dirname, 'processed_urls.json');
const OUTPUT_FILE         = path.join(__dirname, 'data', 'berita.json');

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

async function fetchFeed(feedUrl, feedName, category) {
  const parser = new Parser({
    timeout: 10000,
    headers: { 'User-Agent': 'gussur-scraper/1.0' },
  });
  try {
    const feed = await parser.parseURL(feedUrl);
    return feed.items.map(item => ({
      title:    (item.title || '').trim(),
      link:     item.link || '',
      content:  item.contentSnippet || item.summary || item.content || '',
      pubDate:  item.pubDate || new Date().toISOString(),
      source:   feedName,
      category,
    }));
  } catch (err) {
    console.error(`  ⚠️  Gagal ambil ${feedName}: ${err.message}`);
    return [];
  }
}

// ─────────────────────────────────────────
// SYSTEM PROMPT
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

// ─────────────────────────────────────────
// FALLBACK REWRITER
// Urutan: gemini-2.5-flash → gemini-2.0-flash → Claude
// Circuit breaker: skip model selama 3 menit setelah 503
// ─────────────────────────────────────────

const MODELS = [
  { provider: 'gemini', model: 'gemini-2.5-flash' },
  { provider: 'claude', model: 'claude-sonnet-4-20250514' },
];

const CIRCUIT_OPEN_MS = 3 * 60 * 1000;
const circuitBreaker  = {};

function isCircuitOpen(key) {
  const state = circuitBreaker[key];
  if (!state) return false;
  if (Date.now() - state.openedAt > CIRCUIT_OPEN_MS) {
    delete circuitBreaker[key];
    return false;
  }
  return true;
}

function openCircuit(key) {
  circuitBreaker[key] = { openedAt: Date.now() };
  console.warn(`  🔴 Circuit terbuka: ${key} (skip 3 menit)`);
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function callGemini(modelName, userMessage) {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: modelName });
  const result = await model.generateContent([
    { text: SYSTEM_PROMPT },
    { text: userMessage },
  ]);
  return result.response.text().trim();
}

async function callClaude(modelName, userMessage) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model:      modelName,
      max_tokens: 1500,
      system:     SYSTEM_PROMPT,
      messages:   [{ role: 'user', content: userMessage }],
    }),
  });

  if (!res.ok) {
    const err = new Error(`Claude HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }

  const data = await res.json();
  return (data.content?.[0]?.text || '').trim();
}

function parseJSON(raw, article) {
  const clean = raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  try {
    return JSON.parse(clean);
  } catch {
    console.warn('  ⚠️  JSON parse gagal, pakai fallback minimal');
    return {
      title:            article.title,
      content:          clean,
      category:         article.category || 'IHSG',
      tags:             [],
      meta_description: article.title,
      focus_keyword:    article.title.split(' ').slice(0, 3).join(' '),
    };
  }
}

async function callWithRetry(fn, maxRetries = 2) {
  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const retryable = err.status === 503 || err.status === 500 || err.status === 429
        || (err.message || '').includes('503')
        || (err.message || '').includes('overloaded');

      if (!retryable || attempt > maxRetries) throw err;

      const backoff = Math.min(1000 * 2 ** (attempt - 1) + Math.random() * 500, 8000);
      console.warn(`  ⏳ Retry ${attempt}/${maxRetries} dalam ${Math.round(backoff / 1000)}s...`);
      await sleep(backoff);
    }
  }
}

async function rewriteWithFallback(article) {
  const userMessage = `Sumber: ${article.source}
Judul asli: ${article.title}
Isi: ${article.content.substring(0, 1500)}`;

  for (const config of MODELS) {
    const key = `${config.provider}:${config.model}`;

    if (isCircuitOpen(key)) {
      console.log(`  ⏭️  Skip ${config.model} (circuit terbuka)`);
      continue;
    }

    try {
      console.log(`  🤖 Mencoba: ${config.model}`);
      let raw;

      if (config.provider === 'gemini') {
        raw = await callWithRetry(() => callGemini(config.model, userMessage));
      } else {
        raw = await callWithRetry(() => callClaude(config.model, userMessage));
      }

      const result = parseJSON(raw, article);
      if (config.provider === 'claude') {
        console.log(`  ✳️  Menggunakan Claude sebagai fallback`);
      }
      return result;

    } catch (err) {
      const is503 = err.status === 503
        || (err.message || '').includes('503')
        || (err.message || '').includes('overloaded');

      console.warn(`  ❌ ${config.model} gagal: ${err.status || err.message}`);
      if (is503) openCircuit(key);
    }
  }

  throw new Error('Semua provider gagal. Cek API key dan koneksi.');
}

// ─────────────────────────────────────────
// JSON WRITER
// ─────────────────────────────────────────

function loadExistingBerita() {
  if (!fs.existsSync(OUTPUT_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveBerita(articles) {
  const dir = path.dirname(OUTPUT_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  // Simpan max 200 artikel terbaru
  const trimmed = articles.slice(0, 200);
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(trimmed, null, 2));
}

function gitCommitAndPush() {
  try {
    execSync('git config user.email "scraper@gussur.com"');
    execSync('git config user.name "gussur-scraper"');
    execSync('git add data/berita.json processed_urls.json');
    execSync('git commit -m "chore: update berita otomatis [skip ci]"');
    execSync('git push');
    console.log('  📤 Git push berhasil → Vercel akan redeploy');
  } catch (err) {
    // Tidak ada perubahan = exit code 1 dari git commit, bukan error fatal
    if (err.message.includes('nothing to commit')) {
      console.log('  ℹ️  Tidak ada perubahan untuk di-commit');
    } else {
      console.warn(`  ⚠️  Git push gagal: ${err.message}`);
    }
  }
}

// ─────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────

async function main() {
  const startTime = new Date();
  console.log(`\n🗞️  gussur.com Scraper — ${startTime.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB\n`);

  const processed = loadProcessed();
  const byCategory = {};

  for (const feed of RSS_FEEDS) {
    console.log(`📡 Mengambil: ${feed.name}`);
    const items = await fetchFeed(feed.url, feed.name, feed.category);
    const fresh = items.filter(item =>
      item.link &&
      item.content.length > 20 &&
      !processed.has(item.link)
    );
    console.log(`   → ${fresh.length} artikel baru dari ${items.length} total`);

    for (const item of fresh) {
      const cat = item.category || 'IHSG';
      if (!byCategory[cat]) byCategory[cat] = [];
      byCategory[cat].push(item);
    }
  }

  // Distribusi merata per kategori
  const toProcess = Object.values(byCategory)
    .flatMap(items => items.slice(0, MAX_PER_CATEGORY));

  const totalCandidates = Object.values(byCategory).reduce((n, arr) => n + arr.length, 0);
  console.log(`\n📰 Total kandidat: ${totalCandidates} artikel`);
  console.log(`⚙️  Memproses ${toProcess.length} artikel (maks ${MAX_PER_CATEGORY}/kategori)...\n`);

  if (toProcess.length === 0) {
    console.log('ℹ️  Tidak ada artikel baru. Selesai.\n');
    return;
  }

  const existingBerita = loadExistingBerita();
  let successCount = 0;
  let failCount    = 0;
  const newBerita  = [];

  for (const article of toProcess) {
    console.log(`▶  ${article.title.substring(0, 60)}...`);
    try {
      const rewritten = await rewriteWithFallback(article);

      const entry = {
        id:               `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        title:            rewritten.title,
        content:          rewritten.content,
        category:         rewritten.category,
        tags:             rewritten.tags || [],
        meta_description: rewritten.meta_description || '',
        focus_keyword:    rewritten.focus_keyword || '',
        source_url:       article.link,
        source_name:      article.source,
        pub_date:         article.pubDate,
        scraped_at:       new Date().toISOString(),
      };

      newBerita.push(entry);
      processed.add(article.link);
      successCount++;

      console.log(`   ✅ "${rewritten.title}"`);
      console.log(`      Kategori: ${rewritten.category} | Tags: ${(rewritten.tags || []).join(', ')}`);
    } catch (err) {
      failCount++;
      console.error(`   ❌ Gagal: ${err.message}`);
    }

    await sleep(DELAY_BETWEEN_REQUESTS);
  }

  if (newBerita.length > 0) {
    // Artikel baru di atas, artikel lama di bawah
    const merged = [...newBerita, ...existingBerita];
    saveBerita(merged);
    saveProcessed(processed);
    console.log(`\n💾 Disimpan ke data/berita.json (${merged.length} artikel total)`);
    gitCommitAndPush();
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n🏁 Selesai dalam ${duration}s — ${successCount} berhasil, ${failCount} gagal\n`);
}

main().catch(err => {
  console.error('💥 Fatal error:', err.message);
  process.exit(1);
}).then(() => {
  process.exit(0);
});
