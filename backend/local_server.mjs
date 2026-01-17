import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdir, readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import crypto from 'node:crypto';
import { createMcpClient } from './mcp_client.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = dirname(__dirname);
const publicDir = join(workspaceRoot, 'public', 'generated');
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
  const outputPath = join(publicDir, outputName);
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
  const envPaths = [join(workspaceRoot, '.env.local'), join(workspaceRoot, '.env')];
  for (const envPath of envPaths) {
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
    } catch {
      // Ignore missing env files
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
  await mkdir(publicDir, { recursive: true });
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
    if (text) {
      sendEvent(job, { type: 'status', message: text });
    }
  });

  blender.stderr.on('data', data => {
    const text = data.toString().trim();
    if (text) {
      sendEvent(job, { type: 'status', message: text });
    }
  });

  blender.on('close', code => {
    if (code === 0) {
      sendEvent(job, {
        type: 'asset',
        message: 'GLB artifact ready',
        url: `http://localhost:${PORT}/generated/${job.outputName}`
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
  const client = await getMcpClient();
  sendEvent(job, { type: 'status', message: 'Connecting to BlenderMCP' });
  await client.ensureInitialized();

  sendEvent(job, { type: 'status', message: 'Generating scene via MCP' });
  const claudeCode = await getClaudeBlenderCode(job, job.prompt);
  const python = buildScenePythonFromClaude(job.prompt, job.outputPath, claudeCode);
  sendEvent(job, { type: 'status', message: 'Claude code', detail: claudeCode.slice(0, 2000) });

  try {
    const result = await client.callTool('execute_blender_code', {
      code: python,
      user_prompt: job.prompt
    });
    
    // Check if result indicates success
    sendEvent(job, { type: 'status', message: 'Blender execution finished', detail: JSON.stringify(result) });

    try {
      const sceneInfo = await client.callTool('get_scene_info', { user_prompt: job.prompt });
      sendEvent(job, { type: 'status', message: 'Scene updated', detail: JSON.stringify(sceneInfo) });
    } catch (error) {
      sendEvent(job, {
        type: 'status',
        message: 'Scene info unavailable',
        detail: error instanceof Error ? error.message : String(error)
      });
    }
    
    sendEvent(job, { type: 'status', message: 'Exported GLB via MCP' });
    sendEvent(job, {
      type: 'asset',
      message: 'GLB artifact ready',
      url: `http://localhost:${PORT}/generated/${job.outputName}`
    });
    sendEvent(job, { type: 'complete', message: 'Generation complete' });
    job.status = 'complete';
  } catch (error) {
    sendEvent(job, {
      type: 'complete',
      message: 'Generation failed',
      detail: error instanceof Error ? error.message : String(error)
    });
    job.status = 'failed';
  }
}

async function getClaudeBlenderCode(job, prompt) {
  const apiKey = process.env.CLAUDE_API_KEY ?? process.env.ANTHROPIC_API_KEY;
  const model = process.env.CLAUDE_MODEL ?? 'claude-3-haiku-20240307';
  if (!apiKey) {
    sendEvent(job, { type: 'status', message: 'Claude API key missing', detail: 'Falling back to basic scene.' });
    return defaultBlenderCode(prompt);
  }

  const system = `You are a Blender Python scene author. Output ONLY Python code that uses bpy to create geometry.
- Do not include markdown fences.
- Do not call export or save. We'll handle exporting.
- Use only bpy, math, random.
- Available mesh primitives:
  bpy.ops.mesh.primitive_plane_add(size=20, location=(0,0,0))
  bpy.ops.mesh.primitive_cube_add(size=2, location=(0,0,0))
  bpy.ops.mesh.primitive_uv_sphere_add(radius=1, location=(0,0,0))
  bpy.ops.mesh.primitive_cylinder_add(radius=1, depth=2, location=(0,0,0))
  bpy.ops.mesh.primitive_cone_add(radius1=1, depth=2, location=(0,0,0))
- For pyramids, use primitive_cone_add(vertices=4).
- Keep it deterministic by seeding random with a fixed integer at the top.
- Keep object counts reasonable (<80 objects).`;

  const user = `Prompt: ${prompt}
Create a scene that matches this prompt. Include a ground plane and several distinct objects.`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model,
        max_tokens: 1000,
        temperature: 0.2,
        system,
        messages: [{ role: 'user', content: user }]
      })
    });

    if (!response.ok) {
      const text = await response.text();
      sendEvent(job, { type: 'status', message: 'Claude request failed', detail: text });
      return defaultBlenderCode(prompt);
    }

    const data = await response.json();
    const content = data?.content?.[0]?.text ?? '';
    sendEvent(job, { type: 'status', message: 'Claude response', detail: content });
    return sanitizeClaudeCode(content);
  } catch (error) {
    sendEvent(job, {
      type: 'status',
      message: 'Claude plan failed',
      detail: error instanceof Error ? error.message : String(error)
    });
    return defaultBlenderCode(prompt);
  }
}

