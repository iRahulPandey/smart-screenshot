
import { getAllShots } from './storage.js';

async function refreshCount() {
  try {
    const shots = await getAllShots();
    const el = document.getElementById('shotCount');
    el.textContent = `${shots.length} ${shots.length === 1 ? 'shot' : 'shots'}`;
  } catch (e) {
    console.warn('Failed to load count', e);
  }
}

document.getElementById('captureBtn').addEventListener('click', async () => {
  try {
    const res = await chrome.runtime.sendMessage({ type: 'CAPTURE_NOW' });
    if (res?.ok) {
      await refreshCount();
      window.close();
    }
  } catch (e) {
    console.warn('Capture via background failed, opening search fallback', e);
  }
});

document.getElementById('searchBtn').addEventListener('click', async () => {
  await chrome.tabs.create({ url: chrome.runtime.getURL('search.html') });
  window.close();
});

// Initial count
refreshCount();
