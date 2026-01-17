export interface BlenderGenerationRequest {
  prompt: string;
  sessionId?: string;
  parentVersionId?: string;
}

export type BlenderGenerationEvent =
  | { type: 'status'; message: string; detail?: string }
  | { type: 'asset'; message: string; detail?: string; url?: string; sessionId?: string; versionId?: string; history?: { id: string; prompt: string }[] }
  | { type: 'complete'; message: string; detail?: string };

const USE_LOCAL_SERVER = import.meta.env.VITE_BLENDER_LOCAL === 'true';
const LOCAL_API_URL = import.meta.env.VITE_BLENDER_API_URL ?? 'http://localhost:8787';

/**
 * Frontend-facing bridge for Blender generation.
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

    try {
      const response = await fetch(`${LOCAL_API_URL}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          prompt, 
          sessionId: request.sessionId,
          parentVersionId: request.parentVersionId
        })
      });

      if (!response.ok) {
        const text = await response.text();
        yield { type: 'status', message: 'Generation request failed', detail: text };
        yield { type: 'complete', message: 'Generation failed' };
        return;
      }

      const data = await response.json();
      jobId = data.jobId;
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
