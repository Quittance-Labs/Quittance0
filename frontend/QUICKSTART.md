# 🚀 Hızlı UI Preview (Backend'siz)

UI'ı hemen görmek için mock data ile çalıştırın!

## 1️⃣ Dependencies Yükleyin

\`\`\`bash
cd frontend
npm install
\`\`\`

## 2️⃣ Environment Dosyası Oluşturun

\`\`\`bash
cp env.example.txt .env.local
\`\`\`

`.env.local` içeriği (mock mode için):

\`\`\`env
NEXT_PUBLIC_API_URL=http://localhost:3001/api
NEXT_PUBLIC_STELLAR_NETWORK=TESTNET
NEXT_PUBLIC_USE_MOCK=true
NEXT_PUBLIC_APP_URL=http://localhost:3000
\`\`\`

## 3️⃣ Çalıştırın

\`\`\`bash
npm run dev
\`\`\`

## 4️⃣ Tarayıcıda Açın

👉 http://localhost:3000

## 🎨 Ne Göreceksiniz?

✅ **Ana Sayfa** - Fatura oluşturma formu  
✅ **Dashboard** - Mock fatura listesi (4 örnek fatura)  
✅ **Fatura Detay** - QR kod, ödeme bilgileri  
✅ **Ödeme Sayfası** - Kullanıcı görünümü  

## 📊 Mock Data

Sistem otomatik olarak 4 örnek fatura gösterir:
- ✅ 1 ödendi (PAID)
- ⏳ 2 beklemede (PENDING)
- ❌ 1 süresi doldu (EXPIRED)

Yeni fatura oluşturabilirsiniz, hepsi mock data olarak saklanır.

## 🔄 Gerçek Backend'e Geçiş

Backend'i ayarladıktan sonra `.env.local` dosyasında:

\`\`\`env
NEXT_PUBLIC_USE_MOCK=false
\`\`\`

yapın ve gerçek API'ı kullanın! 🚀

