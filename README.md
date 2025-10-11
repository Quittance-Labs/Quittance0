# 🚀 Stellink

**Stellar blockchain tabanlı otomatik fatura oluşturma ve ödeme doğrulama sistemi**

Kullanıcılar tek tıkla on-chain fatura oluşturabilir, karşı taraf link veya QR kod ile ödeme yapabilir ve sistem ödemeleri memo ve tutar kontrolüyle otomatik doğrular.

---

## ✨ Özellikler

- ⚡ **Tek Tıkla Fatura**: 3 saniyede fatura oluşturma
- 🔗 **Paylaşılabilir Link & QR Kod**: Kolay ödeme deneyimi
- ✅ **Otomatik Doğrulama**: Memo tabanlı akıllı eşleştirme
- 💰 **Multi-Asset Desteği**: XLM, USDC ve diğer Stellar tokenları
- 🔄 **Gerçek Zamanlı İzleme**: Horizon API ile anlık ödeme takibi
- 🔐 **Güvenli**: Blockchain tabanlı şeffaf işlemler
- 📊 **Dashboard**: Tüm faturalarınızı tek yerden yönetin

---

## 🏗️ Teknoloji Stack'i

### Backend
- **Node.js** + **Express** - REST API
- **TypeScript** - Type safety
- **PostgreSQL** - Veritabanı
- **Stellar SDK** - Blockchain entegrasyonu
- **Bull + Redis** - Ödeme takibi için queue sistemi

### Frontend
- **Next.js 14** - React framework (App Router)
- **TypeScript** - Type safety
- **Tailwind CSS** - Modern UI
- **Stellar SDK** - Cüzdan entegrasyonu
- **Freighter API** - Stellar cüzdan bağlantısı
- **QRCode.react** - QR kod oluşturma
- **Sonner** - Toast bildirimleri

### Blockchain
- **Stellar Network** - Testnet / Public
- **Horizon API** - Blockchain veri erişimi
- **Freighter Wallet** - Kullanıcı cüzdanı

---

## 📋 Gereksinimler

- Node.js 18+ 
- PostgreSQL 14+
- Redis 6+ (opsiyonel, payment monitoring için)
- Stellar Testnet/Public hesabı
- Freighter Wallet (kullanıcılar için)

---

## 🚀 Kurulum

### 1. Projeyi Klonlayın

