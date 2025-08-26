// background.js (MV3 service worker; ES module)
import { saveShot } from './storage.js';
import { embedText, testConnection } from './utils/ollama.js';

// --- Utilities ---
const dataUrlToBlob = async (dataUrl) => {
  const res = await fetch(dataUrl);
  return await res.blob();
};

const originFromUrl = (url) => {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.hostname}${u.port ? ':' + u.port : ''}/*`;
  } catch (e) {
    return null;
  }
};

async function requestOriginPermission(tabUrl) {
  const originPattern = originFromUrl(tabUrl);
  if (!originPattern) return false;
  try {
    return await chrome.permissions.request({ origins: [originPattern] });
  } catch {
    return false;
  }
}

// --- Screenshot capture pipeline ---
async function captureVisible(tab) {
  // 1) Capture visible area
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  const imageBlob = await dataUrlToBlob(dataUrl);

  // 2) Try to get page text via injected script (request permission if needed)
  let pageText = '';
  try {
    const granted = await requestOriginPermission(tab.url);
    if (granted) {
      const [result] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const bodyText = document.body ? document.body.innerText || '' : '';
          const metaDesc = document.querySelector('meta[name="description"]')?.content || '';
          const h1 = Array.from(document.querySelectorAll('h1')).map(h => h.innerText).join(' • ');
          const combined = [h1, metaDesc, bodyText].filter(Boolean).join('\n\n');
          return combined.slice(0, 4000);
        }
      });
      pageText = result?.result || '';
    }
  } catch (e) {
    console.warn('Failed to extract page text:', e);
  }

  const settings = await chrome.storage.sync.get({
    ollamaBaseUrl: 'http://localhost:11434',
    embeddingModel: 'nomic-embed-text',
    captureBodyText: true,
    saveToDownloads: false,
    downloadSubfolder: 'SmartShot',
    askSaveAs: false
  });

  const textForEmbedding = `${tab.title}\n${tab.url}\n${settings.captureBodyText ? pageText : ''}`.trim();

  // 3) Generate embedding via local Ollama (best effort; fallback to empty array on failure)
  let embedding = [];
  try {
    embedding = await embedText(settings.ollamaBaseUrl, settings.embeddingModel, textForEmbedding);
  } catch (e) {
    console.warn('Embedding failed, saving without vector. You can still hybrid-search.', e);
  }

  // 4) Persist to IndexedDB
  const shot = {
    id: crypto.randomUUID(),
    title: tab.title || 'Untitled',
    url: tab.url || '',
    timestamp: Date.now(),
    text: pageText || '',
    embedding,
  };
  await saveShot(shot, imageBlob);

  // 5) Optional: save copies to Downloads
  if (settings.saveToDownloads) {
    try {
      const hasPerm = await chrome.permissions.contains({ permissions: ['downloads'] });
      if (!hasPerm) {
        const granted = await chrome.permissions.request({ permissions: ['downloads'] });
        if (!granted) {
          console.warn('Downloads permission not granted.');
        }
      }
      const ok = await chrome.permissions.contains({ permissions: ['downloads'] });
      if (ok) {
        const folder = (settings.downloadSubfolder || 'SmartShot').replace(/[^-\w\/ ]/g, '').trim() || 'SmartShot';
        const ts = new Date().toISOString().replace(/[:T]/g, '-').split('.')[0];
        const baseName = `${(tab.title || 'Untitled').slice(0,60).replace(/[^-\w ]/g, '').replace(/\s+/g, '_')}_${ts}`;
        const imgName = `${folder}/${baseName}.png`;
        const metaName = `${folder}/${baseName}.json`;
        const imgUrl = URL.createObjectURL(imageBlob);
        const metaBlob = new Blob([JSON.stringify({ id: shot.id, title: shot.title, url: shot.url, timestamp: shot.timestamp, text: shot.text }, null, 2)], { type: 'application/json' });
        const metaUrl = URL.createObjectURL(metaBlob);
        await chrome.downloads.download({ url: imgUrl, filename: imgName, saveAs: !!settings.askSaveAs });
        await chrome.downloads.download({ url: metaUrl, filename: metaName, saveAs: false });
        setTimeout(() => { URL.revokeObjectURL(imgUrl); URL.revokeObjectURL(metaUrl); }, 10000);
      }
    } catch (e) {
      console.warn('Failed to save to downloads:', e);
    }
  }

  // 6) Notify user
  try {
    chrome.notifications?.create?.(shot.id, {
      type: 'basic',
      iconUrl: 'icons/icon48.png',
      title: 'SmartShot saved',
      message: `${shot.title}`
    });
  } catch (e) {}

  return shot.id;
}

// --- Open search UI ---
async function openSearch() {
  await chrome.tabs.create({ url: chrome.runtime.getURL('search.html') });
}

// --- Commands (hotkeys) ---
chrome.commands.onCommand.addListener(async (command) => {
  try {
    if (command === 'capture-visible') {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) await captureVisible(tab);
    }
    if (command === 'open-search') {
      await openSearch();
    }
  } catch (e) {
    console.warn('Command failed:', e);
  }
});

// --- Messages from UI pages ---
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (msg?.type === 'CAPTURE_NOW') {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const id = tab?.id ? await captureVisible(tab) : null;
        sendResponse({ ok: true, id });
        return;
      }
      if (msg?.type === 'TEST_OLLAMA') {
        const ok = await testConnection(msg.baseUrl);
        sendResponse({ ok });
        return;
      }
    } catch (e) {
      sendResponse({ ok: false, error: String(e) });
    }
  })();
  return true; // keep channel open for async
});

// Helpful logs
chrome.runtime.onInstalled.addListener(() => {
  console.log('SmartShot installed');
});
chrome.runtime.onStartup.addListener(() => {
  console.log('SmartShot startup');
});
