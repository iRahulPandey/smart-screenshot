
import { getAllShots } from './storage.js';
import { embedText, rerankWithLLM } from './utils/ollama.js';
import { cosineSim } from './utils/similarity.js';

const qEl = document.getElementById('q');
const goEl = document.getElementById('go');
const resultsEl = document.getElementById('results');
const subtitleEl = document.getElementById('subtitle');
const totalBadgeEl = document.getElementById('totalBadge');
const pagerEl = document.getElementById('pager');

const state = {
  allShots: [],     // full dataset
  items: [],        // items to display (after query / filtering)
  page: 1,
  perPage: 9,
  isQuery: false
};

function fmtDate(ts) {
  const d = new Date(ts);
  return d.toLocaleString();
}

function render(shots) {
  resultsEl.innerHTML = '';
  if (!shots.length) {
    resultsEl.innerHTML = '<p class="muted">No results.</p>';
    return;
  }
  for (const s of shots) {
    const urlEsc = s.url ? s.url.replace(/"/g, '&quot;') : '#';
    const card = document.createElement('div');
    card.className = 'card';
    const imgUrl = URL.createObjectURL(s.imageBlob);
    card.innerHTML = `
      <img src="${imgUrl}" alt="screenshot" />
      <div class="meta">
        <a class="title" href="${urlEsc}" target="_blank" rel="noreferrer noopener">${s.title || 'Untitled'}</a>
        <div class="sub">${s.url || ''}</div>
        <div class="sub">${fmtDate(s.timestamp)}</div>
      </div>
    `;
    resultsEl.appendChild(card);
  }
}

function renderPager(total) {
  const pages = Math.max(1, Math.ceil(total / state.perPage));
  pagerEl.innerHTML = '';
  if (pages <= 1) return;
  const prev = document.createElement('button');
  prev.textContent = '◀ Prev';
  prev.className = 'btn';
  prev.disabled = state.page === 1;
  prev.onclick = () => { state.page = Math.max(1, state.page - 1); renderPage(); };

  const label = document.createElement('span');
  label.className = 'label';
  label.textContent = `Page ${state.page} of ${pages}`;

  const next = document.createElement('button');
  next.textContent = 'Next ▶';
  next.className = 'btn';
  next.disabled = state.page >= pages;
  next.onclick = () => { state.page = Math.min(pages, state.page + 1); renderPage(); };

  pagerEl.append(prev, label, next);
}

function renderPage() {
  // Update subtitle counts
  const totalRes = state.items.length;
  if (state.isQuery) { subtitleEl.textContent = `${totalRes} result${totalRes===1?'':'s'} — Top-K applied`; } else { subtitleEl.textContent = `All screenshots`; }

  const total = state.items.length;
  const start = (state.page - 1) * state.perPage;
  const pageItems = state.items.slice(start, start + state.perPage);
  render(pageItems);
  renderPager(total);
}

async function doSearch() {
  const query = qEl.value.trim();
  const settings = await chrome.storage.sync.get({
    ollamaBaseUrl: 'http://localhost:11434',
    embeddingModel: 'nomic-embed-text',
    useRerank: false,
    rerankModel: 'llama3',
    semanticWeight: 0.7,
    topK: 12
  });

  // EMPTY QUERY: always show *all* screenshots (ignore Top-K entirely)
  if (!query) {
    state.items = state.allShots.slice(); // full copy
    state.page = 1;
    state.isQuery = false;
    renderPage();
    return;
  }

  // Non-empty query: run hybrid + optional rerank, then apply Top-K to candidate set only
  let qv = [];
  try {
    qv = await embedText(settings.ollamaBaseUrl, settings.embeddingModel, query);
  } catch (e) {
    console.info('Query embedding failed, using keyword-heavy hybrid.');
  }

  const shots = state.allShots;
  const docTexts = shots.map(s => `${s.title}\n${s.url}\n${s.text}`);

  function tokens(text) {
    return (text || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  }
  function tfidfScore(docText, allDocs, queryTerms) {
    if (!queryTerms.length) return 0;
    const docTokens = tokens(docText);
    if (!docTokens.length) return 0;
    const N = allDocs.length;
    let score = 0;
    for (const t of queryTerms) {
      const tf = docTokens.filter(x => x === t).length;
      if (!tf) continue;
      let df = 0;
      for (const d of allDocs) {
        if ((d.toLowerCase().match(new RegExp(`\\b${t}\\b`, 'g')) || []).length) { df++; }
      }
      const idf = Math.log((N + 1) / (df + 1)) + 1;
      score += tf * idf;
    }
    return score;
  }

  const keywordTerms = tokens(query);
  let semScores = [], kwScores = [];
  let maxKw = 0;

  for (let i = 0; i < shots.length; i++) {
    const s = shots[i];
    const sem = (qv.length && s.embedding?.length === qv.length) ? cosineSim(qv, s.embedding) : 0;
    semScores.push(sem);
    const kw = tfidfScore(docTexts[i], docTexts, keywordTerms);
    kwScores.push(kw);
    if (kw > maxKw) maxKw = kw;
  }
  kwScores = kwScores.map(x => maxKw ? (x / maxKw) : 0);

  const alpha = Math.max(0, Math.min(1, Number(settings.semanticWeight || 0.7)));
  const scored = shots.map((s, i) => ({
    s,
    score: alpha * semScores[i] + (1 - alpha) * kwScores[i]
  }));
  scored.sort((a, b) => b.score - a.score);

  // Candidate pool for rerank: a little larger than Top-K
  let candidates = scored.slice(0, Math.max(settings.topK * 3, settings.topK + 5));

  if (settings.useRerank && candidates.length > 1) {
    try {
      const items = candidates.map(x => ({ id: x.s.id, title: x.s.title, url: x.s.url, text: x.s.text || '' }));
      const reranked = await rerankWithLLM(settings.ollamaBaseUrl, settings.rerankModel, query, items);
      const order = new Map(reranked.map((r, idx) => [r.id, (r.score ?? (100 - idx))]));
      candidates.sort((a, b) => (order.get(b.s.id) || 0) - (order.get(a.s.id) || 0));
    } catch (e) {
      console.info('LLM rerank skipped:', e?.message || e);
    }
  }

  // FINAL: apply Top-K ONLY to queries
  state.items = candidates.slice(0, settings.topK).map(x => x.s);
  state.page = 1;
  state.isQuery = true;
  renderPage();
}

// Click + Enter triggers search
goEl.addEventListener('click', doSearch);
qEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });

// Auto-reset to "all" when the box is cleared
qEl.addEventListener('input', () => {
  if (qEl.value.trim() === '') {
    state.items = state.allShots.slice();
    state.page = 1;
    state.isQuery = false;
    renderPage();
  }
});

// Initial load: fetch all shots, sort, and show ALL with pagination (ignore Top-K)
(async () => {
  const shots = await getAllShots();
  shots.sort((a, b) => b.timestamp - a.timestamp);
  state.allShots = shots;
  totalBadgeEl.textContent = `${shots.length} ${shots.length===1?'shot':'shots'}`;
  state.items = shots.slice();
  state.page = 1;
  state.isQuery = false;
  renderPage();
})();
