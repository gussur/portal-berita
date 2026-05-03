import os
import json
import time
import requests
from google import genai
from google.genai import types
import feedparser

# ==========================================
# KONFIGURASI API & KREDENSIAL
# ==========================================
WP_URL_POSTS = "https://gussur.com/wp-json/wp/v2/posts"
WP_USER = os.environ.get("WP_USER")
WP_APP_PASS = os.environ.get("WP_APP_PASS")
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")

client = genai.Client(api_key=GEMINI_API_KEY)

# ==========================================
# 1. AMBIL TRENDING TOPIC PER KATEGORI
# ==========================================
CATEGORY_FEEDS = {
    "Life": {
        "feeds": [
            "https://news.google.com/rss/search?q=atlet+indonesia+profil&hl=id&gl=ID&ceid=ID:id",
            "https://news.google.com/rss/search?q=pelari+indonesia&hl=id&gl=ID&ceid=ID:id",
            "https://news.google.com/rss/search?q=kisah+atlet+juara&hl=id&gl=ID&ceid=ID:id",
        ],
        "keywords": ['atlet', 'pelari', 'juara', 'kisah', 'profil', 'sang', 'ia', 'dia', 'namanya'],
        "fallback": "Pelari Muda Indonesia yang Menginspirasi"
    },
    "Memories": {
        "feeds": [
            "https://news.google.com/rss/search?q=kenangan+olahraga+indonesia&hl=id&gl=ID&ceid=ID:id",
            "https://news.google.com/rss/search?q=sejarah+marathon+indonesia&hl=id&gl=ID&ceid=ID:id",
            "https://news.google.com/rss/search?q=nostalgia+lari+sepeda&hl=id&gl=ID&ceid=ID:id",
        ],
        "keywords": ['pertama', 'dulu', 'sejarah', 'kenangan', 'pernah', 'tahun', 'masa', 'awal', 'nostalgia'],
        "fallback": "Pertama Kali Menyentuh Garis Finish"
    },
    "Travels": {
        "feeds": [
            "https://news.google.com/rss/search?q=rute+lari+wisata+indonesia&hl=id&gl=ID&ceid=ID:id",
            "https://news.google.com/rss/search?q=marathon+event+indonesia+2025&hl=id&gl=ID&ceid=ID:id",
            "https://news.google.com/rss/search?q=travel+sport+destinasi&hl=id&gl=ID&ceid=ID:id",
        ],
        "keywords": ['rute', 'destinasi', 'kota', 'jalan', 'trail', 'event', 'race', 'lomba', 'wisata'],
        "fallback": "Lari di Antara Kota yang Belum Pernah Kau Kenal"
    },
    "Review": {
        "feeds": [
            "https://news.google.com/rss/search?q=review+sepatu+lari+2025&hl=id&gl=ID&ceid=ID:id",
            "https://news.google.com/rss/search?q=rekomendasi+perlengkapan+lari&hl=id&gl=ID&ceid=ID:id",
            "https://news.google.com/rss/search?q=aplikasi+olahraga+terbaik&hl=id&gl=ID&ceid=ID:id",
        ],
        "keywords": ['review', 'rekomendasi', 'terbaik', 'sepatu', 'aplikasi', 'gear', 'produk', 'beli', 'pakai'],
        "fallback": "Sepatu Lari yang Menemani Ribuan Kilometer"
    },
}

def get_topic_for_category(category):
    config = CATEGORY_FEEDS.get(category)
    if not config:
        return "Lari Pagi di Jakarta"
    
    try:
        for url in config["feeds"]:
            feed = feedparser.parse(url)
            for entry in feed.entries[:10]:
                title = entry.title.lower()
                if any(keyword in title for keyword in config["keywords"]):
                    print(f"Topik [{category}] ditemukan: {entry.title}")
                    return entry.title
    except Exception as e:
        print(f"RSS error untuk {category}: {e}")
    
    print(f"Topik [{category}] pakai fallback: {config['fallback']}")
    return config["fallback"]

# ==========================================
# 2. GENERATE ARTIKEL
# ==========================================
def generate_article(topic, category):
    system_prompt = f"""
    Kamu adalah penulis untuk blog gussur.com. Gaya tulisanmu:
    1. Sudut Pandang: Orang pertama ("aku" atau "saya"), intim, seperti catatan harian.
    2. Tone: Reflektif, tenang, naratif.
    3. Konten: Memadukan fakta (sejarah, data) dengan perenungan personal.
    4. Panjang artikel: Sekitar 1000 kata.
    5. Gunakan sub-judul HTML (<h2>) yang puitis.
    
    Tugas: Tulis artikel blog tentang '{topic}' dari sudut pandang kategori '{category}'.
    
    Output harus berupa JSON dengan key persis seperti ini: 
    "title", "content" (format HTML), "seo_title", "seo_desc", "focus_keyword".
    """
    
    try:
        response = client.models.generate_content(
            model='gemini-2.5-flash',
            contents=system_prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
            )
        )
        return json.loads(response.text)
    except Exception as e:
        print(f"Error parsing Gemini response untuk kategori {category}: {e}")
        return None

# ==========================================
# 3. PUSH KE WORDPRESS
# ==========================================
def push_to_wordpress(article_data, wp_category_id):
    if not article_data:
        return
        
    auth = (WP_USER, WP_APP_PASS)
    headers = {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    }
    
    payload = {
        'title': article_data['title'],
        'content': article_data['content'],
        'status': 'draft',
        'categories': [wp_category_id],
        'meta': {
            'rank_math_title': article_data['seo_title'],
            'rank_math_description': article_data['seo_desc'],
            'rank_math_focus_keyword': article_data['focus_keyword']
        }
    }
    
    response = requests.post(WP_URL_POSTS, headers=headers, auth=auth, json=payload)
    
    if response.status_code == 201:
        print(f"✅ Sukses membuat draft: {article_data['title']}")
    else:
        print(f"❌ Gagal push ke WP. Status: {response.status_code}, Response: {response.text}")

# ==========================================
# MAIN PIPELINE
# ==========================================
if __name__ == "__main__":
    categories = {
        "Life": 565,
        "Memories": 566,
        "Travels": 567,
        "Review": 571
    }
    
    for cat_name, cat_id in categories.items():
        print(f"⚙️ Mencari topik untuk kategori: {cat_name}...")
        topic = get_topic_for_category(cat_name)
        
        print(f"⚙️ Membuat artikel untuk: {topic}...")
        article_data = generate_article(topic, cat_name)
        
        if article_data:
            print(f"🚀 Push draf {cat_name} ke WordPress...")
            push_to_wordpress(article_data, cat_id)
            
        print("⏳ Jeda 3 detik...")
        time.sleep(3)
        print("-" * 30)
        
    print("🎉 Pipeline Selesai!")
