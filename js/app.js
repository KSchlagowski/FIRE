// app.js — bootstrap: wczytanie stanu, rejestracja SW, routing, hint instalacji.

import { storage } from './storage.js';
import { startApp, renderCorrupt, toast, setDeferredPrompt } from './ui.js';

const res = storage.load();

if (res.corrupt) {
  startApp(null); // pokaże onboarding pod spodem, ale zaraz nadpisujemy ekranem awaryjnym
  renderCorrupt(res.error);
} else {
  startApp(res.state || null);
  if (res.recovered) {
    toast('⚠️ Główny zapis był uszkodzony — przywrócono dane z kopii awaryjnej (.bak). Sprawdź ostatni wpis i zrób eksport.', 0);
  }
}

// ── Service worker (ścieżka względna → działa pod podścieżką GitHub Pages) ──

if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('./sw.js');
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) {
            toast('🔄 Dostępna nowa wersja — dotknij, aby odświeżyć.', 0, () => location.reload());
          }
        });
      });
    } catch (err) {
      console.warn('SW registration failed:', err);
    }
  });
}

// ── Hint instalacji PWA ──

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  setDeferredPrompt(e);
});
