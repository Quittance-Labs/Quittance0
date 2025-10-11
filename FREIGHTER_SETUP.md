# 🔐 Freighter Wallet Kurulum ve Sorun Giderme

## 📥 Freighter Kurulumu

### **Chrome için:**
1. 👉 https://chromewebstore.google.com/detail/freighter/bcacfldlkkdogcmkkibnjlakofdplcbk
2. "Add to Chrome" tıkla
3. "Add extension" onayla
4. ✅ Kuruldu!

### **Firefox için:**
1. 👉 https://addons.mozilla.org/en-US/firefox/addon/freighter/
2. "Add to Firefox" tıkla
3. "Add" onayla
4. ✅ Kuruldu!

### **Brave için:**
1. Chrome Web Store linkini kullan (yukarıdaki)
2. Brave, Chrome extension'larını destekler

---

## 🎯 İlk Kurulum

### **1. Extension'ı Aç**

Tarayıcı sağ üstte:
```
🧩 Extensions ikonu → Freighter
```

Ya da direkt:
```
chrome-extension://bcacfldlkkdogcmkkibnjlakofdplcbk/index.html
```

### **2. Yeni Cüzdan Oluştur**

```
"Create a new wallet" tıkla

→ Şifre oluştur (güçlü olmalı!)
→ Şifreyi tekrar gir
→ "Continue" tıkla

→ Secret Recovery Phrase gösterilir (12 kelime)
→ ⚠️ YEDEKLE! Kağıda yaz, güvenli sakla!
→ "I've saved my secret phrase" işaretle
→ "Continue" tıkla

→ Kelimeleri doğrula (sırayla seç)
→ "Continue" tıkla

✅ Cüzdan hazır!
```

### **3. Network → Testnet**

```
Settings ⚙️ (sol altta)
→ "Preferences"
→ "Network"
→ "Testnet" seç ✅
→ Geri dön
```

### **4. Test XLM Al**

Public key'i kopyala:
```
Ana ekranda → Address altında → Copy ikonu
```

Friendbot'tan XLM al:
```
https://laboratory.stellar.org/#account-creator?network=test
→ Public key'i yapıştır
→ "Get test network lumens" tıkla
→ ✅ 10,000 XLM!
```

---

## 🔧 Sorun Giderme

### **Problem 1: Extension Görünmüyor**

**Çözüm A: Pin Extension**
```
🧩 Extensions → Freighter'ın yanındaki 📌 ikonuna tıkla
→ Extension bar'a sabitlenir
```

**Çözüm B: Manage Extensions**
```
chrome://extensions (Chrome)
about:addons (Firefox)

→ Freighter'ı bul
→ "Enabled" olduğundan emin ol
→ "Allow in incognito" işaretle (opsiyonel)
```

**Çözüm C: Yeniden Yükle**
```
chrome://extensions
→ Freighter bul
→ "Remove" tıkla
→ Tekrar kur (yukarıdaki linklerden)
```

---

### **Problem 2: Popup Açılmıyor**

**Çözüm A: Popup Blocker**
```
Tarayıcı ayarları
→ Privacy & Security
→ Site Settings
→ Pop-ups and redirects
→ localhost:3000 için "Allow" ekle
```

**Çözüm B: Extension Permission**
```
chrome://extensions
→ Freighter
→ "Details"
→ "Site access": "On all sites" veya "On specific sites"
→ localhost:3000 ekle
```

**Çözüm C: Manuel Aç**
```
Extension ikonuna direkt tıkla (toolbar'dan)
→ Freighter açılır
→ "Approve" tıkla
```

---

### **Problem 3: "Not Connected" Hatası**

**Çözüm:**
```
1. Freighter'ı aç
2. Settings → Connected Sites
3. localhost:3000 var mı kontrol et
4. Yoksa: Sayfada "Connect Wallet" tekrar tıkla
5. Freighter'da "Approve" tıkla
```

---

### **Problem 4: "Account Not Found" Hatası**

**Çözüm: Test XLM Yükle**
```
1. Freighter'da public key kopyala
2. https://friendbot.stellar.org/?addr=YOUR_PUBLIC_KEY
3. Ya da: https://laboratory.stellar.org/#account-creator?network=test
4. "Get test network lumens" tıkla
5. ✅ Hesap aktif oldu!
```

---

### **Problem 5: Transaction Failed**

**Sebep 1: Yetersiz Bakiye**
```
Minimum: 1 XLM + fee
Çözüm: Test XLM al (yukarıdaki adımlar)
```

**Sebep 2: Yanlış Network**
```
Freighter Settings → Network → Testnet ✅
```

**Sebep 3: Memo Eksik**
```
Sistemimiz otomatik ekler, endişelenmeyin!
```

---

## 🎯 Test Etme

### **Freighter Çalışıyor mu?**

```javascript
// Browser console'da (F12)
await window.freighter.isConnected()
// true dönmeli

await window.freighter.getPublicKey()
// "GXXXXX..." public key dönmeli
```

### **Manuel Test:**

1. Freighter ikonuna tıkla → Açılmalı ✅
2. Settings → Network → Testnet seçili ✅
3. Ana ekran → Bakiye görünüyor ✅
4. "Send" butonu aktif ✅

---

## 📱 Alternatif: Albedo Wallet

Freighter çalışmazsa Albedo deneyin:

```
https://albedo.link/

→ Browser-based, extension gerekmez
→ Testnet destekler
→ Kod değişikliği gerekir (Freighter API yerine Albedo API)
```

---

## 🔒 Güvenlik İpuçları

### **✅ Yapın:**
- Secret phrase'i offline yedekle
- Güçlü şifre kullan
- Testnet'te test edin önce
- Public key'i paylaşabilirsiniz

### **❌ Yapmayın:**
- Secret phrase'i online saklamayın
- Screenshot çekmeyin
- Secret phrase'i kimseyle paylaşmayın
- Public key ile secret key'i karıştırmayın

---

## 📞 Hala Sorun mu Var?

### **Kontrol Listesi:**

- [ ] Freighter kurulu (chrome://extensions)
- [ ] Extension enabled
- [ ] Network: Testnet
- [ ] Popup blocker disabled (localhost için)
- [ ] Site permission verildi
- [ ] Test XLM var (10,000 XLM)
- [ ] Browser güncel (Chrome 90+, Firefox 88+)

### **Teknik Detaylar:**

```
Freighter API Version: 2.0+
Required Browser: Chrome 90+, Firefox 88+, Brave
Stellar SDK Version: 11.0.0+
Network: Testnet (Test SDF Network)
```

---

## 🎉 Başarılı Kurulum

Freighter doğru çalışıyorsa:

```
✅ Extension görünür
✅ Cüzdan oluşturuldu
✅ Network: Testnet
✅ Bakiye: 10,000 XLM
✅ localhost:3000 bağlı
✅ Popup açılıyor
```

Artık ödeme yapabilirsiniz! 🚀

---

## 🆘 Son Çare

Hiçbir şey çalışmazsa:

```bash
# 1. Tüm browser'ı kapat
# 2. Browser cache temizle
# 3. Browser'ı yeniden aç
# 4. Freighter'ı tekrar kur
# 5. Yeni cüzdan oluştur
# 6. Test XLM al
# 7. Dene!
```

---

**Built with 🔐 Freighter Wallet**

