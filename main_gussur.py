import os
import json
import time
import requests
from google import genai
from google.genai import types
from pytrends.request import TrendReq

# ==========================================
# KONFIGURASI API & KREDENSIAL
# ==========================================
WP_URL_POSTS = "https://gussur.com/wp-json/wp/v2/posts"
WP_URL_MEDIA = "https://gussur.com/wp-json/wp/v2/media"
WP_USER = os.environ.get("WP_USER_GUSSUR")
WP_APP_PASS = os.environ.get("WP_APP_PASS_GUSSUR")
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")
UNSPLASH_API_KEY = os.environ.get("UNSPLASH_API_KEY")

client = genai.Client(api_key=GEMINI_API_KEY)

# ==========================================
# 1. AMBIL TRENDING TOPIC
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
        
    return "Boston Marathon" 

# ==========================================
# 2. GENERATE ARTIKEL (DENGAN MODE JSON KETAT)
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
        # Memaksa Gemini untuk mengeluarkan JSON murni (anti-error parsing)
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
# 3. CARI & UPLOAD GAMBAR UNSPLASH
# ==========================================
def get_and_upload_image(keyword):
    clean_keyword = keyword.split(',')[0].strip()
    print(f"Mencari gambar untuk keyword: {clean_keyword}...")
    
    if not UNSPLASH_API_KEY:
        print("API Key Unsplash tidak ditemukan!")
        return None
        
    unsplash_url = "https://api.unsplash.com/search/photos"
    params = {
        "page": 1,
        "query": clean_keyword,
        "client_id": UNSPLASH_API_KEY,
        "orientation": "landscape"
    }
    
    response = requests.get(unsplash_url, params=params)
    
    if response.status_code != 200 or not response.json()['results']:
        print("Gambar tidak ditemukan di Unsplash.")
        return None
        
    image_url = response.json()['results'][0]['urls']['regular']
    img_data = requests.get(image_url).content
    
    auth = (WP_USER, WP_APP_PASS)
    headers = {
        'Content-Type': 'image/jpeg',
        'Content-Disposition': f'attachment; filename="{clean_keyword.replace(" ", "-")}.jpg"'
    }
    
    wp_response = requests.post(WP_URL_MEDIA, headers=headers, auth=auth, data=img_data)
    
    if wp_response.status_code == 201:
        media_id = wp_response.json()['id']
        print(f"✅ Gambar berhasil diupload ke WP (Media ID: {media_id})")
        return media_id
    else:
        print(f"❌ Gagal upload gambar ke WP. Status: {wp_response.status_code}, Response: {wp_response.text}")
        return None

# ==========================================
# 4. PUSH KE WORDPRESS
# ==========================================
def push_to_wordpress(article_data, wp_category_id, media_id):
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
    
    if media_id:
        payload['featured_media'] = media_id
    
    response = requests.post(WP_URL_POSTS, headers=headers, auth=auth, json=payload)
    
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
    
    categories = {
        "Life": 565,
        "Memories": 566,
        "Travels": 567,
        "Review": 571
    }
    
    for cat_name, cat_id in categories.items():
        print(f"⚙️ Membuat artikel untuk kategori: {cat_name}...")
        article_data = generate_article(topic, cat_name)
        
        if article_data:
            media_id = get_and_upload_image(topic)
            
            print(f"🚀 Push draf {cat_name} ke WordPress...")
            push_to_wordpress(article_data, cat_id, media_id)
            
        print("⏳ Jeda 3 detik untuk menghindari blokir dari server...")
        time.sleep(3) # <--- Ini penangkal Error 429
        print("-" * 30)
        
    print("🎉 Pipeline Selesai!")
