# 💠 ARW Reborn — Member System

Sistem pendaftaran & manajemen member untuk komunitas **ARW Reborn** di Roblox.

## 🚀 Cara Deploy ke GitHub Pages

1. Upload semua file ini ke repository GitHub kamu
2. Buka **Settings** → **Pages**
3. Source: pilih branch `main`, folder `/ (root)`
4. Klik **Save** — link siap dalam ~1 menit!

## 📁 Struktur File

```
├── index.html          ← Aplikasi utama
├── manifest.json       ← PWA manifest
├── sw.js               ← Service Worker (offline support)
├── icon.svg            ← Icon vektor
├── icon-192.png        ← Icon 192×192
├── icon-512.png        ← Icon 512×512
└── apple-touch-icon.png← Icon untuk iOS
```

## 📱 Fitur

- ✅ Form pendaftaran member lengkap
- ✅ Rules + tombol setuju sebelum daftar
- ✅ List member publik (username, nama Roblox, domisili)
- ✅ Admin panel dengan password (data sensitif terlindungi)
- ✅ Kick member (butuh password admin)
- ✅ Firebase Firestore realtime
- ✅ Installable PWA — bisa ditambahkan ke layar HP
- ✅ Sound effects tiap interaksi
- ✅ Tema ungu gelap premium

## 🔐 Admin

Password default: `arwadmin2024`
Ganti di `index.html` → cari `ADMIN_PASSWORD`

---
*Terbang bareng, jatuh bareng, bangkit bareng. 🤍*
