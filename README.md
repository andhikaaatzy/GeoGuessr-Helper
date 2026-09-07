# 🌍 GeoGuessr AI Companion Pro

Meta Engine v4.0 dengan **Secure Proxy Architecture** — API key tersimpan aman di server.

## 🚀 Deploy ke Vercel (5 Menit)

### 1. Upload ke GitHub
Buat repository baru (boleh public sekarang, karena key TIDAK ada di kode), upload semua file.

### 2. Import ke Vercel
- Buka [vercel.com/new](https://vercel.com/new)
- Pilih repository GitHub kamu
- Framework: biarkan otomatis / Other

### 3. ⚠️ WAJIB: Set Environment Variables
Di halaman sebelum Deploy, klik **Environment Variables**, tambahkan:

| Name | Value |
|------|-------|
| `GOOGLE_API_KEY` | key Google AI Studio kamu |
| `XKIRO_API_KEY` | key Xkiro kamu |

Pilih environment: **Production + Preview + Development** → Add → Deploy.

### 4. Test
Buka URL Vercel kamu, upload screenshot, pilih model, analisis. ✅

## 💻 Test Lokal (Opsional)
Butuh Vercel CLI karena ada serverless function:
npm i -g vercel
vercel login
vercel link
vercel dev
Buka http://localhost:3000

## 🔒 Keamanan
- API key hanya ada di Environment Variables Vercel (terenkripsi)
- Rate limiter: 20 request/menit per IP
- Allowlist model (key tidak bisa dipakai untuk model lain)
- Validasi payload (hanya menerima gambar base64 valid)