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

function createJob(prompt, sessionId, parentVersionId) {
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
    // Filter tools to only include scene-building essentials to save tokens
    const essentialTools = ['execute_blender_code', 'get_scene_info', 'search_polyhaven', 'import_asset', 'list_objects'];
    const tools = (toolsResponse.tools || []).filter(t => essentialTools.includes(t.name));

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

    const system = `You are a professional Blender artist.
${isFollowUp ? 'You are EDITING an existing scene. The previous conversation contains the context of what has been built.' : 'Clear the scene first with "import bpy; bpy.ops.object.select_all(action=\'SELECT\'); bpy.ops.object.delete()"'}
Use execute_blender_code for all actions. End with "SCENE_COMPLETE".`;

    let turn = 0;
    const maxTurns = 6; 

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
          max_tokens: 1500,
          system: [
            {
              type: 'text',
              text: system,
              cache_control: { type: 'ephemeral' } // Cache the system prompt
            }
          ],
          tools: tools.map((t, i) => ({
            name: t.name,
            description: t.description.slice(0, 500),
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

      const toolCalls = result.content.filter(c => c.type === 'tool_use');
      if (toolCalls.length === 0) {
        const text = result.content.find(c => c.type === 'text')?.text;
        if (text) sendEvent(job, { type: 'status', message: 'Claude', detail: text });
        if (text?.includes('SCENE_COMPLETE')) break;
        if (turn >= 2) break; 
        continue;
      }

      const toolResults = [];
      for (const toolCall of toolCalls) {
        sendEvent(job, { type: 'status', message: `Tool: ${toolCall.name}` });
        try {
          const toolOutput = await client.callTool(toolCall.name, toolCall.input);
          // Truncate tool output to avoid token bloat
          let outputStr = JSON.stringify(toolOutput);
          if (outputStr.length > 2000) {
            outputStr = outputStr.slice(0, 2000) + "... (truncated)";
          }
          toolResults.push({ type: 'tool_result', tool_use_id: toolCall.id, content: outputStr });
        } catch (e) {
          toolResults.push({ type: 'tool_result', tool_use_id: toolCall.id, content: `Error: ${e.message}`, is_error: true });
        }
      }
      messages.push({ role: 'user', content: toolResults });
    }

    // Update session history for next time
    // We only keep the original prompts and final assistant responses.
    // We STRIP intermediate tool use/results to avoid token bloat and malformed history.
    const turnHistory = [];
    for (const m of messages) {
      // Keep original user prompts
      if (m.role === 'user' && typeof m.content === 'string') {
        turnHistory.push(m);
      }
      // Keep final assistant responses (the ones without tool calls)
      if (m.role === 'assistant' && Array.isArray(m.content)) {
        const hasToolUse = m.content.some(c => c.type === 'tool_use');
        if (!hasToolUse) {
          turnHistory.push(m);
        }
      }
    }
    // Keep only the last 3 turns (6 messages)
    session.history = turnHistory.slice(-6);

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

  if (req.method === 'POST' && url.pathname === '/generate') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { prompt, sessionId, parentVersionId } = JSON.parse(body);
        const job = createJob(prompt, sessionId, parentVersionId);
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
