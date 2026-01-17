import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdir, readFile } from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import crypto from 'node:crypto';
import { createMcpClient } from './mcp_client.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = dirname(__dirname);

// IMPORTANT: We write to the frontend's public directory so Vite can serve it
const frontendPublicDir = join(workspaceRoot, 'frontend', 'public', 'generated');
const scriptPath = join(workspaceRoot, 'tools', 'blender', 'generate_world.py');

loadEnvLocal();

const BLENDER_PATH = process.env.BLENDER_PATH ?? 'blender';
const PORT = Number(process.env.WW_BLENDER_PORT ?? 8787);
const BLENDER_MODE = (process.env.WW_BLENDER_MODE ?? 'script').toLowerCase();

const jobs = new Map();
let mcpClientPromise = null;

function getMcpClient() {
  if (!mcpClientPromise) {
    mcpClientPromise = createMcpClient();
  }
  return mcpClientPromise;
}

function createJob(prompt) {
  const id = crypto.randomBytes(8).toString('hex');
  const outputName = `worldweaver_${id}.glb`;
  const outputPath = join(frontendPublicDir, outputName);
  const job = {
    id,
    prompt,
    outputName,
    outputPath,
    status: 'queued',
    listeners: new Set(),
    events: [],
    process: null
  };
  jobs.set(id, job);
  return job;
}

function loadEnvLocal() {
  const envPaths = [
    join(workspaceRoot, '.env.local'),
    join(workspaceRoot, '.env'),
    join(workspaceRoot, 'frontend', '.env.local')
  ];
  for (const envPath of envPaths) {
    if (!existsSync(envPath)) continue;
    try {
      const content = readFileSync(envPath, 'utf-8');
      const lines = content.split('\n');
      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;
        const index = line.indexOf('=');
        if (index === -1) continue;
        const key = line.slice(0, index).trim();
        let value = line.slice(index + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        if (!process.env[key]) {
          process.env[key] = value;
        }
      }
    } catch (e) {
      console.error(`Failed to load env from ${envPath}:`, e);
    }
  }
}

function sendEvent(job, event) {
  job.events.push(event);
  for (const listener of job.listeners) {
    listener(event);
  }
}

async function runJob(job) {
  await mkdir(frontendPublicDir, { recursive: true });
  job.status = 'running';
  sendEvent(job, { type: 'status', message: 'Starting Blender', detail: BLENDER_MODE });

  if (BLENDER_MODE === 'mcp') {
    await runMcpJob(job);
    return;
  }

  const args = ['-b', '-P', scriptPath, '--', '--prompt', job.prompt, '--output', job.outputPath];

  const blender = spawn(BLENDER_PATH, args, { env: process.env });
  job.process = blender;

  blender.stdout.on('data', data => {
    const text = data.toString().trim();
    if (text) sendEvent(job, { type: 'status', message: text });
  });

  blender.stderr.on('data', data => {
    const text = data.toString().trim();
    if (text) sendEvent(job, { type: 'status', message: text });
  });

  blender.on('close', code => {
    if (code === 0) {
      sendEvent(job, {
        type: 'asset',
        message: 'GLB artifact ready',
        url: `/generated/${job.outputName}`
      });
      sendEvent(job, { type: 'complete', message: 'Generation complete' });
      job.status = 'complete';
    } else {
      sendEvent(job, { type: 'complete', message: 'Generation failed', detail: `Exit code ${code}` });
      job.status = 'failed';
    }
  });
}

