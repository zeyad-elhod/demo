import initSqlJs from 'sql.js';
import fs from 'fs';
import path from 'path';

let embedderPromise;

async function getEmbedder() {
  if (!embedderPromise) {
    // Dynamic import keeps the cold-start bundle smaller for serverless (e.g., Vercel).
    const { pipeline } = await import('@xenova/transformers');
    // Quantized model keeps memory/size smaller for serverless
    embedderPromise = pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
      quantized: true,
    });
  }
  return embedderPromise;
}

async function embedText(text) {
  const embedder = await getEmbedder();
  const output = await embedder(text, { pooling: 'mean', normalize: true });
  const data = output?.data;
  return Array.isArray(data) ? data : Array.from(data);
}

function cosineSim(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const av = a[i];
    const bv = b[i];
    dot += av * bv;
    na += av * av;
    nb += bv * bv;
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function lexicalScore(query, text) {
  const tokenize = (str) => (str.toLowerCase().match(/[a-z0-9]+/g) || []);
  const qTokens = tokenize(query);
  const tTokens = tokenize(text);
  if (!qTokens.length || !tTokens.length) return 0;
  const tSet = new Set(tTokens);
  let hits = 0;
  for (const tok of qTokens) if (tSet.has(tok)) hits++;
  return hits / qTokens.length;
}

function parseEmbedding(raw) {
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : null;
  } catch (_) {
    return null;
  }
}

async function loadCvChunks() {
  const locateFile = (file) => path.join(process.cwd(), 'node_modules/sql.js/dist', file);
  const SQL = await initSqlJs({ locateFile });
  const dbPath = path.resolve(process.cwd(), 'cv.db');

  if (!fs.existsSync(dbPath)) {
    throw new Error('cv.db not found');
  }

  const fileBuffer = fs.readFileSync(dbPath);
  const db = new SQL.Database(new Uint8Array(fileBuffer));
  const result = db.exec('SELECT id, chunk_text, embedding_json FROM cv_chunks');
  db.close();

  if (!result.length) return [];
  const { columns, values } = result[0];
  const idx = {
    id: columns.indexOf('id'),
    text: columns.indexOf('chunk_text'),
    emb: columns.indexOf('embedding_json'),
  };
  return values.map((row) => ({
    id: row[idx.id],
    text: row[idx.text],
    embedding: parseEmbedding(row[idx.emb]),
  }));
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Content-Type', 'application/json');
      return res.status(405).json({ error: 'Method not allowed' });
    }

    let body;
    if (req.body && typeof req.body === 'object') {
      body = req.body;
    } else {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const raw = Buffer.concat(chunks).toString('utf8');
      body = raw ? JSON.parse(raw) : {};
    }

    const question = body && body.question ? String(body.question).trim() : '';
    if (!question) {
      res.setHeader('Content-Type', 'application/json');
      return res.status(400).json({ error: 'No question provided' });
    }

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      res.setHeader('Content-Type', 'application/json');
      return res.status(500).json({ error: 'Missing GROQ_API_KEY' });
    }

    const chunks = await loadCvChunks();
    if (!chunks.length) {
      res.setHeader('Content-Type', 'application/json');
      return res.status(500).json({ error: 'No CV chunks available' });
    }

    let questionEmbedding = null;
    try {
      questionEmbedding = await embedText(question);
    } catch (err) {
      console.warn('Embedding failed, falling back to lexical similarity:', err?.message || err);
    }

    const scored = chunks
      .map((chunk) => {
        const score =
          questionEmbedding && chunk.embedding
            ? cosineSim(questionEmbedding, chunk.embedding)
            : lexicalScore(question, chunk.text || '');
        return { ...chunk, score };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    const contextBlock = scored
      .map(
        (chunk, i) =>
          `[Chunk ${i + 1} | id ${chunk.id} | score ${chunk.score.toFixed(3)}]\n${chunk.text}`,
      )
      .join('\n\n');

    const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          {
            role: 'system',
            content:
              "You are a concise assistant answering questions about Zeyad Elhodaiby's CV. Only use the provided CV chunks. If the answer is not in the chunks, say you don't know. Keep responses brief and specific.",
          },
          {
            role: 'user',
            content: `Question: ${question}\n\nRelevant CV chunks:\n${contextBlock}\n\nAnswer using only these chunks. If you cite, reference the chunk numbers.`,
          },
        ],
        temperature: 0.4,
      }),
    });

    if (!groqResponse.ok) {
      const text = await groqResponse.text();
      res.setHeader('Content-Type', 'application/json');
      return res.status(500).json({ error: `Groq API error: ${text}` });
    }

    const data = await groqResponse.json();
    const answer = data?.choices?.[0]?.message?.content?.trim() || '';

    res.setHeader('Content-Type', 'application/json');
    return res.status(200).json({
      answer,
      model: 'llama-3.3-70b-versatile',
      chunks: scored.map((c) => ({
        id: c.id,
        score: Number(c.score?.toFixed ? c.score.toFixed(3) : c.score) || 0,
        preview: c.text.slice(0, 420),
      })),
      usedEmbeddings: Boolean(questionEmbedding),
    });
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    res.setHeader('Content-Type', 'application/json');
    return res.status(500).json({ error: msg });
  }
}
