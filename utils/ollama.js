// utils/ollama.js — client for local Ollama (MV3-safe, ESM)

// Create an absolute URL to avoid stray slashes
function base(b) {
  return (b || '').replace(/\/+$/, '');
}

export async function embedText(baseUrl, model, text) {
  const url = `${base(baseUrl)}/api/embeddings`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt: text })
  });
  if (!res.ok) {
    let detail = '';
    try { detail = await res.text(); } catch {}
    throw new Error(`Ollama embeddings failed: ${res.status} ${detail}`.trim());
  }
  const data = await res.json();
  if (!data || !data.embedding) throw new Error('No embedding returned');
  return data.embedding;
}

export async function testConnection(baseUrl) {
  try {
    const url = `${base(baseUrl)}/api/version`;
    const res = await fetch(url, { method: 'GET' });
    return res.ok;
  } catch (e) {
    return false;
  }
}

// List available models from Ollama (installed tags)
export async function listModels(baseUrl) {
  const url = `${base(baseUrl)}/api/tags`;
  const res = await fetch(url, { method: 'GET' });
  if (!res.ok) {
    let detail = '';
    try { detail = await res.text(); } catch {}
    throw new Error(`Ollama tags failed: ${res.status} ${detail}`.trim());
  }
  const data = await res.json();
  const models = (data && Array.isArray(data.models)) ? data.models : [];
  return models.map(m => m.name).filter(Boolean).sort();
}

// Optional reranker using a local LLM via /api/generate
export async function rerankWithLLM(baseUrl, model, query, items) {
  const prompt = `You are a precise search reranker.
Given the USER QUERY and a list of CANDIDATES, return a JSON array of objects with \"id\" and \"score\" (0-100) sorted by score desc.
Only return JSON. No explanation.

USER QUERY:
${query}

CANDIDATES (id, title, url, text):
${items.map(i => `- id:${i.id} | title:${i.title} | url:${i.url} | text:${(i.text || '').slice(0, 500)}`).join("\n")}

Return JSON only, like:
[{\"id\":\"...\",\"score\":97},{\"id\":\"...\",\"score\":88}]`;

  const url = `${base(baseUrl)}/api/generate`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt, stream: false })
  });
  if (!res.ok) {
    let detail = '';
    try { detail = await res.text(); } catch {}
    throw new Error(`Ollama rerank failed: ${res.status} ${detail}`.trim());
  }
  const data = await res.json();
  try {
    const text = data && data.response ? data.response : '';
    const start = text.indexOf('[');
    const end = text.lastIndexOf(']');
    if (start >= 0 && end >= start) {
      const jsonStr = text.slice(start, end + 1);
      const arr = JSON.parse(jsonStr);
      if (Array.isArray(arr)) return arr;
    }
  } catch (e) {
    console.warn('Failed to parse rerank JSON:', e);
  }
  return [];
}
