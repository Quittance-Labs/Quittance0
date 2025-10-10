# 🚀 Hızlı Başlangıç Rehberi

Bu rehber, projeyi 15 dakikada çalışır hale getirmeniz için adım adım talimatlar içerir.

---

## ⚡ Hızlı Kurulum (TL;DR)

\`\`\`bash
# 1. Dependencies
cd backend && npm install
cd ../frontend && npm install

# 2. Database
createdb stellar_invoices
cd backend && npm run db:migrate

# 3. Stellar hesap oluştur ve .env dosyalarını ayarla

# 4. Çalıştır
# Terminal 1
cd backend && npm run dev

# Terminal 2
cd frontend && npm run dev
\`\`\`

---

## 📝 Detaylı Adımlar

### 1. Stellar Test Hesabı Oluşturma (5 dakika)

1. **Stellar Laboratory'ye gidin:**
   👉 https://laboratory.stellar.org/#account-creator?network=test

2. **Keypair oluşturun:**
   - "Generate keypair" butonuna tıklayın
   - **Public Key** (G ile başlar): Kopyalayın
   - **Secret Key** (S ile başlar): Kopyalayın ve GÜVENLİ SAKLAYIN!

3. **Test XLM yükleyin:**
   - "Get test network lumens" butonuna tıklayın
   - Hesabınıza 10,000 test XLM yüklenecek

4. **Doğrulama:**
   - Stellar Expert'te hesabınızı kontrol edin:
   - https://stellar.expert/explorer/testnet/account/[YOUR_PUBLIC_KEY]

---

### 2. Backend Environment Setup (2 dakika)

\`\`\`bash
cd backend
cp env.example.txt .env
\`\`\`

`.env` dosyasını düzenleyin:

\`\`\`env
PORT=3001
NODE_ENV=development

# Database (PostgreSQL kurulu olmalı)
DATABASE_URL=postgresql://localhost:5432/stellar_invoices

# Stellar Keys (Yukarıda oluşturduğunuz)
STELLAR_NETWORK=TESTNET
STELLAR_HORIZON_URL=https://horizon-testnet.stellar.org
SELLER_PUBLIC_KEY=GXXXXXXXXXXXXX  # Buraya kendi public key'inizi yazın
SELLER_SECRET_KEY=SXXXXXXXXXXXXX  # Buraya kendi secret key'inizi yazın

# Redis (Opsiyonel - yoksa backend yine çalışır)
REDIS_HOST=localhost
REDIS_PORT=6379

FRONTEND_URL=http://localhost:3000
\`\`\`

---

### 3. Frontend Environment Setup (1 dakika)

\`\`\`bash
cd frontend
cp env.example.txt .env.local
\`\`\`

`.env.local` dosyasını düzenleyin:

\`\`\`env
NEXT_PUBLIC_API_URL=http://localhost:3001/api
NEXT_PUBLIC_STELLAR_NETWORK=TESTNET
NEXT_PUBLIC_HORIZON_URL=https://horizon-testnet.stellar.org
NEXT_PUBLIC_APP_URL=http://localhost:3000
\`\`\`

---

### 4. Database Kurulumu (3 dakika)

**PostgreSQL kurulu değilse:**

\`\`\`bash
# macOS
brew install postgresql@14
brew services start postgresql@14

# Ubuntu
sudo apt install postgresql postgresql-contrib
sudo systemctl start postgresql
\`\`\`

**Database oluştur ve migrate et:**

\`\`\`bash
# Database oluştur
createdb stellar_invoices

# Veya psql ile:
psql postgres
CREATE DATABASE stellar_invoices;
\\q

# Migration çalıştır
cd backend
npm run db:migrate
\`\`\`

Başarılı çıktı:
\`\`\`
✅ Database migration completed successfully!
📋 Created tables:
  - users
  - invoices
  - transactions
  - payment_events
\`\`\`

---

### 5. Redis Kurulumu (Opsiyonel - 2 dakika)

Redis olmadan da çalışır, ama real-time payment monitoring için önerilir.

\`\`\`bash
# macOS
brew install redis
brew services start redis

# Ubuntu
sudo apt install redis-server
sudo systemctl start redis

# Test et
redis-cli ping
# Çıktı: PONG
\`\`\`

---

### 6. Dependencies Yükleme (3 dakika)

\`\`\`bash
# Backend
cd backend
npm install

# Frontend
cd ../frontend
npm install
\`\`\`

---

### 7. Çalıştırma (1 dakika)

**Terminal 1 - Backend:**

\`\`\`bash
cd backend
npm run dev
\`\`\`

Başarılı çıktı:
\`\`\`
✅ Database connected
✅ Stellar configured for TESTNET
📍 Horizon URL: https://horizon-testnet.stellar.org
💰 Seller Account: GXXXXX...
🚀 Starting payment monitor...
✅ Server running on port 3001
\`\`\`

**Terminal 2 - Frontend:**

\`\`\`bash
cd frontend
npm run dev
\`\`\`

Başarılı çıktı:
\`\`\`
✓ Ready in 2.1s
○ Local: http://localhost:3000
\`\`\`

---

## 🎉 Test Etme

### 1. Freighter Wallet Kurulumu

1. Chrome/Firefox extension yükleyin:
   👉 https://www.freighter.app/

2. Wallet oluşturun veya import edin:
   - "Import wallet" seçin
   - Stellar Laboratory'den aldığınız **secret key**'i yapıştırın
   - Şifre belirleyin

3. Network'ü TESTNET'e çevirin:
   - Settings → Network → Testnet

### 2. İlk Faturanızı Oluşturun

1. http://localhost:3000 açın
2. Fatura formu:
   - **Amount**: 10
   - **Asset**: XLM
   - **Description**: "Test faturası"
3. "Create Invoice" tıklayın
4. QR kod ve ödeme linki oluşturuldu! 🎉

### 3. Test Ödemesi Yapın

**Yöntem 1: Freighter ile (Önerilen)**

1. "Pay with Freighter" butonuna tıklayın
2. Freighter popup açılacak
3. Transaction detaylarını kontrol edin:
   - Destination: Backend'deki hesap
   - Amount: 10 XLM
   - Memo: INV-XXX-XXX
4. "Approve" tıklayın
5. 3-5 saniye içinde otomatik doğrulama ✅

**Yöntem 2: Manuel (Stellar Laboratory)**

1. https://laboratory.stellar.org/#txbuilder?network=test
2. Source account: Sizin public key
3. Operation: Payment
   - Destination: Faturadaki address
   - Amount: 10
   - Asset: Native (XLM)
4. Memo: Text → Faturadaki memo
5. Sign & Submit

### 4. Dashboard Kontrol

1. http://localhost:3000/dashboard
2. Tüm faturalarınızı görün
3. Stats kartları:
   - Total invoices
   - Paid
   - Pending
   - Revenue

---

## 🐛 Sorun Giderme

### Backend başlamıyor

**Hata: "Database connection failed"**
\`\`\`bash
# PostgreSQL çalışıyor mu?
pg_isready

# Database var mı?
psql -l | grep stellar_invoices

# Migration çalıştırıldı mı?
cd backend && npm run db:migrate
\`\`\`

**Hata: "Invalid SELLER_PUBLIC_KEY"**
- `.env` dosyasında public key'in G ile başladığından emin olun
- Key'de boşluk/satır sonu karakteri olmamalı

**Hata: "Redis connection failed"**
- Redis kurulu değilse sorun değil, yine çalışır
- Kurmak isterseniz: `brew install redis` veya `apt install redis`

### Frontend başlamıyor

**Hata: "Module not found"**
\`\`\`bash
cd frontend
rm -rf node_modules package-lock.json
npm install
\`\`\`

**Hata: "API connection failed"**
- Backend çalışıyor mu? http://localhost:3001/api/health
- `.env.local` doğru mu?

### Ödeme algılanmıyor

1. **Backend console'u kontrol edin:**
   - "Payment received" mesajı var mı?
   - Memo eşleşiyor mu?

2. **Stellar Explorer'da kontrol edin:**
   - Transaction gönderildi mi?
   - Memo doğru mu?
   - Tutar tam olarak eşleşiyor mu?

3. **Manuel verify:**
   \`\`\`bash
   # Transaction hash ile
   curl -X POST http://localhost:3001/api/invoices/[INVOICE_ID]/verify \\
     -H "Content-Type: application/json" \\
     -d '{"txHash": "YOUR_TX_HASH"}'
   \`\`\`

---

## 📞 Yardım

Hala sorun mu yaşıyorsunuz?

1. **Logları kontrol edin:**
   - Backend: Terminal çıktısı
   - Frontend: Browser console (F12)

2. **Environment variables tekrar kontrol edin:**
   - Backend: `backend/.env`
   - Frontend: `frontend/.env.local`

3. **GitHub Issues açın:**
   - Hata mesajlarını ekleyin
   - Environment (OS, Node version)
   - Adım adım ne yaptığınızı açıklayın

---

## ✅ Checklist

Kurulum tamamlandı mı?

- [ ] PostgreSQL kurulu ve çalışıyor
- [ ] Stellar test hesabı oluşturuldu
- [ ] Backend .env dosyası ayarlandı
- [ ] Frontend .env.local dosyası ayarlandı
- [ ] Database migrate edildi
- [ ] Backend başlatıldı (port 3001)
- [ ] Frontend başlatıldı (port 3000)
- [ ] Freighter wallet kuruldu
- [ ] Test faturası oluşturuldu
- [ ] Test ödemesi yapıldı ve doğrulandı

Hepsi ✅ ise **tebrikler!** 🎉

---

**Keyifli kodlamalar! 🚀**