\`\`\`bash
git clone <repository-url>
cd one-click-crypto-invoice
\`\`\`

### 2. Backend Kurulumu

\`\`\`bash
cd backend
npm install
\`\`\`

**Environment variables** oluşturun:

\`\`\`bash
cp env.example.txt .env
\`\`\`

`.env` dosyasını düzenleyin:

\`\`\`env
PORT=3001
DATABASE_URL=postgresql://user:password@localhost:5432/stellar_invoices

# Stellar Configuration
STELLAR_NETWORK=TESTNET
STELLAR_HORIZON_URL=https://horizon-testnet.stellar.org
SELLER_PUBLIC_KEY=GXXXXX... # Sizin public key'iniz
SELLER_SECRET_KEY=SXXXXX... # Sizin secret key'iniz

# Redis (opsiyonel)
REDIS_HOST=localhost
REDIS_PORT=6379

FRONTEND_URL=http://localhost:3000
\`\`\`

**Stellar Test Hesabı Oluşturma:**

1. [Stellar Laboratory](https://laboratory.stellar.org/#account-creator?network=test) adresine gidin
2. "Generate keypair" butonuna tıklayın
3. Public ve Secret key'leri kopyalayın
4. "Fund account" ile hesabınıza test XLM yükleyin
5. Key'leri `.env` dosyasına yapıştırın

### 3. Veritabanı Kurulumu

PostgreSQL veritabanı oluşturun:

\`\`\`bash
createdb stellar_invoices
\`\`\`

Migration'ları çalıştırın:

\`\`\`bash
cd backend
npm run db:migrate
\`\`\`

### 4. Frontend Kurulumu

\`\`\`bash
cd ../frontend
npm install
\`\`\`

**Environment variables** oluşturun:

\`\`\`bash
cp env.example.txt .env.local
\`\`\`

`.env.local` dosyasını düzenleyin:

\`\`\`env
NEXT_PUBLIC_API_URL=http://localhost:3001/api
NEXT_PUBLIC_STELLAR_NETWORK=TESTNET
NEXT_PUBLIC_HORIZON_URL=https://horizon-testnet.stellar.org
NEXT_PUBLIC_APP_URL=http://localhost:3000
\`\`\`

### 5. Redis Kurulumu (Opsiyonel)

Redis varsa payment monitoring otomatik çalışır:

\`\`\`bash
# macOS
brew install redis
brew services start redis

# Ubuntu
sudo apt install redis-server
sudo systemctl start redis
\`\`\`

---

## 🎮 Çalıştırma

### Development Mode

**Terminal 1 - Backend:**

\`\`\`bash
cd backend
npm run dev
\`\`\`

**Terminal 2 - Frontend:**

\`\`\`bash
cd frontend
npm run dev
\`\`\`

Uygulamaya erişim:
- Frontend: http://localhost:3000
- Backend API: http://localhost:3001/api
- Health Check: http://localhost:3001/api/health

---

## 📖 Kullanım

### 1. Fatura Oluşturma

1. Ana sayfada fatura formunu doldurun:
   - **Tutar**: Örn: 100 XLM
   - **Açıklama**: "Web geliştirme hizmeti"
   - **Müşteri bilgileri** (opsiyonel)
   - **Son kullanma tarihi**: Varsayılan 7 gün

2. "Create Invoice" butonuna tıklayın

3. Fatura oluşturuldu! Şunları alacaksınız:
   - ✅ Benzersiz fatura ID
   - ✅ Ödeme linki
   - ✅ QR kod
   - ✅ Benzersiz memo

### 2. Ödeme Yapma

**Seçenek A: Freighter Wallet ile**

1. Ödeme sayfasını açın (link veya QR)
2. "Pay with Freighter" butonuna tıklayın
3. Freighter popup'ında işlemi onaylayın
4. Otomatik doğrulama 3-5 saniye içinde tamamlanır

**Seçenek B: Manuel Transfer**

1. Kendi Stellar cüzdanınızdan:
   - **Destination**: Faturadaki address
   - **Amount**: Tam tutar
   - **Memo**: Faturadaki memo (ÖNEMLİ!)
   - **Asset**: XLM veya belirtilen token

2. İşlemi gönderin
3. Sistem otomatik algılar ve doğrular

### 3. Dashboard

- `/dashboard` sayfasından tüm faturalarınızı görüntüleyin
- Durum filtreleri: Pending, Paid, Expired
- İstatistikler: Toplam gelir, ödenen fatura sayısı

---

## 🔧 API Endpoints

### Invoices

\`\`\`
POST   /api/invoices              - Yeni fatura oluştur
GET    /api/invoices              - Faturaları listele
GET    /api/invoices/:id          - Fatura detayı
GET    /api/invoices/:id/payment-info  - Ödeme bilgileri
POST   /api/invoices/:id/verify   - Manuel doğrulama
POST   /api/invoices/:id/cancel   - Fatura iptal
GET    /api/invoices/stats        - İstatistikler
\`\`\`

### Stellar

\`\`\`
GET    /api/stellar/account       - Hesap bilgisi
GET    /api/stellar/payments      - Son ödemeler
GET    /api/stellar/transaction/:hash  - Transaction detayı
POST   /api/stellar/verify-payment     - Ödeme doğrulama
\`\`\`

---

## 📊 Veritabanı Şeması

### Tablolar

- **users**: Kullanıcı bilgileri
- **invoices**: Fatura kayıtları
- **transactions**: Blockchain transaction'ları
- **payment_events**: Ödeme event log'ları

Detaylı şema için: `db/schema.sql`

---

## 🔒 Güvenlik

- ✅ Memo tabanlı benzersiz eşleştirme
- ✅ Tutar doğrulaması (0.0000001 XLM hassasiyetle)
- ✅ Asset tip kontrolü
- ✅ Zaman aşımı kontrolü
- ✅ Double-spending koruması (unique tx_hash)
- ✅ SQL injection koruması (parameterized queries)

---

## 🧪 Test

### Testnet'te Test Etme

1. Stellar Laboratory'den test XLM alın:
   - https://laboratory.stellar.org/#account-creator?network=test

2. Freighter wallet'a test hesabını import edin

3. Localhost'ta fatura oluşturun ve test ödemesi yapın

---

## 🌐 Production'a Alma

### Backend

1. Environment variables'ı güncelleyin:
   \`\`\`env
   STELLAR_NETWORK=PUBLIC
   STELLAR_HORIZON_URL=https://horizon.stellar.org
   NODE_ENV=production
   \`\`\`

2. Gerçek Stellar hesabınızı kullanın (Testnet yerine)

3. SSL sertifikası ekleyin (Let's Encrypt)

4. PM2 veya Docker ile deploy edin

### Frontend

1. Environment variables:
   \`\`\`env
   NEXT_PUBLIC_STELLAR_NETWORK=PUBLIC
   NEXT_PUBLIC_API_URL=https://api.yourdomain.com/api
   \`\`\`

2. Vercel, Netlify veya kendi sunucunuza deploy edin

---

## 🤝 Katkıda Bulunma

1. Fork yapın
2. Feature branch oluşturun (`git checkout -b feature/amazing`)
3. Commit yapın (`git commit -m 'Add amazing feature'`)
4. Push edin (`git push origin feature/amazing`)
5. Pull Request açın

---

## 📝 Lisans

MIT License - Detaylar için `LICENSE` dosyasına bakın

---

## 🙋 Destek

Sorularınız için:
- GitHub Issues açın
- Discord: [Link eklenecek]
- Email: support@example.com

---

## 🎯 Roadmap

- [ ] Multi-currency fiyat hesaplama
- [ ] Email bildirimleri
- [ ] Webhook desteği
- [ ] Fatura şablonları
- [ ] PDF export
- [ ] Çoklu hesap desteği
- [ ] Mobile app (React Native)
- [ ] Recurring invoices (abonelik)

---

## 👨‍💻 Geliştirici

**Stellink** - Stellar blockchain üzerinde açık kaynak proje

⭐ Projeyi beğendiyseniz GitHub'da star vermeyi unutmayın!

---

## 📚 Kaynaklar

- [Stellar Documentation](https://developers.stellar.org)
- [Horizon API Reference](https://developers.stellar.org/api)
- [Freighter Wallet](https://www.freighter.app/)
- [Next.js Documentation](https://nextjs.org/docs)

---

**Built with ❤️ on Stellar**

