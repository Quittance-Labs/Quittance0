# 🚀 Dinamik Cüzdan Sistemi

## ✅ YENİ AKILŞ:

### 1️⃣ Fatura Oluşturan (Satıcı):
```
1. Ana sayfaya gel
2. Cüzdanı bağla (Freighter) → GDZKIKB5...
3. Fatura oluştur (tutar, açıklama vs.)
4. ✅ Fatura GDZKIKB5'e ödeme alacak şekilde kaydedilir!
```

### 2️⃣ Ödeme Yapan (Alıcı):
```
1. Ödeme linkine tıkla → /pay/{invoiceId}
2. Kendi cüzdanını bağla → GXXXXX...
3. "Pay with Freighter" butonuna bas
4. ✅ GXXXXX'ten GDZKIKB5'e ödeme gider!
```

---

## 🔄 Önceki vs Yeni Sistem:

### ❌ ESKİ Sistem (Yanlış):
- Backend `.env` dosyasında sabit `SELLER_PUBLIC_KEY` vardı
- Tüm faturalar aynı hesaba gidiyordu
- Tek satıcı için tasarlanmıştı

### ✅ YENİ Sistem (Doğru):
- Her kullanıcı kendi cüzdanını bağlar
- Fatura oluşturulurken **bağlı cüzdanın public key'i** kaydedilir
- **Multi-seller sistem**: Herkes kendi faturaları için ödeme alabilir!

---

## 🛠️ Teknik Değişiklikler:

### Backend:
1. ✅ `SELLER_PUBLIC_KEY` env variable kaldırıldı
2. ✅ `CreateInvoiceInput` artık `sellerPublicKey` parametresi alıyor (ZORUNLU)
3. ✅ Her fatura kendi seller public key'ini saklıyor
4. ✅ Ödeme o public key'e yapılıyor

### Frontend:
1. ✅ Ana sayfa: Cüzdan bağlanmadan fatura oluşturulamaz
2. ✅ `InvoiceForm` artık `userWallet` prop'u alıyor
3. ✅ Fatura oluştururken bağlı cüzdanın public key'i backend'e gönderiliyor
4. ✅ Her kullanıcı sadece kendi faturalarını görür (özellik eklenebilir)

---

## 🎯 Kullanım Senaryoları:

### Senaryo 1: Freelancer (Alice)
```
Alice → Cüzdan: GALICE123...
Alice → Fatura oluştur: 500 XLM
Alice → QR kod paylaş
→ Müşteri ödeme yapar → GALICE123'e 500 XLM gelir ✅
```

### Senaryo 2: E-ticaret (Bob)
```
Bob → Cüzdan: GBOB456...
Bob → 10 adet fatura oluştur
→ Her fatura GBOB456'ya ödeme alır ✅
```

### Senaryo 3: Birden Fazla Kullanıcı
```
Alice → Cüzdan: GALICE123... → Faturaları GALICE'e gelir
Bob → Cüzdan: GBOB456... → Faturaları GBOB'a gelir
Carol → Cüzdan: GCAROL789... → Faturaları GCAROL'a gelir
→ Hepsi aynı uygulamayı kullanır! ✅
```

---

## 🚀 Sonraki Özellikler (İsteğe Bağlı):

1. **Kullanıcı Hesapları**: Her kullanıcı login olup sadece kendi faturalarını görebilir
2. **Multi-Wallet**: Bir kullanıcı birden fazla cüzdan ekleyebilir
3. **Team Accounts**: Ekip üyeleri ortak fatura oluşturabilir
4. **Payment Forwarding**: Ödeme geldikten sonra otomatik başka hesaba yönlendirebilir
5. **Escrow**: Ödemeyi emanette tut, şartlar sağlanınca gönder

---

## ⚠️ Önemli Notlar:

1. **Testnet kullanın!** Gerçek para yerine test XLM ile test edin
2. **Cüzdan güvenliği**: Freighter private key'i hiç kimseyle paylaşmayın
3. **Production'da**: Mainnet'e geçerken Horizon URL değiştirin
4. **In-Memory Storage**: Backend restart olunca faturalar kaybolur (production'da database gerekli)

---

## 🎉 Sonuç:

Artık gerçek bir **multi-seller invoice platformu** var! 🚀
Her kullanıcı kendi cüzdanını bağlayıp fatura oluşturabilir.

