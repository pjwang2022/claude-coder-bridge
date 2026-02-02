#!/usr/bin/env node

// MCP bridge script that connects stdio to our HTTP MCP server (LINE version)
const http = require('http');
const { Transform } = require('stream');

const MCP_PORT = process.env.MCP_SERVER_PORT || '3001';
console.error(`LINE MCP Bridge startup: LINE_USER_ID=${process.env.LINE_USER_ID}, LINE_PROJECT_NAME=${process.env.LINE_PROJECT_NAME}, PORT=${MCP_PORT}`);

const mcpTransform = new Transform({
  objectMode: false,
  transform(chunk, encoding, callback) {
    const data = chunk.toString();

    if (!data.trim()) {
      callback();
      return;
    }

    const postData = data;

    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      'Content-Length': Buffer.byteLength(postData),
    };

    // Pass LINE context as headers
    if (process.env.LINE_USER_ID) {
      headers['X-Line-User-Id'] = process.env.LINE_USER_ID;
    }
    if (process.env.LINE_PROJECT_NAME) {
      headers['X-Line-Project-Name'] = process.env.LINE_PROJECT_NAME;
    }

    const options = {
      hostname: 'localhost',
      port: parseInt(MCP_PORT),
      path: '/line/mcp',
      method: 'POST',
      headers,
    };

    const req = http.request(options, (res) => {
      let responseData = '';

      res.on('data', (chunk) => {
        responseData += chunk;
      });

      res.on('end', () => {
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
      console.error('LINE MCP Bridge Error:', err);
      this.push(JSON.stringify({
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: `MCP server connection failed: ${err.message}`,
        },
        id: null,
      }) + '\n');
      callback();
    });

    req.write(postData);
    req.end();
  },
});

process.stdin.pipe(mcpTransform).pipe(process.stdout);

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
