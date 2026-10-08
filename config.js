// Ключ Google Drive API (Google Cloud → APIs & Services → Credentials).
// Если заполнен, сайт читает папки Drive напрямую, без сервера: достаточно открыть index.html.
// Если пусто, сайт обращается к /api/drive (server.js или Vercel).
window.CONFIG = {
  GOOGLE_DRIVE_API_KEY: 'AIzaSyB9LV5sEWEWVnm8thTANxa-xik1B_GKmR0',
  // Укажите реальные свободные даты в формате YYYY-MM-DD. Пустой список = даты по запросу.
  AVAILABLE_DATES: [],
};
