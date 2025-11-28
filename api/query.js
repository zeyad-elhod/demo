import initSqlJs from 'sql.js';
import fs from 'fs';
import path from 'path';

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

    const sql = body && body.sql ? String(body.sql) : '';
    if (!sql) {
      res.setHeader('Content-Type', 'application/json');
      return res.status(400).json({ error: 'No SQL provided' });
    }

    const sqlNorm = sql.toUpperCase().trim();

    if (!(sqlNorm.startsWith('SELECT') || sqlNorm.startsWith('WITH'))) {
      res.setHeader('Content-Type', 'application/json');
      return res.status(400).json({ error: 'Unsafe SQL' });
    }

    const forbidden = ['DELETE', 'UPDATE', 'INSERT', 'DROP', 'ALTER', 'TRUNCATE', 'CREATE', 'REPLACE', 'MERGE'];
    for (const kw of forbidden) {
      const re = new RegExp('\\b' + kw + '\\b', 'i');
      if (re.test(sql)) {
        res.setHeader('Content-Type', 'application/json');
        return res.status(400).json({ error: 'Unsafe SQL' });
      }
    }

    const SQL = await initSqlJs({
      locateFile: (file) => path.join(process.cwd(), 'node_modules/sql.js/dist', file),
    });

    const dbPath = path.join(process.cwd(), 'cars.db');

    if (!fs.existsSync(dbPath)) {
      res.setHeader('Content-Type', 'application/json');
      return res.status(500).json({ error: 'Database file not found' });
    }

    const fileBuffer = fs.readFileSync(dbPath);
    const db = new SQL.Database(new Uint8Array(fileBuffer));

    // Execute the query
    const results = db.exec(sql);

    const rows = [];
    for (const result of results) {
      const { columns, values } = result;
      for (const valueRow of values) {
        const obj = {};
        columns.forEach((col, i) => {
          obj[col] = valueRow[i];
        });
        rows.push(obj);
      }
    }

    db.close();
    res.setHeader('Content-Type', 'application/json');
    return res.status(200).json(rows);
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    res.setHeader('Content-Type', 'application/json');
    return res.status(500).json({ error: msg });
  }
}
