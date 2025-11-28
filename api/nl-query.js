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

    const question = body && body.question ? String(body.question) : '';
    if (!question) {
      res.setHeader('Content-Type', 'application/json');
      return res.status(400).json({ error: 'No question provided' });
    }

    if (!process.env.GROQ_API_KEY) {
      res.setHeader('Content-Type', 'application/json');
      return res.status(500).json({ error: 'Missing GROQ_API_KEY' });
    }

    const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          {
            role: 'system',
            content:
              'You are a SQL generator for a used cars database. The database has a table named cars with columns: id, brand, model, year, mileage_km, price_eur, accident_history, fuel_type, transmission. Respond ONLY with raw SQL. No backticks. No markdown. No ```sql``` fences. No explanations. The SQL output MUST begin directly with SELECT or WITH. Never generate DELETE, UPDATE, INSERT, or any DDL.',
          },
          { role: 'user', content: question },
        ],
      }),
    });

    if (!groqResponse.ok) {
      const text = await groqResponse.text();
      res.setHeader('Content-Type', 'application/json');
      return res.status(500).json({ error: `Groq API error: ${text}` });
    }

    const groqData = await groqResponse.json();
    let sql = groqData?.choices?.[0]?.message?.content || '';
    sql = sql.trim();
    sql = sql.replace(/^```sql/i, '');
    sql = sql.replace(/^```/i, '');
    sql = sql.replace(/```$/i, '');
    sql = sql.trim();

    console.log('Generated SQL:', sql);
    console.log('Generated SQL from Groq:', sql);

    const sqlUpper = sql.toUpperCase().trim();
    if (!(sqlUpper.startsWith('SELECT') || sqlUpper.startsWith('WITH'))) {
      res.setHeader('Content-Type', 'application/json');
      return res.status(400).json({ error: 'LLM produced non-SELECT SQL', sql });
    }
    const forbidden = ['DELETE', 'UPDATE', 'INSERT', 'DROP', 'ALTER', 'TRUNCATE', 'CREATE', 'REPLACE', 'MERGE'];
    for (const kw of forbidden) {
      const re = new RegExp(`\\b${kw}\\b`, 'i');
      if (re.test(sql)) {
        res.setHeader('Content-Type', 'application/json');
        return res.status(400).json({ error: 'LLM produced unsafe SQL', sql });
      }
    }

    const queryUrl = `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}/api/query`;
    const queryResponse = await fetch(queryUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql }),
    });

    const queryData = await queryResponse.json();

    if (!queryResponse.ok) {
      res.setHeader('Content-Type', 'application/json');
      return res.status(queryResponse.status).json({
        error: queryData.error || 'Query failed',
        sql,
      });
    }

    res.setHeader('Content-Type', 'application/json');
    return res.status(200).json({ sql, rows: queryData });
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    res.setHeader('Content-Type', 'application/json');
    return res.status(500).json({ error: msg });
  }
}
