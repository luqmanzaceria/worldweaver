import { spawn } from 'node:child_process';

export function createMcpClient() {
  const child = spawn('uvx', ['blender-mcp'], { env: process.env });
  let idCounter = 1;
  const pending = new Map();
  let initialized = false;
  let initializing = null;
  let status = 'starting';
  let lastError = null;
  const logs = [];

  child.stdout.setEncoding('utf-8');
  child.stderr.setEncoding('utf-8');

  let buffer = '';

  child.stdout.on('data', data => {
    const chunk = data.toString();
    buffer += chunk;
    const lines = chunk.split('\n').filter(Boolean);
    for (const line of lines) {
      logs.push(`[stdout] ${line}`);
    }
    if (logs.length > 200) logs.splice(0, logs.length - 200);

    let newlineIndex = buffer.indexOf('\n');
    while (newlineIndex !== -1) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (line) {
        handleMessage(line);
      }
      newlineIndex = buffer.indexOf('\n');
    }
  });

  function handleMessage(payload) {
    try {
      const message = JSON.parse(payload);
      if (message.id && pending.has(message.id)) {
        const { resolve, reject } = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) {
          reject(new Error(message.error.message ?? 'MCP error'));
        } else {
          resolve(message.result);
        }
      }
    } catch {
      // Ignore non-JSON logs
    }
  }

  child.on('exit', code => {
    for (const { reject } of pending.values()) {
      reject(new Error(`MCP server exited (${code ?? 'unknown'})`));
    }
    pending.clear();
    if (!initialized) {
      status = 'error';
      lastError = `MCP server exited (${code ?? 'unknown'})`;
    }
  });

  child.stderr.on('data', data => {
    const lines = data.toString().split('\n').filter(Boolean);
    for (const line of lines) {
      // Filter out known non-fatal Pydantic validation errors from blender-mcp
      // These are validation warnings that don't affect functionality
      const isPydanticError = 
        line.includes('TaskStatusNotification.params') ||
        (line.includes('lastUpdatedAt') || line.includes('ttl')) && 
        line.includes('Field required') ||
        line.includes('For further information visit https://errors.pydantic.dev') ||
        (line.includes('method=') && line.includes('initialized') && line.includes('params={}'));
      
      // Filter out verbose INFO logs from blender-mcp (not actual errors)
      const isInfoLog = 
        (line.includes('BlenderMCPServer') && line.includes('INFO')) ||
        (line.includes('Received') && line.includes('bytes of data')) ||
        line.includes('Response parsed, status: success') ||
        line.includes('Sending command:') ||
        line.includes('Command sent, waiting for response') ||
        line.includes('Received complete response');
      
      // Filter out telemetry logs
      const isTelemetryLog = 
        (line.includes('httpx') && (line.includes('telemetry_events') || line.includes('supabase.co'))) ||
        line.includes('get_telemetry_consent');
      
      if (isPydanticError || isTelemetryLog || isInfoLog) {
        // Skip these verbose/informational messages
        continue;
      }
      
      // Only log actual warnings and errors
      logs.push(`[stderr] ${line}`);
    }
    if (logs.length > 200) logs.splice(0, logs.length - 200);
  });

  function send(method, params = {}) {
    const id = idCounter++;
    const payload = { jsonrpc: '2.0', id, method, params };
    child.stdin.write(`${JSON.stringify(payload)}\n`);

    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
    });
  }

  function sendNotification(method, params = {}) {
    const payload = { jsonrpc: '2.0', method, params };
    child.stdin.write(`${JSON.stringify(payload)}\n`);
  }

  return {
    async ensureInitialized() {
      if (initialized) return;
      if (!initializing) {
        initializing = (async () => {
          try {
            await send('initialize', {
              clientInfo: { name: 'worldweaver-local', version: '0.1.0' },
              protocolVersion: '2024-11-05',
              capabilities: {}
            });
            sendNotification('initialized');
            initialized = true;
            status = 'ready';
          } catch (error) {
            status = 'error';
            lastError = error instanceof Error ? error.message : String(error);
            throw error;
          }
        })();
      }
      return initializing;
    },
    getStatus() {
      return { status, error: lastError, logs };
    },
    async callTool(toolName, args) {
      await this.ensureInitialized();
      return send('tools/call', { name: toolName, arguments: args });
    },
    async listTools() {
      await this.ensureInitialized();
      return send('tools/list', {});
    },
    close() {
      child.kill('SIGTERM');
    }
  };
}

