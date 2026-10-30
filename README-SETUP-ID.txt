TEAMDROP — PETUNJUK SETUP (WHISKAY BOT / BAILEYS)

1. Jalankan Whiskay Bot dan pastikan akun WhatsApp sudah tersambung.
2. Tambahkan konfigurasi berikut ke .env Whiskay Bot:
   TEAMDROP_WEBHOOK_SECRET=<buat-token-rahasia-panjang>
   TEAMDROP_WHATSAPP_TO=<nomor-penerima-format-628...>
   TEAMDROP_MAX_FILE_MB=50
3. Tambahkan konfigurasi berikut ke .env TEAMDROP:
   WHISKAY_BOT_WEBHOOK_URL=http://127.0.0.1:8787/webhooks/teamdrop/document
   WHISKAY_BOT_WEBHOOK_TOKEN=<token-yang-sama-dengan-bot>
4. Bila kedua aplikasi ada di VPS yang sama, pertahankan endpoint 127.0.0.1 agar webhook tidak terbuka ke internet. Bila berbeda host, gunakan URL Quick Tunnel HTTPS terbaru dari Whiskay Bot + path /webhooks/teamdrop/document; perbarui endpoint bila URL tunnel berubah.
5. Restart Whiskay Bot dan TEAMDROP.
6. Buat kode akses tim, password admin, dan SESSION_SECRET yang kuat pada .env TEAMDROP.
7. Buka website publik untuk anggota tim dan /admin untuk pengelola.
8. Uji dengan satu dokumen terlebih dahulu. Periksa pesan masuk dan status di dashboard.

CATATAN KEAMANAN
- Jangan menaruh nomor tujuan WhatsApp, token webhook, atau password admin di HTML/JavaScript.
- Simpan .env, sessions/, uploads/, dan data/ secara privat; jangan commit ke Git.
- Jika bot dan portal berbeda host, gunakan HTTPS reverse proxy dan firewall allowlist.
- Jika WhatsApp bot offline, file tetap tersimpan dan admin dapat mencoba kirim ulang.
