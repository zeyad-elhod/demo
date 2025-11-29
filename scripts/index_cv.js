import fs from 'fs/promises';
import path from 'path';
import pdfParse from 'pdf-parse';
import OpenAI from 'openai';

const PDF_PATH = path.join(process.cwd(), 'cv.pdf');
const OUTPUT_PATH = path.join(process.cwd(), 'cv-embeddings.json');
const MODEL = 'text-embedding-3-small';

async function loadApiKey() {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;

  const envPath = path.join(process.cwd(), '.env.local');
  try {
    const envRaw = await fs.readFile(envPath, 'utf8');
    for (const line of envRaw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const [key, ...rest] = trimmed.split('=');
      if (key === 'OPENAI_API_KEY') {
        return rest.join('=').replace(/^['"]|['"]$/g, '');
      }
    }
  } catch (err) {
    // Ignore missing .env.local, we'll throw below
  }

  throw new Error('Missing OPENAI_API_KEY. Set it in the environment or .env.local.');
}

async function pdfText(pdfPath) {
  const buffer = await fs.readFile(pdfPath);
  const parsed = await pdfParse(buffer);
  const cleaned = parsed.text.replace(/\s+/g, ' ').trim();
  if (!cleaned) throw new Error('No text extracted from PDF.');
  return cleaned;
}

function chunkText(text, maxWords = 400, overlapWords = 60) {
  if (overlapWords >= maxWords) throw new Error('overlapWords must be smaller than maxWords');

  const words = text.split(/\s+/).filter(Boolean);
  const chunks = [];

  for (let start = 0; start < words.length; start += maxWords - overlapWords) {
    const slice = words.slice(start, start + maxWords).join(' ').trim();
    if (slice) chunks.push(slice);
  }

  return chunks;
}

async function main() {
  try {
    const apiKey = await loadApiKey();
    const client = new OpenAI({ apiKey });

    console.log(`Reading ${PDF_PATH}...`);
    const text = await pdfText(PDF_PATH);
    const chunks = chunkText(text);

    console.log(`Creating embeddings for ${chunks.length} chunks using ${MODEL}...`);
    const res = await client.embeddings.create({ model: MODEL, input: chunks });

    const records = res.data.map((item, idx) => ({
      id: `chunk-${idx + 1}`,
      text: chunks[idx],
      embedding: item.embedding,
    }));

    const payload = {
      source: path.basename(PDF_PATH),
      model: MODEL,
      createdAt: new Date().toISOString(),
      chunkSizeWords: 400,
      chunkOverlapWords: 60,
      chunks: records,
    };

    await fs.writeFile(OUTPUT_PATH, JSON.stringify(payload, null, 2), 'utf8');
    console.log(`Saved ${records.length} embeddings to ${OUTPUT_PATH}`);
  } catch (err) {
    console.error('Failed to build embeddings:', err && err.message ? err.message : err);
    process.exit(1);
  }
}

main();
