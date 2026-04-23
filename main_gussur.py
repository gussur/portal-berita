import os
import json
import requests
import google.generativeai as genai
from pytrends.request import TrendReq

# ==========================================
# KONFIGURASI API & KREDENSIAL
# ==========================================
WP_URL_POSTS = "https://gussur.com/wp-json/wp/v2/posts"
WP_URL_MEDIA = "https://gussur.com/wp-json/wp/v2/media" # Endpoint baru untuk upload gambar
WP_USER = os.environ.get("WP_USER_GUSSUR")
WP_APP_PASS = os.environ.get("WP_APP_PASS_GUSSUR")
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")
UNSPLASH_API_KEY = os.environ.get("UNSPLASH_API_KEY") # API Key Unsplash

genai.configure(api_key=GEMINI_API_KEY)
model = genai.GenerativeModel('gemini-2.5-flash')

# ... [Fungsi get_trending_sports_topic() & generate_article() TETAP SAMA seperti sebelumnya] ...

# ==========================================
# FUNGSI BARU: CARI & UPLOAD GAMBAR
# ==========================================
def get_and_upload_image(keyword):
    print(f"Mencari gambar untuk keyword: {keyword}...")
    
    # 1. Cari gambar di Unsplash
    unsplash_url = f"https://api.unsplash.com/search/photos?page=1&query={keyword}&client_id={UNSPLASH_API_KEY}&orientation=landscape"
    response = requests.get(unsplash_url)
    
    if response.status_code != 200 or not response.json()['results']:
        print("Gambar tidak ditemukan di Unsplash.")
        return None
        
    # Ambil URL gambar pertama
    image_url = response.json()['results'][0]['urls']['regular']
    
    # 2. Download gambar tersebut sementara
    img_data = requests.get(image_url).content
    
    # 3. Upload ke WordPress Media Library
    auth = (WP_USER, WP_APP_PASS)
    headers = {
        'Content-Type': 'image/jpeg',
        'Content-Disposition': f'attachment; filename="{keyword.replace(" ", "-")}.jpg"'
    }
    
    wp_response = requests.post(WP_URL_MEDIA, headers=headers, auth=auth, data=img_data)
    
    if wp_response.status_code == 201:
        media_id = wp_response.json()['id']
        print(f"✅ Gambar berhasil diupload ke WP (Media ID: {media_id})")
        return media_id
    else:
        print("❌ Gagal upload gambar ke WP.")
        return None

# ==========================================
# UPDATE FUNGSI PUSH KE WORDPRESS
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
    
    # Jika ada gambar, kaitkan ke artikel
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
        
        # Ekstrak keyword unik untuk tiap gambar (bisa pakai fokus keyword dari AI)
        search_keyword = article_data.get('focus_keyword', topic)
        media_id = get_and_upload_image(search_keyword)
        
        print(f"🚀 Push draf {cat_name} ke WordPress...")
        push_to_wordpress(article_data, cat_id, media_id)
        print("-" * 30)
        
    print("🎉 Pipeline Selesai!")
