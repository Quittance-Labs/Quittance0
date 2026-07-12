# 🔍 Freighter Bağlantı Sorunları - Çözüm Kılavuzu

## ✅ 1. Freighter Kurulu mu?

### Kontrol Et:
1. Chrome/Brave/Edge extensions sayfasına git: `chrome://extensions/`
2. "Freighter" araması yap
3. **Görmüyorsan:** [freighter.app](https://www.freighter.app/) adresinden indir

### Kurulum Sonrası:
- Extension sağ üste pin'lenmeli (iğne simgesi)
- Freighter'da en az 1 hesap oluşturulmuş olmalı
- Test hesabın: `GDZKIKB5KLJCKRXDVLKB4D33GXMEIY6ZAQ6IFUA5DGB5SRCUHDLXN256`

---

## ✅ 2. Frontend Yeniden Başlat

Frontend değişikliklerini alması için yeniden başlat:

```bash
# Port 3000'i temizle
lsof -ti:3000 | xargs kill -9

# Frontend'i başlat
cd /Users/cemayyildiz/quittance/frontend
npm run dev
```

---

## ✅ 3. Tarayıcı Konsolu Kontrol Et

Tarayıcıda `F12` bas → **Console** sekmesine bak:

### ❌ Şu hatayı görürsen:
```
Freighter is not available
```
**Çözüm:** Freighter extension'ı yükle/aktif et

### ❌ Şu hatayı görürsen:
```
User rejected request
```
**Çözüm:** Freighter popup'ında "Approve" butonuna bas

### ❌ Popup açılmıyor:
**Çözüm:** Tarayıcı popup blocker'ı devre dışı bırak

---

## ✅ 4. Manuel Test

Tarayıcı konsolunda şunu çalıştır:

```javascript
// Freighter var mı?
console.log('Freighter:', window.freighter)

// Bağlan
window.freighter.isConnected().then(console.log)
```

**Eğer `undefined` döndürürse:** Freighter kurulmamış demektir!

---

## ✅ 5. Adım Adım Test

1. **http://localhost:3000** aç
2. **F12** → Console aç
3. **Connect Wallet** butonuna bas
4. **Freighter popup açıldı mı?**
   - ✅ EVET → "Approve" bas
   - ❌ HAYIR → Aşağıya bak

### Popup Açılmazsa:

#### A) Tarayıcı Popup Blocker:
- Chrome: Adres çubuğunun sağındaki 🚫 simgesine tıkla
- "Always allow popups from localhost" seç

#### B) Extension Sayfasında Test:
1. `chrome://extensions/` → Freighter'ı bul
2. "Details" butonuna bas
3. "Extension options" tıkla
4. Freighter arayüzü açıldı mı kontrol et

#### C) Extension Yeniden Yükle:
1. `chrome://extensions/` → Freighter'ı bul
2. Toggle'ı OFF → ON yap
3. Sayfayı yenile (F5)
4. Tekrar dene

---

## 🔧 Son Çare: Temiz Kurulum

```bash
# 1. Freighter'ı kaldır (chrome://extensions/)
# 2. Tarayıcıyı kapat/aç
# 3. Freighter'ı yeniden yükle
# 4. Hesabı import et (12-word phrase)
# 5. Test et
```

---

## 🎯 Doğru Çalışırsa:

1. **Connect Wallet** butonuna bas
2. **Freighter popup açılır** (yeni pencere/tab)
3. **"Approve"** butonuna bas
4. **Cüzdan bağlanır!** ✅
5. **Fatura oluşturma formu görünür** ✅

---

## 🆘 Hala Çalışmazsa:

Tarayıcı konsolundaki HATAYI kopyala ve paylaş:
- `F12` → Console sekmesi
- Kırmızı hatalar var mı?
- Screenshot al