async function runMcpJob(job) {
  try {
    const client = await getMcpClient();
    sendEvent(job, { type: 'status', message: 'Connecting to BlenderMCP' });
    await client.ensureInitialized();

    const toolsResponse = await client.listTools();
    const tools = toolsResponse.tools || [];

    const apiKey = process.env.CLAUDE_API_KEY ?? process.env.ANTHROPIC_API_KEY;
    const model = process.env.CLAUDE_MODEL ?? 'claude-3-haiku-20240307';

    if (!apiKey) {
      throw new Error('Claude API key missing (CLAUDE_API_KEY). Check your .env.local in the root.');
    }

    sendEvent(job, { type: 'status', message: 'Claude agent starting', detail: `Model: ${model}` });

    const messages = [
      {
        role: 'user',
        content: `Prompt: ${job.prompt}\n\nPlease build this scene in Blender. Start by clearing the scene, then create the objects and materials requested. You can use search tools to find assets or execute_blender_code for custom geometry. When finished, say "SCENE_COMPLETE".`
      }
    ];

    const system = `You are a professional Blender artist. Use the provided tools to create complex 3D scenes.
Always clear the scene first using execute_blender_code with 'import bpy; bpy.ops.object.select_all(action="SELECT"); bpy.ops.object.delete()'.
When you are done, end your response with "SCENE_COMPLETE".`;

    let turn = 0;
    const maxTurns = 8;

    while (turn < maxTurns) {
      turn++;
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model,
          max_tokens: 4000,
          system,
          tools: tools.map(t => ({
            name: t.name,
            description: t.description,
            input_schema: t.inputSchema
          })),
          messages
        })
      });

      if (!response.ok) throw new Error(`Claude API: ${await response.text()}`);

      const result = await response.json();
      messages.push({ role: 'assistant', content: result.content });

      const toolCalls = result.content.filter(c => c.type === 'tool_use');
      if (toolCalls.length === 0) {
        const text = result.content.find(c => c.type === 'text')?.text;
        if (text) sendEvent(job, { type: 'status', message: 'Claude', detail: text });
        if (text?.includes('SCENE_COMPLETE')) break;
        // If Claude stops without saying complete, we force break
        if (turn >= 2) break; 
        continue;
      }

      const toolResults = [];
      for (const toolCall of toolCalls) {
        sendEvent(job, { type: 'status', message: `Tool Call: ${toolCall.name}` });
        try {
          const toolOutput = await client.callTool(toolCall.name, toolCall.input);
          toolResults.push({ type: 'tool_result', tool_use_id: toolCall.id, content: JSON.stringify(toolOutput) });
        } catch (e) {
          toolResults.push({ type: 'tool_result', tool_use_id: toolCall.id, content: `Error: ${e.message}`, is_error: true });
        }
      }
      messages.push({ role: 'user', content: toolResults });
    }

    sendEvent(job, { type: 'status', message: 'Finalizing and exporting GLB' });
    const exportCode = `
import bpy
try:
    # Ensure any active mode is exited
    if bpy.context.object and bpy.context.object.mode != 'OBJECT':
        bpy.ops.object.mode_set(mode='OBJECT')
    bpy.ops.export_scene.gltf(filepath="${job.outputPath.replace(/\\/g, '/')}", export_format="GLB", export_apply=True, export_yup=True)
    print("DONE_EXPORT")
except Exception as e:
    print(f"EXPORT_FAIL: {e}")
`;
    await client.callTool('execute_blender_code', { code: exportCode, user_prompt: job.prompt });

    sendEvent(job, {
      type: 'asset',
      message: 'GLB artifact ready',
      url: `/generated/${job.outputName}`
    });
    sendEvent(job, { type: 'complete', message: 'Generation complete' });
    job.status = 'complete';

  } catch (error) {
    console.error('[MCP Job Error]', error);
    sendEvent(job, { type: 'complete', message: 'Generation failed', detail: error.message });
    job.status = 'failed';
  }
}

function handleSse(req, res, job) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });
  const send = e => res.write(`data: ${JSON.stringify(e)}\n\n`);
  job.events.forEach(send);
  job.listeners.add(send);
  req.on('close', () => job.listeners.delete(send));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  console.log(`[Backend] ${req.method} ${url.pathname}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': '*' });
    res.end();
    return;
  }

  if (req.method === 'POST' && url.pathname === '/generate') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { prompt } = JSON.parse(body);
        const job = createJob(prompt);
        runJob(job).catch(e => sendEvent(job, { type: 'complete', message: 'Failed', detail: e.message }));
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ jobId: job.id }));
      } catch (e) {
        res.writeHead(400, { 'Access-Control-Allow-Origin': '*' });
        res.end(e.message);
      }
    });
    return;
  }

  if (req.method === 'GET' && url.pathname.startsWith('/stream/')) {
    const job = jobs.get(url.pathname.split('/')[2]);
    if (!job) { res.writeHead(404); res.end(); return; }
    handleSse(req, res, job);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/mcp/status') {
    try {
      const client = await getMcpClient();
      await client.ensureInitialized();
      const { status, error, logs } = client.getStatus();
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ ok: status === 'ready', state: status, error, logs }));
    } catch (e) {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
    return;
  }

  // Serve static generated files
  if (req.method === 'GET' && url.pathname.startsWith('/generated/')) {
    const filePath = join(frontendPublicDir, url.pathname.replace('/generated/', ''));
    try {
      const data = await readFile(filePath);
      res.writeHead(200, { 'Content-Type': 'model/gltf-binary', 'Access-Control-Allow-Origin': '*' });
      res.end(data);
    } catch {
      res.writeHead(404, { 'Access-Control-Allow-Origin': '*' });
      res.end('Not found');
    }
    return;
  }

  res.writeHead(404, { 'Access-Control-Allow-Origin': '*' });
  res.end('Not found');
});

server.listen(PORT, () => console.log(`[WorldWeaver] Server running on http://localhost:${PORT}`));
