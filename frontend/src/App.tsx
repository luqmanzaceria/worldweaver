import React, { useState } from 'react';
import { Globe, GraduationCap, User } from 'lucide-react';
// import Canvas3D from './components/Canvas3D';
import GlbViewer from './components/GlbViewer';
import GenerationPanel from './components/GenerationPanel';
import VoiceAgent from './components/VoiceAgent';
import OvershootVision from './components/OvershootVision';

const App: React.FC = () => {
  const [assetUrl, setAssetUrl] = useState('/worlds/dummy.glb');
  const [isTeacherMode, setIsTeacherMode] = useState(true);

  console.log('[App] Current Asset URL:', assetUrl);

  return (
    <div className="relative w-full h-full overflow-hidden bg-[#e5e5e5]">
      {/* <Canvas3D /> */}
      <GlbViewer url={assetUrl} />

      {/* Top Left Branding & Mode Toggle */}
      <div className="absolute top-4 left-4 flex flex-col gap-2 z-50">
        <div className="flex items-center gap-2 px-4 py-2 bg-zinc-900/80 backdrop-blur-md border border-zinc-700 rounded-lg shadow-xl pointer-events-none">
          <Globe className="w-5 h-5 text-emerald-400" />
          <h1 className="text-lg font-bold tracking-tight text-white">World Weaver</h1>
        </div>

        <div className="flex bg-zinc-900/80 backdrop-blur-md border border-zinc-700 rounded-lg p-1 shadow-xl pointer-events-auto">
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
      </div>

      {isTeacherMode && <GenerationPanel onAsset={setAssetUrl} />}
      <VoiceAgent />
      <OvershootVision />
    </div>
  );
};

export default App;
