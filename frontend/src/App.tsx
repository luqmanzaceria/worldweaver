import React, { useState } from 'react';
import { Globe, GraduationCap, User, Wind, Footprints } from 'lucide-react';
// import Canvas3D from './components/Canvas3D';
import GlbViewer from './components/GlbViewer';
import GenerationPanel from './components/GenerationPanel';
import VoiceAgent from './components/VoiceAgent';
import OvershootVision from './components/OvershootVision';

const App: React.FC = () => {
  const [assetUrl, setAssetUrl] = useState('/worlds/dummy.glb');
  const [isTeacherMode, setIsTeacherMode] = useState(true);
  const [isFlying, setIsFlying] = useState(true);
  const [overshootPrompt, setOvershootPrompt] = useState<string | undefined>(undefined);

  console.log('[App] Current Asset URL:', assetUrl);

  return (
    <div className="relative w-full h-full overflow-hidden bg-[#e5e5e5]">
      {/* <Canvas3D /> */}
      <GlbViewer url={assetUrl} isFlying={isFlying} />

      {/* Top Left Branding & Mode Toggle */}
      <div className="absolute top-4 left-4 flex flex-col gap-2 z-50">
        <div className="flex items-center gap-2 px-4 py-2 bg-zinc-900/80 backdrop-blur-md border border-zinc-700 rounded-lg shadow-xl pointer-events-none">
          <Globe className="w-5 h-5 text-emerald-400" />
          <h1 className="text-lg font-bold tracking-tight text-white">World Weaver</h1>
        </div>

        <div 
          className="flex bg-zinc-900/80 backdrop-blur-md border border-zinc-700 rounded-lg p-1 shadow-xl pointer-events-auto"
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => setIsTeacherMode(true)}
            className={`flex-1 flex items-center justify-center gap-2 px-3 py-1.5 rounded-md text-xs font-bold transition-all ${
              isTeacherMode 
                ? 'bg-emerald-500 text-zinc-950' 
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
            }`}
          >
            <GraduationCap className="w-3.5 h-3.5" />
            Teacher
          </button>
          <button
            onClick={() => setIsTeacherMode(false)}
            className={`flex-1 flex items-center justify-center gap-2 px-3 py-1.5 rounded-md text-xs font-bold transition-all ${
              !isTeacherMode 
                ? 'bg-blue-500 text-white' 
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
            }`}
          >
            <User className="w-3.5 h-3.5" />
            Student
          </button>
        </div>

        <div 
          className="flex bg-zinc-900/80 backdrop-blur-md border border-zinc-700 rounded-lg p-1 shadow-xl pointer-events-auto"
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => setIsFlying(true)}
            className={`flex-1 flex items-center justify-center gap-2 px-3 py-1.5 rounded-md text-xs font-bold transition-all ${
              isFlying 
                ? 'bg-emerald-500 text-zinc-950' 
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
            }`}
          >
            <Wind className="w-3.5 h-3.5" />
            Fly
          </button>
          <button
            onClick={() => setIsFlying(false)}
            className={`flex-1 flex items-center justify-center gap-2 px-3 py-1.5 rounded-md text-xs font-bold transition-all ${
              !isFlying 
                ? 'bg-blue-500 text-white' 
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
            }`}
          >
            <Footprints className="w-3.5 h-3.5" />
            Walk
          </button>
        </div>

        {/* Controls Legend */}
        <div 
            className="bg-zinc-900/80 p-4 rounded-lg border border-zinc-700 backdrop-blur-md shadow-xl pointer-events-auto w-full"
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
        >
            <h2 className="font-bold mb-3 text-white text-base">Controls</h2>
            <ul className="space-y-2 text-xs text-zinc-300">
                <li className="flex justify-between items-center"><span className="font-mono bg-zinc-800 px-1.5 py-0.5 rounded text-zinc-100 border border-zinc-700">WASD</span> <span className="text-zinc-400">Move</span></li>
                <li className="flex justify-between items-center"><span className="font-mono bg-zinc-800 px-1.5 py-0.5 rounded text-zinc-100 border border-zinc-700">Click</span> <span className="text-zinc-400">Look</span></li>
                <li className="flex justify-between items-center"><span className="font-mono bg-zinc-800 px-1.5 py-0.5 rounded text-zinc-100 border border-zinc-700">Space</span> <span className="text-zinc-400">{isFlying ? "Up" : "Jump"}</span></li>
                {isFlying && <li className="flex justify-between items-center"><span className="font-mono bg-zinc-800 px-1.5 py-0.5 rounded text-zinc-100 border border-zinc-700">Shift</span> <span className="text-zinc-400">Down</span></li>}
                <li className="flex justify-between items-center"><span className="font-mono bg-zinc-800 px-1.5 py-0.5 rounded text-zinc-100 border border-zinc-700">ESC</span> <span className="text-zinc-400">Release</span></li>
            </ul>
        </div>
      </div>

      {isTeacherMode && <GenerationPanel onAsset={setAssetUrl} onWorldLoaded={(worldName) => {
        setIsTeacherMode(false);
        setIsFlying(false);
        if (worldName) {
            setOvershootPrompt(`Describe what you see. It is ${worldName}, give real dates, details, and events about this landscape. Your audience is a grade 10 history class.`);
        }
      }} />}
      <VoiceAgent />
      <OvershootVision initialPrompt={overshootPrompt} />
    </div>
  );
};

export default App;