function sanitizeClaudeCode(text) {
  const trimmed = String(text ?? '').trim();
  const fenceMatch = trimmed.match(/```(?:python)?\n([\s\S]*?)```/i);
  if (fenceMatch) {
    return fenceMatch[1].trim();
  }
  return trimmed;
}

function defaultBlenderCode(prompt) {
  const safePrompt = String(prompt ?? '').replace(/"/g, '\\"');
  return `
import random
random.seed(42)
bpy.ops.mesh.primitive_plane_add(size=20, location=(0, 0, 0))
bpy.context.active_object.name = "WW_Ground"
bpy.ops.mesh.primitive_cube_add(size=2, location=(4, 0, 1))
bpy.context.active_object.name = "WW_Block_A"
bpy.ops.mesh.primitive_cube_add(size=2, location=(-4, 0, 1))
bpy.context.active_object.name = "WW_Block_B"
bpy.context.scene["ww_prompt"] = "${safePrompt}"
`.trim();
}

function buildScenePythonFromClaude(prompt, outputPath, claudeCode) {
  const safePrompt = String(prompt ?? '').replace(/"/g, '\\"');
  return `
import bpy
import math
import random

def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()

try:
    clear_scene()
    # Claude-generated scene code
    random.seed(42)
    
${claudeCode.split('\n').map(line => '    ' + line).join('\n')}

    bpy.context.scene["ww_prompt"] = "${safePrompt}"
except Exception as e:
    print(f"Claude code execution failed: {e}")

# Always try to export, even if Claude code partially failed
try:
    bpy.ops.export_scene.gltf(filepath="${outputPath}", export_format="GLB", export_apply=True, export_yup=True)
except Exception as e:
    print(f"GLB Export failed: {e}")
`;
}

function handleSse(req, res, job) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });

  const send = event => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  job.events.forEach(send);
  job.listeners.add(send);

  req.on('close', () => {
    job.listeners.delete(send);
  });
}

async function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end();
    return;
  }

  if (req.method === 'POST' && url.pathname === '/generate') {
    try {
      const body = await parseBody(req);
      const prompt = String(body.prompt ?? '').trim();
      if (!prompt) {
        res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: 'Prompt required' }));
        return;
      }

      const job = createJob(prompt);
      runJob(job).catch(error => {
        sendEvent(job, { type: 'complete', message: 'Generation failed', detail: error.message });
      });

      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ jobId: job.id }));
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }

  if (req.method === 'GET' && url.pathname.startsWith('/stream/')) {
    const jobId = url.pathname.split('/')[2];
    const job = jobs.get(jobId);
    if (!job) {
      res.writeHead(404, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: 'Job not found' }));
      return;
    }
    handleSse(req, res, job);
    return;
  }

  if (req.method === 'POST' && url.pathname.startsWith('/cancel/')) {
    const jobId = url.pathname.split('/')[2];
    const job = jobs.get(jobId);
    if (job?.process) {
      job.process.kill('SIGTERM');
      sendEvent(job, { type: 'complete', message: 'Generation cancelled' });
      job.status = 'cancelled';
    }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ ok: true }));
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
      client.ensureInitialized().catch(() => undefined);
      const { status, error, logs } = client.getStatus();
      if (status !== 'ready') {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ ok: false, state: status, error, logs }));
        return;
      }
      const tools = await client.listTools();
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ ok: true, state: status, tools, logs }));
    } catch (error) {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ ok: false, state: 'error', error: error instanceof Error ? error.message : String(error) }));
    }
    return;
  }

  if (req.method === 'GET' && url.pathname.startsWith('/generated/')) {
    const fileName = url.pathname.replace('/generated/', '');
    const filePath = join(publicDir, fileName);
    try {
      const data = await readFile(filePath);
      res.writeHead(200, {
        'Content-Type': 'model/gltf-binary',
        'Access-Control-Allow-Origin': '*'
      });
      res.end(data);
    } catch {
      res.writeHead(404, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: 'File not found' }));
    }
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, () => {
  console.log(`[WorldWeaver] Blender local server running on http://localhost:${PORT}`);
});
