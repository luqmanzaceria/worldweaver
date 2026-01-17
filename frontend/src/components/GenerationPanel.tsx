import React, { useCallback, useRef, useState } from 'react';
import { BlenderGenerationEvent, createBlenderGenerationStream } from '../engine/blender_bridge';
import { getSimulation } from '../engine/simulation_instance';
import { SceneLoader } from '../engine/scene_loader';

const GenerationPanel: React.FC = () => {
  const [prompt, setPrompt] = useState('A small coastal village with docks and warehouses');
  const [status, setStatus] = useState<'idle' | 'running' | 'complete' | 'cancelled'>('idle');
  const [events, setEvents] = useState<BlenderGenerationEvent[]>([]);
  const cancelRef = useRef<() => void>(() => undefined);
  const scrollRef = useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events]);

  const handleGenerate = useCallback(async () => {
    setStatus('running');
    setEvents([]);

    const { stream, cancel } = createBlenderGenerationStream({ prompt });
    cancelRef.current = cancel;
    const sceneLoader = new SceneLoader();

    for await (const event of stream) {
      setEvents(prev => [...prev, event]);
      if (event.type === 'asset' && event.url) {
        try {
          await sceneLoader.loadGeneratedAsset(event.url, getSimulation());
          setEvents(prev => [
            ...prev,
            { type: 'status', message: 'Loaded generated asset', detail: event.url }
          ]);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          setEvents(prev => [
            ...prev,
            { type: 'status', message: 'Failed to load generated asset', detail: message }
          ]);
        }
      }
      if (event.type === 'complete') {
        setStatus('complete');
      }
    }
  }, [prompt]);

  const handleCancel = useCallback(() => {
    cancelRef.current();
    setStatus('cancelled');
  }, []);

  return (
    <div className="absolute top-4 right-4 w-[360px] rounded-lg border border-zinc-700 bg-zinc-900/80 p-4 text-zinc-100 shadow-xl backdrop-blur-md pointer-events-auto">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">World Generation</h2>
      <p className="mt-2 text-sm text-zinc-300">
        Describe the environment to generate. The stream reflects the Blender job progress.
      </p>

      <div className="mt-3">
        <label className="text-xs text-zinc-400">Generation prompt</label>
        <textarea
          value={prompt}
          onChange={event => setPrompt(event.target.value)}
          onKeyDown={e => e.stopPropagation()} // Prevent WASD from triggering controls
          rows={3}
          className="mt-2 w-full rounded-md border border-zinc-700 bg-zinc-950/60 p-2 text-sm text-zinc-100 focus:border-emerald-400 focus:outline-none"
        />
      </div>

      <div className="mt-3 flex gap-2">
        <button
          onClick={handleGenerate}
          disabled={status === 'running'}
          className="flex-1 rounded-md bg-emerald-500/90 px-3 py-2 text-sm font-semibold text-zinc-950 transition disabled:cursor-not-allowed disabled:bg-emerald-500/40"
        >
          {status === 'running' ? 'Generating…' : 'Generate'}
        </button>
        <button
          onClick={handleCancel}
          disabled={status !== 'running'}
          className="rounded-md bg-zinc-700 px-3 py-2 text-sm text-zinc-100 transition disabled:cursor-not-allowed disabled:bg-zinc-800"
        >
          Cancel
        </button>
      </div>

      <div className="mt-4 rounded-md border border-zinc-800 bg-zinc-950/50 p-3">
        <div className="mb-2 text-xs uppercase tracking-wide text-zinc-500">Blender stream</div>
        <div ref={scrollRef} className="max-h-40 space-y-1 overflow-y-auto text-xs text-zinc-300">
          {events.length === 0 && (
            <div className="text-zinc-600">No generation events yet.</div>
          )}
          {events.map((event, index) => (
            <div key={`${event.type}-${index}`} className="flex items-start gap-2">
              <span className="mt-0.5 h-1.5 w-1.5 rounded-full bg-emerald-400" />
              <div>
                <div className="font-medium text-zinc-200">{event.message}</div>
                {event.detail && <div className="text-[11px] text-zinc-500">{event.detail}</div>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default GenerationPanel;

