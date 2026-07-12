# 🚀 MVP Hızlı Başlangıç (Database'siz)

Backend + Frontend birlikte çalıştırıp QR kod üretimi ve ödeme akışını test edin!

## ⚡ 5 Dakikada Çalıştır

### 1️⃣ Backend Setup (2 dakika)

```bash
cd backend
npm install
```

Environment dosyası oluştur:
```bash
cp .env.mvp .env
```

**`.env` dosyasını düzenleyin:**

İsterseniz kendi Stellar test hesabınızı kullanın:
👉 https://laboratory.stellar.org/#account-creator?network=test

Ya da örnek key ile devam edin (sadece test için):
```env
PORT=3001
STELLAR_NETWORK=TESTNET
SELLER_PUBLIC_KEY=GABC123EXAMPLE456STELLAR
FRONTEND_URL=http://localhost:3000
```

### 2️⃣ Frontend Setup (1 dakika)

```bash
cd frontend
npm install
```

Environment dosyası:
```bash
cp env.example.txt .env.local
```

**`.env.local` içeriği:**
```env
NEXT_PUBLIC_API_URL=http://localhost:3001/api
NEXT_PUBLIC_STELLAR_NETWORK=TESTNET
NEXT_PUBLIC_USE_MOCK=false
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### 3️⃣ Çalıştır (1 dakika)

**Terminal 1 - Backend:**
```bash
cd backend
npm run dev:mvp
```

Çıktı:
```
🚀 Quittance Backend (MVP Mode)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ Server running on port 3001
📍 API: http://localhost:3001/api
💾 Storage: In-Memory (No Database)
```

**Terminal 2 - Frontend:**
```bash
cd frontend
npm run dev
```

### 4️⃣ Test Et! 🎉

Tarayıcıda aç: **http://localhost:3000**

---

## 🎯 Test Senaryosu

### 1. Fatura Oluştur
- Ana sayfada formu doldur:
  - Amount: **10**
  - Asset: **XLM**
  - Description: "Test faturası"
- "Create Invoice" tıkla
- ✅ QR kod ve ödeme linki oluşturuldu!

### 2. Fatura Detaylarını Gör
- Dashboard'a git: http://localhost:3000/dashboard
- Oluşturduğun faturayı gör
- Faturaya tıkla → Detay sayfası
- QR kodu ve memo'yu gör

### 3. Ödeme Sayfasını Test Et
- "Copy Link" ile ödeme linkini kopyala
- Yeni sekmede aç
- Ödeme sayfası açılır:
  - ✅ QR kod görünür
  - ✅ Manuel ödeme bilgileri
  - ✅ Memo ve amount doğru

### 4. Ödemeyi Simüle Et (MVP Test)

Backend'e curl ile test isteği:
```bash
# Invoice ID'nizi buraya yazın
INVOICE_ID="your-invoice-id-here"

