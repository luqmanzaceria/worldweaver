import React, { useCallback, useRef, useState } from 'react';
import { BlenderGenerationEvent, createBlenderGenerationStream } from '../engine/blender_bridge';
import { getSimulation } from '../engine/simulation_instance';
import { SceneLoader } from '../engine/scene_loader';
import { RotateCcw, Upload, FolderOpen } from 'lucide-react';
import { PLAYER_HEIGHT } from '../constants/camera';
import WorldPicker from './WorldPicker';

interface GenerationPanelProps {
  onAsset?: (url: string) => void;
  onWorldLoaded?: (worldName?: string) => void;
}

interface Version {
  id: string;
  prompt: string;
  glbUrl: string;
}

const GenerationPanel: React.FC<GenerationPanelProps> = ({ onAsset, onWorldLoaded }) => {
  const [prompt, setPrompt] = useState('');
  const [status, setStatus] = useState<'idle' | 'running' | 'complete' | 'cancelled'>('idle');
  const [events, setEvents] = useState<BlenderGenerationEvent[]>([]);
  const [sessionId, setSessionId] = useState<string | undefined>(undefined);
  const [history, setHistory] = useState<Version[]>([]);
  const [currentVersionId, setCurrentVersionId] = useState<string | undefined>(undefined);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [isWorldPickerOpen, setIsWorldPickerOpen] = useState(false);
  
  const cancelRef = useRef<() => void>(() => undefined);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
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
      parentVersionId: parentId,
      cameraHeight: PLAYER_HEIGHT
    });
    
    cancelRef.current = cancel;
    const sceneLoader = new SceneLoader();

    for await (const event of stream) {
      setEvents(prev => [...prev, event]);
      
      if (event.type === 'asset' && event.url) {
        if (event.sessionId) setSessionId(event.sessionId);
        if (event.versionId) setCurrentVersionId(event.versionId);
        
        if (event.history) {
          setHistory(event.history as Version[]);
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

  const handleViewVersion = useCallback((version: Version) => {
    setCurrentVersionId(version.id);
    const resolvedUrl = version.glbUrl.startsWith('http')
      ? version.glbUrl
      : `${apiBase}${version.glbUrl.startsWith('/') ? '' : '/'}${version.glbUrl}`;
    onAsset?.(resolvedUrl);
    
    setEvents(prev => [
      ...prev, 
      { type: 'status', message: 'Switched view to version', detail: version.prompt }
    ]);
  }, [onAsset, apiBase]);

  const handleRevert = useCallback(async (version: Version) => {
    const index = history.findIndex(v => v.id === version.id);
    if (index === -1 || !sessionId) return;
    
    setStatus('running');
    setEvents(prev => [...prev, { type: 'status', message: 'Reverting state...', detail: version.prompt }]);

    try {
      const response = await fetch(`${apiBase}/revert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, versionId: version.id })
      });

      if (!response.ok) throw new Error(await response.text());

      // Success - update local state
      setCurrentVersionId(version.id);
      setHistory(prev => prev.slice(0, index + 1));
      handleViewVersion(version);
      
      setEvents(prev => [
        ...prev,
        { type: 'status', message: 'Reverted successfully', detail: `Future prompts will branch from: ${version.prompt}` }
      ]);
      setStatus('complete');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Revert failed';
      setEvents(prev => [...prev, { type: 'status', message: 'Revert failed', detail: message }]);
      setStatus('idle');
    }
  }, [history, sessionId, apiBase, handleViewVersion]);

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
    const parentId = index > 0 ? history[index - 1].id : undefined;
    
    // Optimistically update the prompt in history and truncate future branches
    const updatedPrompt = editValue;
    setEditingId(null);
    setHistory(prev => {
      const next = prev.slice(0, index + 1);
      next[index] = { ...next[index], prompt: updatedPrompt };
      return next;
    });
    
    handleGenerate(updatedPrompt, parentId);
  };

  const handleCancel = useCallback(() => {
    cancelRef.current();
    setStatus('cancelled');
  }, []);

  const handleFileUpload = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Create a URL for the local file
    const objectUrl = URL.createObjectURL(file);
    
    // Load the asset
    onAsset?.(objectUrl);
    
    const simulation = getSimulation();
    const world = simulation.getWorld();
    if (world.clear) {
      world.clear();
    }

    // Also load into the simulation
    const sceneLoader = new SceneLoader();
    sceneLoader.loadGeneratedAsset(objectUrl, simulation)
      .catch(error => {
        console.error('Failed to load uploaded asset:', error);
        setEvents(prev => [...prev, { 
          type: 'status', 
          message: 'Failed to load file', 
          detail: error instanceof Error ? error.message : String(error) 
        }]);
      });

    // Reset input so the same file can be selected again if needed
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [onAsset]);

  const handleWorldSelect = (filename: string) => {
    setIsWorldPickerOpen(false);
    // Append timestamp to prevent caching
    const url = `/worlds/${filename}?t=${Date.now()}`;
    onAsset?.(url);
    
    const simulation = getSimulation();
    const world = simulation.getWorld();
    // Clear existing entities to prevent stacking
    if (world.clear) {
      world.clear();
    }

    // Also load into the simulation
    const sceneLoader = new SceneLoader();
    sceneLoader.loadGeneratedAsset(url, simulation)
      .catch(error => {
        console.error('Failed to load selected world:', error);
      });
      
    // Notify parent to disable teacher mode
    const formattedName = filename
      .replace('.glb', '')
      .replace(/_/g, ' ')
      .replace(/([A-Z])/g, ' $1')
      .trim();
    onWorldLoaded?.(formattedName);
  };

  return (
    <>
      <div 
        className="absolute top-4 right-4 w-[380px] rounded-lg border border-zinc-700 bg-zinc-900/80 p-4 text-zinc-100 shadow-xl backdrop-blur-md pointer-events-auto flex flex-col max-h-[90vh]"
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold tracking-tight text-white">Create a World</h2>
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileUpload}
          accept=".glb,.gltf"
          className="hidden"
        />
        <div className="flex gap-2">
            <button 
            onClick={() => setIsWorldPickerOpen(true)}
            className="flex items-center gap-1.5 rounded bg-emerald-500 hover:bg-emerald-400 px-2 py-1 text-[10px] text-zinc-950 font-bold uppercase tracking-wider transition-colors shadow-sm"
            >
            <FolderOpen className="w-3 h-3" />
            Load World
            </button>
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
                    onClick={() => handleViewVersion(v)}
                    className={`flex-1 text-left p-2 rounded text-xs transition border ${
                      currentVersionId === v.id 
                        ? 'bg-emerald-500/10 border-emerald-500/50 text-emerald-400' 
                        : 'bg-zinc-950/40 border-zinc-800 text-zinc-400 hover:border-zinc-700'
                    }`}
                  >
                    <div className="truncate font-medium">{v.prompt}</div>
                  </button>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition mt-1.5">
                    <button 
                      onClick={() => handleRevert(v)}
                      className="p-1 hover:bg-zinc-800 rounded text-zinc-500 hover:text-emerald-400 transition"
                      title="Revert to this state"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                    </button>
                    <button 
                      onClick={() => startEdit(v)}
                      className="p-1 hover:bg-zinc-800 rounded text-zinc-500 transition"
                      title="Edit prompt"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                      </svg>
                    </button>
                  </div>
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
          className="flex-1 rounded-md bg-emerald-500 px-3 py-2 text-sm font-bold text-zinc-950 transition hover:bg-emerald-400 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed disabled:scale-100 shadow-[0_4px_12px_rgba(16,185,129,0.2)]"
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
      {events.length > 0 && (
        <div className="mt-4 flex-1 overflow-hidden flex flex-col min-h-0">
          <div className="mb-2 text-[10px] uppercase tracking-wider text-zinc-400 font-bold flex items-center gap-2">
            <span>Generation Console</span>
            {status === 'running' && <span className="flex h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />}
          </div>
          <div 
            ref={scrollRef} 
            className="flex-1 space-y-2 overflow-y-auto pr-2 scrollbar-thin scrollbar-track-zinc-950 scrollbar-thumb-zinc-700"
          >
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
      )}
    </div>

    <WorldPicker 
      isOpen={isWorldPickerOpen} 
      onClose={() => setIsWorldPickerOpen(false)}
      onSelectWorld={handleWorldSelect}
    />
    </>
  );
};

export default GenerationPanel;
