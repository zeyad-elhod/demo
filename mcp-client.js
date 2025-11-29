import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

(async function main(){
  try{
    const transport = new StdioClientTransport({
      command: 'node',
      args: ['mcp-server.js']
    });

    const client = new Client({ name: 'local-mcp-client', version: '1.0.0' });

    console.log('Connecting to MCP server via stdio (spawning `node mcp-server.js`)...');
    await client.connect(transport);
    console.log('Connected. Listing tools...');

    const toolsRes = await client.listTools();
    const toolsList = Array.isArray(toolsRes) ? toolsRes : (toolsRes?.tools || []);
    console.log('Available tools:', toolsList.map(t=>t.name));

    const question = 'List cars priced under 10000 euros from 2015 onwards';
    console.log('Calling tool nl_to_sql with question:', question);

    const result = await client.callTool({ name: 'nl_to_sql', arguments: { question } });
    console.log('Tool call result:');
    // result.structuredContent may contain sql
    if(result.structuredContent && result.structuredContent.sql){
      console.log(result.structuredContent.sql);
    } else if(Array.isArray(result.content) && result.content.length){
      console.log(result.content.map(c=>c.text || JSON.stringify(c)).join('\n'));
    } else {
      console.log(JSON.stringify(result, null, 2));
    }

    // Cleanly close
    if (typeof client.close === 'function') await client.close();
    console.log('Disconnected.');
  }catch(err){
    console.error('MCP client error:', err && err.message ? err.message : err);
    process.exit(1);
  }
})();
