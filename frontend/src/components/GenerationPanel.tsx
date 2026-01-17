import React, { useCallback, useRef, useState } from 'react';
import { BlenderGenerationEvent, createBlenderGenerationStream } from '../engine/blender_bridge';
import { getSimulation } from '../engine/simulation_instance';
import { SceneLoader } from '../engine/scene_loader';

interface GenerationPanelProps {
  onAsset?: (url: string) => void;
}

interface Version {
  id: string;
  prompt: string;
}

const GenerationPanel: React.FC<GenerationPanelProps> = ({ onAsset }) => {
  const [prompt, setPrompt] = useState('');
  const [status, setStatus] = useState<'idle' | 'running' | 'complete' | 'cancelled'>('idle');
  const [events, setEvents] = useState<BlenderGenerationEvent[]>([]);
  const [sessionId, setSessionId] = useState<string | undefined>(undefined);
  const [history, setHistory] = useState<Version[]>([]);
  const [currentVersionId, setCurrentVersionId] = useState<string | undefined>(undefined);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  
  const cancelRef = useRef<() => void>(() => undefined);
  const scrollRef = useRef<HTMLDivElement>(null);
  const localMode = import.meta.env.VITE_BLENDER_LOCAL === 'true';
  const apiBase = import.meta.env.VITE_BLENDER_API_URL ?? 'http://localhost:8787';

  React.useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events]);

  const handleGenerate = useCallback(async (customPrompt?: string, parentId?: string) => {
    const targetPrompt = customPrompt || prompt;
    if (!targetPrompt.trim()) return;

    setStatus('running');
    setEvents([]);

    const { stream, cancel } = createBlenderGenerationStream({ 
      prompt: targetPrompt,
      sessionId,
      parentVersionId: parentId
    });
    
    cancelRef.current = cancel;
    const sceneLoader = new SceneLoader();

    for await (const event of stream) {
      setEvents(prev => [...prev, event]);
      
      if (event.type === 'asset' && event.url) {
        if (event.sessionId) setSessionId(event.sessionId);
        if (event.versionId) setCurrentVersionId(event.versionId);
        
        if (event.history) {
          setHistory(event.history.map(v => ({ id: v.id, prompt: v.prompt })));
        }

        const resolvedUrl = event.url.startsWith('http')
          ? event.url
          : `${apiBase}${event.url.startsWith('/') ? '' : '/'}${event.url}`;
        
        onAsset?.(resolvedUrl);
        try {
          await sceneLoader.loadGeneratedAsset(resolvedUrl, getSimulation());
        } catch (error) {
          console.error('Failed to load asset:', error);
        }
      }
      
      if (event.type === 'complete') {
        setStatus('complete');
        // Only clear the main prompt if it was the one submitted
        if (!customPrompt) setPrompt(''); 
        setEditingId(null);
      }
    }
  }, [prompt, sessionId, onAsset, apiBase]);

  const handleRevert = useCallback((version: Version) => {
    setCurrentVersionId(version.id);
    handleGenerate(`Restore state to: ${version.prompt}`, version.id);
  }, [handleGenerate]);

  const startEdit = (v: Version) => {
    setEditingId(v.id);
    setEditValue(v.prompt);
  };

  const handleEditSubmit = (v: Version) => {
    if (!editValue.trim()) {
      setEditingId(null);
      return;
    }
    const index = history.findIndex(item => item.id === v.id);
    // When editing, we revert to the parent of the version we are editing
    const parentId = index > 0 ? history[index - 1].id : undefined;
    
    // Clear editing state and truncate history locally for immediate feedback
    setEditingId(null);
    setHistory(prev => prev.slice(0, index));
    
    handleGenerate(editValue, parentId);
  };

  const handleCancel = useCallback(() => {
    cancelRef.current();
    setStatus('cancelled');
  }, []);

  return (
    <div className="absolute top-4 right-4 w-[380px] rounded-lg border border-zinc-700 bg-zinc-900/90 p-4 text-zinc-100 shadow-2xl backdrop-blur-md pointer-events-auto flex flex-col max-h-[90vh]">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">World Weaver</h2>
        <div className="rounded bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-500">
          Agent Mode
        </div>
      </div>

      {/* History / Versioning */}
      {history.length > 0 && (
        <div className="mt-4 space-y-2 overflow-y-auto border-b border-zinc-800 pb-4 mb-2 max-h-64 pr-1">
          <div className="text-[10px] uppercase text-zinc-600 font-bold flex justify-between">
            <span>History</span>
            <span className="opacity-50 italic">Click to edit</span>
          </div>
          {history.map((v) => (
            <div key={v.id} className="group relative">
              {editingId === v.id ? (
                <div className="space-y-2 p-2 bg-zinc-800/50 rounded border border-emerald-500/30">
                  <textarea
                    autoFocus
                    value={editValue}
                    onChange={e => setEditValue(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleEditSubmit(v);
                      }
                    }}
                    className="w-full bg-zinc-950 text-xs p-2 rounded focus:outline-none focus:ring-1 focus:ring-emerald-500/50"
                    rows={2}
                  />
                  <div className="flex gap-2 justify-end">
                    <button 
                      onClick={() => setEditingId(null)}
                      className="text-[10px] text-zinc-500 hover:text-zinc-300"
                    >
                      Cancel
                    </button>
                    <button 
                      onClick={() => handleEditSubmit(v)}
                      className="text-[10px] bg-emerald-600 px-2 py-1 rounded text-white hover:bg-emerald-500 transition"
                    >
                      Save & Submit
                    </button>
                  </div>
                </div>
              ) : (
                <div className={`flex gap-2 items-start group`}>
                   <button
                    onClick={() => handleRevert(v)}
                    className={`flex-1 text-left p-2 rounded text-xs transition border ${
                      currentVersionId === v.id 
                        ? 'bg-emerald-500/10 border-emerald-500/50 text-emerald-400' 
                        : 'bg-zinc-950/40 border-zinc-800 text-zinc-400 hover:border-zinc-700'
                    }`}
                  >
                    <div className="truncate font-medium">{v.prompt}</div>
                  </button>
                  <button 
                    onClick={() => startEdit(v)}
                    className="mt-2 opacity-0 group-hover:opacity-100 p-1 hover:bg-zinc-800 rounded text-zinc-500 transition"
                    title="Edit prompt"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                    </svg>
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Main Input */}
      <div className="mt-2">
        <textarea
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleGenerate(undefined, currentVersionId);
            }
            e.stopPropagation();
          }}
          placeholder={history.length > 0 ? "Ask to change something..." : "Describe a world to build..."}
          rows={3}
          className="w-full rounded-md border border-zinc-700 bg-zinc-950/80 p-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 focus:outline-none transition shadow-inner"
        />
      </div>

      <div className="mt-3 flex gap-2">
        <button
          onClick={() => handleGenerate(undefined, currentVersionId)}
          disabled={status === 'running' || !prompt.trim()}
          className="flex-1 rounded-md bg-emerald-500 px-3 py-2 text-sm font-bold text-zinc-950 transition hover:bg-emerald-400 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-30 disabled:cursor-not-allowed disabled:scale-100 shadow-[0_4px_12px_rgba(16,185,129,0.2)]"
        >
          {status === 'running' ? 'Thinking...' : history.length > 0 ? 'Update' : 'Generate'}
        </button>
        {status === 'running' && (
          <button
            onClick={handleCancel}
            className="rounded-md bg-zinc-800 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-700 transition"
          >
            Cancel
          </button>
        )}
      </div>

      {/* Stream Logs */}
      <div className="mt-4 flex-1 overflow-hidden flex flex-col min-h-0">
        <div className="mb-2 text-[10px] uppercase tracking-wider text-zinc-500 font-bold flex items-center gap-2">
          <span>Live Stream</span>
          {status === 'running' && <span className="flex h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />}
        </div>
        <div 
          ref={scrollRef} 
          className="flex-1 space-y-2 overflow-y-auto pr-2 scrollbar-thin scrollbar-track-zinc-950 scrollbar-thumb-zinc-700"
        >
          {events.length === 0 && (
            <div className="text-zinc-600 text-xs italic">Awaiting your command...</div>
          )}
          {events.map((event, index) => (
            <div key={index} className="flex gap-2 text-[11px] animate-in fade-in slide-in-from-top-1 duration-300">
              <div className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${
                event.type === 'asset' ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.5)]' : 'bg-zinc-600'
              }`} />
              <div className="flex-1">
                <span className="text-zinc-300 font-medium">{event.message}</span>
                {event.detail && (
                  <div className="mt-0.5 text-zinc-500 break-words opacity-80 leading-relaxed font-mono text-[10px]">
                    {event.detail}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default GenerationPanel;
