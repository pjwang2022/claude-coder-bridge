#!/usr/bin/env node

// MCP bridge script that connects stdio to our HTTP MCP server
const http = require('http');
const { Transform } = require('stream');

const MCP_PORT = process.env.MCP_SERVER_PORT || '3001';
// Debug: Log environment variables at startup
console.error(`MCP Bridge startup: DISCORD_CHANNEL_ID=${process.env.DISCORD_CHANNEL_ID}, DISCORD_CHANNEL_NAME=${process.env.DISCORD_CHANNEL_NAME}, DISCORD_USER_ID=${process.env.DISCORD_USER_ID}, PORT=${MCP_PORT}`);

// Transform stream to handle MCP messages
const mcpTransform = new Transform({
  objectMode: false,
  transform(chunk, encoding, callback) {
    const data = chunk.toString();
    
    // Skip empty lines
    if (!data.trim()) {
      callback();
      return;
    }

    // Make HTTP request to our MCP server
    const postData = data;
    
    // Add Discord context environment variables as headers
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      'Content-Length': Buffer.byteLength(postData)
    };
    
    // Pass Discord environment variables as headers
    if (process.env.DISCORD_CHANNEL_ID) {
      headers['X-Discord-Channel-Id'] = process.env.DISCORD_CHANNEL_ID;
      console.error(`MCP Bridge: Adding Discord headers: channelId=${process.env.DISCORD_CHANNEL_ID}, channelName=${process.env.DISCORD_CHANNEL_NAME}, userId=${process.env.DISCORD_USER_ID}`);
    }
    if (process.env.DISCORD_CHANNEL_NAME) {
      headers['X-Discord-Channel-Name'] = process.env.DISCORD_CHANNEL_NAME;
    }
    if (process.env.DISCORD_USER_ID) {
      headers['X-Discord-User-Id'] = process.env.DISCORD_USER_ID;
    }
    if (process.env.DISCORD_MESSAGE_ID) {
      headers['X-Discord-Message-Id'] = process.env.DISCORD_MESSAGE_ID;
    }

    const options = {
      hostname: 'localhost',
      port: parseInt(MCP_PORT),
      path: '/mcp',
      method: 'POST',
      headers
    };

    const req = http.request(options, (res) => {
      let responseData = '';
      
      res.on('data', (chunk) => {
        responseData += chunk;
      });
      
      res.on('end', () => {
        // Handle Server-Sent Events format
        if (responseData.startsWith('event: message\ndata: ')) {
          const jsonData = responseData.replace('event: message\ndata: ', '').trim();
          this.push(jsonData + '\n');
        } else {
          this.push(responseData);
        }
        callback();
      });
    });

    req.on('error', (err) => {
      console.error('MCP Bridge Error:', err);
      this.push(JSON.stringify({
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: `MCP server connection failed: ${err.message}`
        },
        id: null
      }) + '\n');
      callback();
    });

    req.write(postData);
    req.end();
  }
});

// Connect stdin to our transform stream to stdout
process.stdin.pipe(mcpTransform).pipe(process.stdout);

// Handle process termination
process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));