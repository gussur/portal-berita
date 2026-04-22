import os
import json
import requests
import google.generativeai as genai
from pytrends.request import TrendReq

# ==========================================
# KONFIGURASI API & KREDENSIAL
# ==========================================
WP_URL = "https://gussur.com/wp-json/wp/v2/posts"
WP_USER = os.environ.get("WP_USER")
WP_APP_PASS = os.environ.get("WP_APP_PASS")
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")

genai.configure(api_key=GEMINI_API_KEY)
model = genai.GenerativeModel('gemini-2.5-flash')

# ==========================================
# AMBIL TRENDING TOPIC (PYTRENDS)
# ==========================================
def get_trending_sports_topic():
    try:
        pytrends = TrendReq(hl='id-ID', tz=420)
        trending_searches = pytrends.trending_searches(pn='indonesia')
        keywords = ['marathon', 'lari', 'sepeda', 'tour', 'juara', 'olimpiade', 'travel']
        
        for index, row in trending_searches.iterrows():
            topic = row[0].lower()
            if any(keyword in topic for keyword in keywords):
                return topic
    except Exception as e:
        print(f"Pytrends error: {e}")
        
    return "Boston Marathon" # Fallback topic

# ==========================================
# GENERATE ARTIKEL VIA GEMINI
# ==========================================
def generate_article(topic, category):
    system_prompt = f"""
    Kamu adalah penulis untuk blog gussur.com. Gaya tulisanmu:
    1. Sudut Pandang: Orang pertama ("aku" atau "saya"), intim, seperti catatan harian atau jurnal perjalanan.
    2. Tone: Reflektif, tenang, naratif, tidak terburu-buru.
    3. Konten: Memadukan fakta (sejarah, data, event) dengan perenungan personal dan memori.
    4. Panjang artikel: Sekitar 1000 kata.
    5. Gunakan sub-judul (heading) yang puitis namun deskriptif.
    
    Tugas: Tulis artikel blog tentang '{topic}' dari sudut pandang kategori '{category}'.
    
    Berikan output murni dalam format JSON (tanpa markdown block ```json) dengan key: 
    "title", "content" (format HTML dasar seperti <h2>, <p>), "seo_title", "seo_desc", "focus_keyword".
    """
    
    try:
        response = model.generate_content(system_prompt)
        # Membersihkan output jika Gemini masih menambahkan markdown
        clean_json = response.text.strip().removeprefix('```json').removesuffix('```').strip()
        return json.loads(clean_json)
    except Exception as e:
        print(f"Error parsing Gemini response untuk kategori {category}: {e}")
        return None

# ==========================================
# PUSH KE WORDPRESS SEBAGAI DRAFT
# ==========================================
def push_to_wordpress(article_data, wp_category_id):
    if not article_data:
        return
        
    auth = (WP_USER, WP_APP_PASS)
    headers = {'Content-Type': 'application/json'}
    
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
    
    response = requests.post(WP_URL, headers=headers, auth=auth, json=payload)
    
    if response.status_code == 201:
        print(f"✅ Sukses membuat draft: {article_data['title']}")
    else:
        print(f"❌ Gagal push ke WP. Status: {response.status_code}, Response: {response.text}")

# ==========================================
# MAIN PIPELINE
# ==========================================
if __name__ == "__main__":
    print("Mencari topik trending...")
    topic = get_trending_sports_topic()
    print(f"Topik terpilih: {topic}\n")
    
    # ID Kategori gussur.com
    categories = {
        "Life": 565,
        "Memories": 566,
        "Travels": 567,
        "Review": 571
    }
    
    for cat_name, cat_id in categories.items():
        print(f"⚙️ Membuat artikel untuk kategori: {cat_name}...")
        article_data = generate_article(topic, cat_name)
        
        print(f"🚀 Push draf {cat_name} ke WordPress...")
        push_to_wordpress(article_data, cat_id)
        print("-" * 30)
        
    print("🎉 Pipeline Selesai!")
