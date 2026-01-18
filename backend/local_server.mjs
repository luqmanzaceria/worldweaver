import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import crypto from 'node:crypto';
import { AccessToken } from 'livekit-server-sdk';
import { createMcpClient } from './mcp_client.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = dirname(__dirname);

// IMPORTANT: We write to the frontend's public directory so Vite can serve it
const frontendPublicDir = join(workspaceRoot, 'frontend', 'public', 'generated');
const worldsDir = join(workspaceRoot, 'frontend', 'public', 'worlds');
const scriptPath = join(workspaceRoot, 'tools', 'blender', 'generate_world.py');

// Store session histories: sessionId -> { history: [], versions: [] }
// A version is { id, prompt, glbUrl, blendPath }
const sessions = new Map();

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

function createJob(prompt, sessionId, parentVersionId, cameraHeight) {
  const id = crypto.randomBytes(8).toString('hex');
  const outputName = `worldweaver_${id}.glb`;
  const outputPath = join(frontendPublicDir, outputName);
  const blendName = `worldweaver_${id}.blend`;
  const blendPath = join(frontendPublicDir, blendName);
  
  const job = {
    id,
    prompt,
    sessionId: sessionId || crypto.randomBytes(4).toString('hex'),
    parentVersionId,
    cameraHeight,
    outputName,
    outputPath,
    blendPath,
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
    // Support all tools for full capability
    const tools = toolsResponse.tools || [];

    const apiKey = process.env.CLAUDE_API_KEY ?? process.env.ANTHROPIC_API_KEY;
    const model = process.env.CLAUDE_MODEL ?? 'claude-sonnet-4-5-20250929';

    if (!apiKey) {
      throw new Error('Claude API key missing (CLAUDE_API_KEY). Check your .env.local in the root.');
    }

    // Initialize or retrieve session
    if (!sessions.has(job.sessionId)) {
      sessions.set(job.sessionId, { history: [], versions: [] });
    }
    const session = sessions.get(job.sessionId);

    // If we have a parent version, restore its state AND its conversation history
    if (job.parentVersionId) {
      const parentIndex = session.versions.findIndex(v => v.id === job.parentVersionId);
      const parentVersion = session.versions[parentIndex];
      
      if (parentVersion && existsSync(parentVersion.blendPath)) {
        sendEvent(job, { type: 'status', message: 'Restoring state', detail: `Branching from ${job.parentVersionId}` });
        const restoreCode = `import bpy; bpy.ops.wm.open_mainfile(filepath="${parentVersion.blendPath.replace(/\\/g, '/')}")`;
        await client.callTool('execute_blender_code', { code: restoreCode, user_prompt: "Restore state" });
        
        // Truncate conversation history to the point where this version was created
        if (parentVersion.historyIndex !== undefined) {
          session.history = session.history.slice(0, parentVersion.historyIndex);
        }
        // Truncate versions to the point where we branched
        session.versions = session.versions.slice(0, parentIndex + 1);
      }
    } else if (session.versions.length > 0) {
      // If no parentVersionId is provided but session has history, it means we are editing the first message
      // or explicitly starting over. Clear everything.
      sendEvent(job, { type: 'status', message: 'Starting fresh branch' });
      session.history = [];
      session.versions = [];
    }

    sendEvent(job, { type: 'status', message: 'Claude agent starting', detail: `Model: ${model}` });

    const isFollowUp = !!job.parentVersionId || session.history.length > 0;

    // Build the messages array using the session history
    const messages = [
      ...session.history,
      {
        role: 'user',
        content: job.prompt
      }
    ];

    const system = `You are a professional Blender Technical Artist and Spatial Reasoning AI.
You have full access to the Blender Python API (bpy) and specialized tools for scene construction.

DESIGN PRINCIPLES:
1. SPATIAL ACCURACY: Camera is at 1.6m (eye level). All objects MUST be sized relative to this.
   - Doors: 2.1m high, 0.9m wide.
   - Tables: 0.75m high.
   - Chairs: 0.45m seat height.
   - Ceilings: 2.4m to 3.0m high.
2. ROBUST CODE: Prefer 'bpy.data' over 'bpy.ops' where possible. Always check for existing collections/materials before creating new ones.
3. SCENE STRUCTURE: Use logical collections. Name every object descriptively.
4. VISUAL FIDELITY: Always assign materials with appropriate colors, roughness (0.5 default), and metallic (0.0 default) values.
5. COORDINATES: Blender is Z-UP. The ground is Z=0.

OPERATIONAL PROTOCOL:
1. ANALYZE: If editing, run 'get_scene_info' or 'list_objects' first.
2. PLAN: Describe your architectural or spatial plan in one sentence.
3. EXECUTE: Write optimized, commented Python code.
4. REFLECT: If a tool returns an error or a render looks wrong, analyze and fix it.
5. FINALIZE: Only end with "SCENE_COMPLETE" when the task is fully achieved.

You are highly technical, precise, and spatially aware. Your goal is to create high-quality, architecturally sound 3D environments.`;

    let turn = 0;
    const maxTurns = 10; 

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
          max_tokens: 2000,
          system: [
            {
              type: 'text',
              text: system,
              cache_control: { type: 'ephemeral' } // Cache the system prompt
            }
          ],
          tools: tools.map((t, i) => ({
            name: t.name,
            description: t.description, 
            input_schema: t.inputSchema,
            // Cache the tools definition on the last tool to cover the whole block
            ...(i === tools.length - 1 ? { cache_control: { type: 'ephemeral' } } : {})
          })),
          messages
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error('[Claude API Error]', errText);
        throw new Error(`Claude API: ${errText}`);
      }

      const result = await response.json();
      messages.push({ role: 'assistant', content: result.content });

      // Handle reasoning and tool calls
      const textBlock = result.content.find(c => c.type === 'text');
      if (textBlock?.text) {
        sendEvent(job, { type: 'status', message: 'Claude Thinking', detail: textBlock.text });
      }

      const toolCalls = result.content.filter(c => c.type === 'tool_use');
      if (toolCalls.length === 0) {
        const text = result.content.find(c => c.type === 'text')?.text;
        if (text?.includes('SCENE_COMPLETE')) break;
        if (turn >= 2) break; 
        continue;
      }

      const toolResults = [];
      for (const toolCall of toolCalls) {
        sendEvent(job, { type: 'status', message: `Executing Tool: ${toolCall.name}` });
        try {
          const toolOutput = await client.callTool(toolCall.name, toolCall.input);
          
          let outputStr = JSON.stringify(toolOutput);
          if (outputStr.length > 20000) { 
            outputStr = outputStr.slice(0, 20000) + "... (truncated for context)";
          }
          toolResults.push({ type: 'tool_result', tool_use_id: toolCall.id, content: outputStr });
        } catch (e) {
          toolResults.push({ type: 'tool_result', tool_use_id: toolCall.id, content: `Error: ${e.message}`, is_error: true });
        }
      }
      messages.push({ role: 'user', content: toolResults });
    }

    // Update session history for next time
    // We keep full tool calls and results for better continuity
    let turnHistory = [...messages];
    if (turnHistory.length > 12) {
      turnHistory = turnHistory.slice(-12);
      // Ensure history starts with a 'user' role
      while (turnHistory.length > 0 && turnHistory[0].role !== 'user') {
        turnHistory.shift();
      }
    }
    session.history = turnHistory;

    sendEvent(job, { type: 'status', message: 'Finalizing and exporting' });
    const finalizeCode = `
import bpy
try:
    if bpy.context.object and bpy.context.object.mode != 'OBJECT':
        bpy.ops.object.mode_set(mode='OBJECT')
    # Save .blend for future reverts
    bpy.ops.wm.save_as_mainfile(filepath="${job.blendPath.replace(/\\/g, '/')}")
    # Export GLB for viewer
    bpy.ops.export_scene.gltf(filepath="${job.outputPath.replace(/\\/g, '/')}", export_format="GLB", export_apply=True, export_yup=True)
    print("DONE_FINALIZE")
except Exception as e:
    print(f"FINALIZE_FAIL: {e}")
`;
    await client.callTool('execute_blender_code', { code: finalizeCode, user_prompt: job.prompt });

    const version = {
      id: job.id,
      prompt: job.prompt,
      glbUrl: `/generated/${job.outputName}`,
      blendPath: job.blendPath,
      historyIndex: session.history.length // Store where we are in the conversation
    };
    session.versions.push(version);

    // Small delay to ensure file is flushed to disk before notifying frontend
    await new Promise(r => setTimeout(r, 200));

    sendEvent(job, {
      type: 'asset',
      message: 'GLB artifact ready',
      url: version.glbUrl,
      sessionId: job.sessionId,
      versionId: version.id,
      history: session.versions.map(v => ({ 
        id: v.id, 
        prompt: v.prompt,
        glbUrl: v.glbUrl
      }))
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

  if (req.method === 'GET' && url.pathname === '/token') {
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    const livekitUrl = process.env.LIVEKIT_URL;
    
    console.log(`[Backend] /token request. URL: ${livekitUrl}, Key: ${apiKey ? '***' + apiKey.slice(-4) : 'MISSING'}`);
    
    try {
      const roomName = url.searchParams.get('room') || 'worldweaver-room';
      const participantName = url.searchParams.get('participant') || `user-${crypto.randomBytes(4).toString('hex')}`;

      if (!apiKey || !apiSecret || !livekitUrl) {
        console.error('[Backend] LiveKit configuration missing (API_KEY, SECRET, or URL)');
        res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: 'LiveKit configuration missing on server' }));
        return;
      }

      const at = new AccessToken(apiKey, apiSecret, {
        identity: participantName,
      });
      at.addGrant({ roomJoin: true, room: roomName, canPublish: true, canSubscribe: true });

      const token = await at.toJwt();
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ token, serverUrl: livekitUrl }));
    } catch (e) {
      console.error('[Backend] Token generation error:', e);
      res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/generate') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { prompt, sessionId, parentVersionId, cameraHeight } = JSON.parse(body);
        const job = createJob(prompt, sessionId, parentVersionId, cameraHeight);
        runJob(job).catch(e => sendEvent(job, { type: 'complete', message: 'Failed', detail: e.message }));
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ jobId: job.id, sessionId: job.sessionId }));
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

  if (req.method === 'POST' && url.pathname === '/revert') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { sessionId, versionId } = JSON.parse(body);
        const session = sessions.get(sessionId);
        if (!session) throw new Error('Session not found');
        
        const versionIndex = session.versions.findIndex(v => v.id === versionId);
        if (versionIndex === -1) throw new Error('Version not found');
        
        const version = session.versions[versionIndex];
        const client = await getMcpClient();
        await client.ensureInitialized();
        
        // Physically revert Blender state immediately
        const restoreCode = `import bpy; bpy.ops.wm.open_mainfile(filepath="${version.blendPath.replace(/\\/g, '/')}")`;
        await client.callTool('execute_blender_code', { code: restoreCode, user_prompt: "Revert state" });
        
        // Update session history
        if (version.historyIndex !== undefined) {
          session.history = session.history.slice(0, version.historyIndex);
        }
        session.versions = session.versions.slice(0, versionIndex + 1);
        
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(400, { 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/worlds') {
    try {
      const files = await readdir(worldsDir);
      const glbFiles = files
        .filter(f => f.toLowerCase().endsWith('.glb'))
        .sort((a, b) => a.localeCompare(b));
      
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify(glbFiles));
    } catch (e) {
      console.error('Failed to list worlds:', e);
      res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: 'Failed to list worlds' }));
    }
    return;
  }

  // Serve static generated files
  if (req.method === 'GET' && url.pathname.startsWith('/generated/')) {
    const filePath = join(frontendPublicDir, url.pathname.replace('/generated/', ''));
    try {
      const data = await readFile(filePath);
      res.writeHead(200, { 
        'Content-Type': 'model/gltf-binary', 
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-cache' // Prevent browser caching of generated assets
      });
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