curl -X POST http://localhost:3001/api/invoices/$INVOICE_ID/simulate-payment
```

Ya da Postman/Insomnia'da:
```
POST http://localhost:3001/api/invoices/{invoice-id}/simulate-payment
```

Yanıt:
```json
{
  "success": true,
  "data": {
    "id": "...",
    "status": "PAID",
    "paymentTxHash": "MOCK_TX_...",
    "paidAt": "2024-01-15T..."
  },
  "message": "✅ Payment simulated successfully!"
}
```

### 5. Dashboard'da Kontrol Et
- Dashboard'u yenile
- Fatura artık **PAID** durumunda! ✅
- İstatistikler güncellendi

---

## 🎨 Ne Test Edebilirsiniz?

### ✅ Çalışan Özellikler
- ✅ Fatura oluşturma
- ✅ QR kod üretimi (gerçek QR kodlar!)
- ✅ Ödeme linki paylaşımı
- ✅ Dashboard ve filtreleme
- ✅ İstatistikler
- ✅ Fatura detayları
- ✅ Ödeme simülasyonu
- ✅ Durum güncellemeleri

### 🔄 Gerçek Ödeme Testi (Opsiyonel)

Freighter wallet ile gerçek testnet ödemesi:

1. Freighter wallet kur (Chrome/Firefox extension)
2. Test hesabı oluştur: https://laboratory.stellar.org/#account-creator?network=test
3. Test XLM al (10,000 XLM bedava)
4. Ödeme sayfasında "Pay with Freighter" tıkla
5. Transaction'ı onayla
6. ⚠️ Backend Horizon API dinlemediği için otomatik doğrulama YOK
7. Manuel doğrulama için `/simulate-payment` kullan

---

## 📊 API Endpoints

### Fatura İşlemleri
```
POST   /api/invoices                    - Fatura oluştur
GET    /api/invoices                    - Tüm faturaları listele
GET    /api/invoices/:id                - Fatura detayı
GET    /api/invoices/:id/payment-info   - QR kod ve ödeme bilgisi
POST   /api/invoices/:id/simulate-payment  - Ödeme simüle et (MVP test)
POST   /api/invoices/:id/cancel         - Fatura iptal
GET    /api/invoices/stats              - İstatistikler
```

### Sistem
```
GET    /api/health                      - Health check
GET    /api/stellar/account             - Hesap bilgisi (mock)
```

---

## 🧪 Test Komutları

### Backend Health Check
```bash
curl http://localhost:3001/api/health
```

### Fatura Oluştur
```bash
curl -X POST http://localhost:3001/api/invoices \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 50,
    "description": "Test invoice",
    "customerName": "Test User"
  }'
```

### Faturaları Listele
```bash
curl http://localhost:3001/api/invoices
```

### İstatistikler
```bash
curl http://localhost:3001/api/invoices/stats
```

---

## 🔍 Önemli Notlar

### MVP Özellikleri
- ✅ **In-Memory Storage**: Database yok, restart'ta data kaybolur
- ✅ **Gerçek QR Kodlar**: Stellar SEP-0007 formatında
- ✅ **Backend Validation**: Zod ile data validation
- ✅ **Frontend/Backend Integration**: Gerçek API çağrıları
- ⚠️ **Payment Monitoring YOK**: Horizon API dinlemesi yok
- ⚠️ **Otomatik Doğrulama YOK**: Manuel simülasyon gerekli

### Production'a Taşıma
MVP'yi beğendiniz mi? Full version için:
1. PostgreSQL ekle (`db/schema.sql` ile migrate)
2. `server-mvp.ts` yerine `server.ts` kullan
3. Redis ekle (payment monitoring için)
4. Horizon API streaming ekle
5. Webhook bildirimleri ekle

---

## 🎉 Başarılı Kurulum Kontrolü

- [ ] Backend başladı (port 3001)
- [ ] Frontend başladı (port 3000)
- [ ] Ana sayfada form görünüyor
- [ ] Fatura oluşturabiliyorsunuz
- [ ] QR kod görünüyor
- [ ] Dashboard'da faturalar listeleniyor
- [ ] Ödeme simülasyonu çalışıyor
- [ ] İstatistikler doğru

Hepsi ✅ ise **MVP hazır!** 🚀

---

## 🆘 Sorun Giderme

### Backend başlamıyor
```bash
# Dependencies eksik mi?
cd backend && npm install

# Port meşgul mü?
lsof -ti:3001 | xargs kill -9
```

### Frontend API'ye bağlanamıyor
```bash
# .env.local doğru mu?
cat frontend/.env.local

# NEXT_PUBLIC_USE_MOCK=false olmalı!
# Backend çalışıyor mu?
curl http://localhost:3001/api/health
```

### QR kod görünmüyor
- Browser console'u kontrol edin (F12)
- `qrcode` package yüklü mü? `npm install qrcode.react`

---

## 💡 Sonraki Adımlar

1. ✅ **MVP'yi test edin**
2. 📊 **Dashboard'u keşfedin**
3. 🎨 **UI'ı özelleştirin**
4. 🔗 **Gerçek Stellar ödemesi yapın**
5. 🚀 **Full version'a geçin** (database + auto monitoring)

---

**Haydi başlayalım!** 🎯

```bash
# Backend
cd backend && npm run dev:mvp

# Frontend (yeni terminal)
cd frontend && npm run dev
```

**2 dakika sonra hazır!** ⚡

