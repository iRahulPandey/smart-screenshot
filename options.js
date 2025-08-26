
import { testConnection, listModels } from './utils/ollama.js';

const baseUrl = document.getElementById('baseUrl');
const embedModel = document.getElementById('embedModel');
const rerankModel = document.getElementById('rerankModel');
const useRerank = document.getElementById('useRerank');
const semanticWeight = document.getElementById('semanticWeight');
const topK = document.getElementById('topK');
const captureText = document.getElementById('captureText');
const saveToDownloads = document.getElementById('saveToDownloads');
const downloadSubfolder = document.getElementById('downloadSubfolder');
const askSaveAs = document.getElementById('askSaveAs');
const status = document.getElementById('status');
const pathPreview = document.getElementById('pathPreview');
const openShortcuts = document.getElementById('openShortcuts');

function sanitizeFolder(input) {
  // Allow letters, numbers, dash, underscore, spaces, forward slashes for nested subfolders.
  const cleaned = (input || '').replace(/[^-\w\/ ]/g, '').trim().replace(/\/+/g, '/').replace(/^\//, '').replace(/\s+/g, ' ');
  return cleaned || 'SmartShot';
}

function updatePreview() {
  const p = sanitizeFolder(downloadSubfolder.value);
  if (pathPreview) pathPreview.textContent = `Effective path: ~/Downloads/${p}`;
}

async function load() {
  const s = await chrome.storage.sync.get({
    ollamaBaseUrl: 'http://127.0.0.1:11434',
    embeddingModel: 'nomic-embed-text',
    useRerank: false,
    rerankModel: 'llama3',
    semanticWeight: 0.7,
    topK: 12,
    captureBodyText: true,
    saveToDownloads: false,
    downloadSubfolder: 'SmartShot',
    askSaveAs: false
  });
  baseUrl.value = s.ollamaBaseUrl;
  semanticWeight.value = s.semanticWeight;
  topK.value = s.topK;
  captureText.checked = !!s.captureBodyText;
  useRerank.checked = !!s.useRerank;
  downloadSubfolder.value = s.downloadSubfolder || 'SmartShot';
  askSaveAs.checked = !!s.askSaveAs;
  saveToDownloads.checked = !!s.saveToDownloads;
  updatePreview();

  // Populate models
  await refreshModelsUI(s.ollamaBaseUrl, s.embeddingModel, s.rerankModel);
}

async function refreshModelsUI(base, embedSel, rerankSel) {
  try {
    const models = await listModels(base);
    embedModel.innerHTML = '';
    rerankModel.innerHTML = '';

    for (const m of models) {
      const opt1 = document.createElement('option');
      opt1.value = m; opt1.textContent = m;
      embedModel.appendChild(opt1);
      const opt2 = document.createElement('option');
      opt2.value = m; opt2.textContent = m;
      rerankModel.appendChild(opt2);
    }
    // Defaults
    embedModel.value = embedSel || 'nomic-embed-text';
    rerankModel.value = rerankSel || 'llama3';
  } catch (e) {
    // Fallback: manual typing when list fails
    embedModel.innerHTML = `<option value="nomic-embed-text">nomic-embed-text</option>`;
    rerankModel.innerHTML = `<option value="llama3">llama3</option>`;
  }
}

downloadSubfolder.addEventListener('input', updatePreview);

openShortcuts.addEventListener('click', async () => {
  // Use tabs.create to open chrome:// page
  await chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
});

document.getElementById('save').addEventListener('click', async () => {
  const newSettings = {
    ollamaBaseUrl: baseUrl.value.trim() || 'http://127.0.0.1:11434',
    embeddingModel: embedModel.value || 'nomic-embed-text',
    useRerank: useRerank.checked,
    rerankModel: rerankModel.value || 'llama3',
    semanticWeight: Number(semanticWeight.value || 0.7),
    topK: Math.max(1, Math.min(100, parseInt(topK.value || '12', 10))),
    captureBodyText: captureText.checked,
    saveToDownloads: saveToDownloads.checked,
    downloadSubfolder: sanitizeFolder(downloadSubfolder.value),
    askSaveAs: askSaveAs.checked
  };

  await chrome.storage.sync.set(newSettings);

  if (newSettings.saveToDownloads) {
    const granted = await chrome.permissions.request({ permissions: ['downloads'] });
    if (!granted) {
      status.textContent = '⚠️ Could not get "downloads" permission. Files will not be saved to disk.';
      await chrome.storage.sync.set({ saveToDownloads: false });
    } else {
      status.textContent = '✅ Saved';
    }
  } else {
    status.textContent = '✅ Saved';
  }
  setTimeout(() => status.textContent = '', 2000);
});

document.getElementById('refreshModels').addEventListener('click', async () => {
  status.textContent = '⏳ Fetching models...';
  await refreshModelsUI(baseUrl.value.trim(), embedModel.value, rerankModel.value);
  status.textContent = '✅ Models updated';
  setTimeout(() => status.textContent = '', 1500);
});

document.getElementById('test').addEventListener('click', async () => {
  status.textContent = '⏳ Testing...';
  const ok = await testConnection(baseUrl.value.trim());
  status.textContent = ok ? '✅ Ollama reachable' : '❌ Could not reach Ollama';
  setTimeout(() => status.textContent = '', 2000);
});

load();
