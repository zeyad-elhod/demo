async function nlToSql(question) {
  const systemPrompt = `
You are a SQL generator for a used cars database.
The database has a table named cars with columns:
id, brand, model, year, mileage_km, price_eur, accident_history, fuel_type, transmission.

Rules:
- ONLY output raw SQL.
- The SQL MUST start with SELECT or WITH.
- NEVER output DELETE, UPDATE, INSERT, DROP, ALTER, TRUNCATE, CREATE, REPLACE, MERGE.
- Do NOT output markdown, backticks, or explanations.
- Respond with SQL only.
`.trim();

  const res = await fetch("http://127.0.0.1:1234/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "phi-3-mini-128k-instruct",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: question },
      ],
      temperature: 0,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LM Studio error: ${text}`);
  }

  const data = await res.json();
  let sql = data?.choices?.[0]?.message?.content || "";

  // Clean any accidental markdown
  sql = sql.replace(/```sql/i, "")
           .replace(/```/g, "")
           .trim();

  return sql;
}

// Minimal MCP stdio server
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import * as z from 'zod';

(async function run() {
  try {
    const server = new McpServer({ name: 'cars-mcp-server', version: '1.0.0' });

    // Register a simple tool that converts natural language to SQL
    server.registerTool(
      'nl_to_sql',
      {
        title: 'Natural Language to SQL',
        description: 'Convert a natural language question into a SQL SELECT statement for the cars DB',
        inputSchema: { question: z.string() },
        outputSchema: { sql: z.string() }
      },
      async ({ question }) => {
        try {
          const sql = await nlToSql(question);
          return {
            content: [{ type: 'text', text: sql }],
            structuredContent: { sql }
          };
        } catch (err) {
          const msg = err && err.message ? err.message : String(err);
          return {
            content: [{ type: 'text', text: `Error: ${msg}` }],
            isError: true
          };
        }
      }
    );

    const transport = new StdioServerTransport();
    await server.connect(transport);

    // Keep running and connected to stdio
    console.log('MCP stdio server ready');
  } catch (err) {
    console.error('Failed to start MCP server:', err && err.message ? err.message : err);
    process.exit(1);
  }
})();
