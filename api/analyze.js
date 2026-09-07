// ============================================================
// Vercel Serverless Function: Secure AI Proxy
// API key disimpan di Environment Variables Vercel, BUKAN di kode
// ============================================================

const GOOGLE_MODELS = [
  'gemini-3.7-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash-lite',
  'gemini-3-flash-preview',
  'gemini-3.1-flash-lite-preview'
];

// Allowlist model Xkiro yang diizinkan (mencegah penyalahgunaan key)
const XKIRO_MODELS = [
  'qwen/qwen3.8-max:free',
  'qwen/qwen3-vl-plus:free',
  'qwen/qwen3.5-flash:free',
  'qwen/qwen3.5-plus:free',
  'minimax/minimax-m3:free',
  'mistralai/mistral-large-2512',
  'mistralai/mistral-small-2603',
  'mistralai/mistral-medium-3.5',
  'mistralai/ministral-14b',
  'mistralai/ministral-8b',
  'sensenova/sensenova-6.8-flash-lite',
  'sensenova/sensenova-6.7-flash-lite',
  'stealth/ox-alpha',
  'google/gemini-2.5-pro',
  'google/gemini-3-flash',
  'openai/gpt-5.6-luna',
  'deepseek/deepseek-v4-flash-vision-exp'
];

// ---------- Rate Limiter sederhana (per IP, in-memory) ----------
const rateStore = new Map();
const RATE_LIMIT = 20;            // max request
const RATE_WINDOW = 60 * 1000;    // per 1 menit

function getIP(req) {
  return (
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.headers['x-real-ip'] ||
    'unknown'
  );
}

function checkRate(ip) {
  const now = Date.now();
  const entry = rateStore.get(ip);
  if (!entry || now - entry.start > RATE_WINDOW) {
    rateStore.set(ip, { start: now, count: 1 });
    if (rateStore.size > 5000) {
      for (const [k, v] of rateStore) {
        if (now - v.start > RATE_WINDOW) rateStore.delete(k);
      }
    }
    return true;
  }
  entry.count++;
  return entry.count <= RATE_LIMIT;
}

// ---------- Validasi gambar (hanya data URL gambar) ----------
function isValidImageContent(content) {
  if (!Array.isArray(content) || content.length > 25) return false;
  for (const item of content) {
    if (item.type === 'text') {
      if (typeof item.text !== 'string' || item.text.length > 50000) return false;
    } else if (item.type === 'image_url') {
      const url = item.image_url && item.image_url.url;
      if (typeof url !== 'string' || !/^data:image\/(jpeg|png|webp);base64,/.test(url)) return false;
    } else {
      return false;
    }
  }
  return true;
}

// ---------- Panggil Google Gemini ----------
async function callGemini(model, systemPrompt, content, key) {
  const parts = [];
  for (const item of content) {
    if (item.type === 'text') {
      parts.push({ text: item.text });
    } else if (item.type === 'image_url') {
      const m = item.image_url.url.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
      if (m) parts.push({ inline_data: { mime_type: m[1], data: m[2] } });
    }
  }

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts }],
        generationConfig: { temperature: 0.15, topP: 0.9, maxOutputTokens: 4000 }
      })
    }
  );

  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error && d.error.message ? d.error.message : `Google HTTP ${res.status}`);
  if (d.promptFeedback && d.promptFeedback.blockReason) {
    throw new Error('Diblokir filter Google: ' + d.promptFeedback.blockReason);
  }
  const cand = d.candidates && d.candidates[0];
  if (!cand) throw new Error('Gemini tidak mengembalikan kandidat (kemungkinan filter safety).');
  const text = ((cand.content && cand.content.parts) || []).map(p => p.text || '').join('');
  if (!text) throw new Error('Respons Gemini kosong (finishReason: ' + (cand.finishReason || '?') + ')');
  return text;
}

// ---------- Panggil Xkiro (OpenAI-compatible) ----------
async function callXkiro(model, systemPrompt, content, key) {
  const res = await fetch('https://api.xkiro.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content }
      ],
      max_tokens: 4000,
      temperature: 0.15,
      top_p: 0.9
    })
  });

  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error && d.error.message ? d.error.message : `Xkiro HTTP ${res.status}`);
  if (!d.choices || !d.choices[0]) throw new Error('Xkiro tidak mengembalikan pilihan.');
  return d.choices[0].message.content;
}

// ---------- Handler utama ----------
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method tidak diizinkan (hanya POST).' });
  }

  const ip = getIP(req);
  if (!checkRate(ip)) {
    return res.status(429).json({ ok: false, error: 'Terlalu banyak request. Tunggu sebentar lalu coba lagi.' });
  }

  const body = req.body || {};
  const { model, systemPrompt, content } = body;

  if (!model || typeof model !== 'string' || !systemPrompt || typeof systemPrompt !== 'string') {
    return res.status(400).json({ ok: false, error: 'Payload tidak valid.' });
  }
  if (systemPrompt.length > 30000) {
    return res.status(400).json({ ok: false, error: 'System prompt terlalu panjang.' });
  }
  if (!isValidImageContent(content)) {
    return res.status(400).json({ ok: false, error: 'Format konten gambar tidak valid.' });
  }

  const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
  const XKIRO_API_KEY = process.env.XKIRO_API_KEY;

  try {
    let text;
    if (GOOGLE_MODELS.includes(model)) {
      if (!GOOGLE_API_KEY) {
        return res.status(500).json({ ok: false, error: 'GOOGLE_API_KEY belum diset di Environment Variables Vercel.' });
      }
      text = await callGemini(model, systemPrompt, content, GOOGLE_API_KEY);
    } else if (XKIRO_MODELS.includes(model)) {
      if (!XKIRO_API_KEY) {
        return res.status(500).json({ ok: false, error: 'XKIRO_API_KEY belum diset di Environment Variables Vercel.' });
      }
      text = await callXkiro(model, systemPrompt, content, XKIRO_API_KEY);
    } else {
      return res.status(400).json({ ok: false, error: 'Model tidak dikenal/tidak diizinkan.' });
    }
    return res.status(200).json({ ok: true, text });
  } catch (e) {
    return res.status(502).json({ ok: false, error: e.message || 'Gagal memanggil provider AI.' });
  }
};

// Izinkan body besar (gambar base64)
module.exports.config = {
  api: { bodyParser: { sizeLimit: '8mb' } }
};
