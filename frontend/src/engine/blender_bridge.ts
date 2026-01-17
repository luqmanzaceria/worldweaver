export interface BlenderGenerationRequest {
  prompt: string;
}

export type BlenderGenerationEvent =
  | { type: 'status'; message: string; detail?: string }
  | { type: 'asset'; message: string; detail?: string; url?: string }
  | { type: 'complete'; message: string; detail?: string };

const USE_LOCAL_SERVER = import.meta.env.VITE_BLENDER_LOCAL === 'true';
const LOCAL_API_URL = import.meta.env.VITE_BLENDER_API_URL ?? 'http://localhost:8787';

/**
 * Frontend-facing bridge for Blender generation.
 * The browser cannot execute Blender, so this exposes a streaming interface
 * that can be wired to MCP or a backend worker later.
 */
export function createBlenderGenerationStream(request: BlenderGenerationRequest): {
  stream: AsyncGenerator<BlenderGenerationEvent>;
  cancel: () => void;
} {
  if (USE_LOCAL_SERVER) {
    return createLocalServerStream(request);
  }

  let cancelled = false;

  async function* generator(): AsyncGenerator<BlenderGenerationEvent> {
    const prompt = request.prompt.trim();
    if (!prompt) {
      yield { type: 'status', message: 'Prompt required', detail: 'Please describe a world to generate.' };
      yield { type: 'complete', message: 'Generation cancelled', detail: 'No prompt provided.' };
      return;
    }

    yield {
      type: 'status',
      message: 'Using mock generator',
      detail: 'Set VITE_BLENDER_LOCAL=true to use the local Blender server.'
    };

    const steps: BlenderGenerationEvent[] = [
      { type: 'status', message: 'Queued generation job', detail: `Prompt: ${prompt}` },
      { type: 'status', message: 'Spawning Blender worker', detail: 'Preparing headless pipeline' },
      { type: 'status', message: 'Blocking out scene', detail: 'Generating terrain and landmarks' },
      { type: 'status', message: 'Placing assets', detail: 'Applying layout constraints' },
      { type: 'status', message: 'Baking lighting probes', detail: 'Optimizing for runtime' },
      { type: 'status', message: 'Exporting GLB', detail: 'Packaging assets' },
      { type: 'asset', message: 'GLB artifact ready', detail: 'Awaiting ingestion', url: '/assets/glb/generated_world.glb' },
      { type: 'complete', message: 'Generation complete', detail: 'Ready to import into the scene.' }
    ];

    for (const step of steps) {
      if (cancelled) {
        yield { type: 'complete', message: 'Generation cancelled', detail: 'User requested stop.' };
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 650));
      yield step;
    }
  }

  return {
    stream: generator(),
    cancel: () => {
      cancelled = true;
    }
  };
}

function createLocalServerStream(request: BlenderGenerationRequest): {
  stream: AsyncGenerator<BlenderGenerationEvent>;
  cancel: () => void;
} {
  let cancelled = false;
  let jobId: string | null = null;
  let eventSource: EventSource | null = null;

  async function* generator(): AsyncGenerator<BlenderGenerationEvent> {
    const prompt = request.prompt.trim();
    if (!prompt) {
      yield { type: 'status', message: 'Prompt required', detail: 'Please describe a world to generate.' };
      yield { type: 'complete', message: 'Generation cancelled', detail: 'No prompt provided.' };
      return;
    }

    yield { type: 'status', message: 'Contacting local Blender server', detail: LOCAL_API_URL };
    try {
      const health = await fetchWithTimeout(`${LOCAL_API_URL}/health`, 1500);
      if (!health.ok) {
        const text = await health.text();
        yield { type: 'status', message: 'Local server not ready', detail: text };
        yield { type: 'complete', message: 'Generation failed' };
        return;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Health check failed';
      yield { type: 'status', message: 'Local server not reachable', detail: message };
      yield { type: 'complete', message: 'Generation failed' };
      return;
    }

    try {
      const response = await fetch(`${LOCAL_API_URL}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt })
      });

      if (!response.ok) {
        const text = await response.text();
        yield { type: 'status', message: 'Generation request failed', detail: text };
        yield { type: 'complete', message: 'Generation failed' };
        return;
      }

      const data = await response.json();
      jobId = data.jobId;
      if (!jobId) {
        yield { type: 'status', message: 'Generation request failed', detail: 'Missing jobId' };
        yield { type: 'complete', message: 'Generation failed' };
        return;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to reach local server';
      yield { type: 'status', message: 'Generation request failed', detail: message };
      yield { type: 'complete', message: 'Generation failed' };
      return;
    }

    const queue: BlenderGenerationEvent[] = [];
    let done = false;
    let resolveNext: ((value: IteratorResult<BlenderGenerationEvent>) => void) | null = null;

    const push = (event: BlenderGenerationEvent) => {
      if (resolveNext) {
        resolveNext({ value: event, done: false });
        resolveNext = null;
      } else {
        queue.push(event);
      }
      if (event.type === 'complete') {
        done = true;
      }
    };

    eventSource = new EventSource(`${LOCAL_API_URL}/stream/${jobId}`);
    eventSource.onmessage = event => {
      try {
        const parsed = JSON.parse(event.data) as BlenderGenerationEvent;
        push(parsed);
      } catch {
        push({ type: 'status', message: event.data });
      }
    };
    eventSource.onerror = () => {
      push({ type: 'complete', message: 'Generation failed', detail: 'Stream disconnected.' });
      eventSource?.close();
    };

    while (!cancelled) {
      if (queue.length > 0) {
        yield queue.shift()!;
        continue;
      }
      if (done) return;
      const nextEvent = await new Promise<IteratorResult<BlenderGenerationEvent>>(resolve => {
        resolveNext = resolve;
      });
      yield nextEvent.value;
    }
  }

  return {
    stream: generator(),
    cancel: () => {
      cancelled = true;
      if (jobId) {
        fetch(`${LOCAL_API_URL}/cancel/${jobId}`, { method: 'POST' }).catch(() => undefined);
      }
      eventSource?.close();
    }
  };
}

async function fetchWithTimeout(url: string, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

