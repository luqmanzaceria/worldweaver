import React, { useEffect, useState } from 'react';
import { X, Globe } from 'lucide-react';

interface WorldPickerProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectWorld: (filename: string) => void;
}

const WorldPicker: React.FC<WorldPickerProps> = ({ isOpen, onClose, onSelectWorld }) => {
  const [worlds, setWorlds] = useState<string[]>([
    'HistoricalRome.glb',
    'RomanInsulae.glb',
    // 'MachuPicchu.glb',
    'ChichenItza.glb',
    'TheGreatWallOfChina.glb',
    'FishingVillage.glb',
    'Turing City'
  ]);

  // If you want to auto-refresh this list or make it dynamic without a backend,
  // you would typically need to move these assets to `src/assets` and use import.meta.glob,
  // or use a build script to generate a JSON manifest.
  // For now, per user request, we are using a static local list.

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div 
        className="w-full max-w-2xl bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[80vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-zinc-800 bg-zinc-900/50">
          <div className="flex items-center gap-2">
            <Globe className="w-5 h-5 text-emerald-500" />
            <h2 className="text-lg font-bold text-white">Load World</h2>
          </div>
          <button 
            onClick={onClose}
            className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 overflow-y-auto grid grid-cols-2 sm:grid-cols-3 gap-4">
          {worlds.map((world) => (
            <button
              key={world}
              onClick={() => onSelectWorld(world)}
              className="group flex flex-col items-center gap-3 p-4 rounded-lg bg-zinc-950/50 border border-zinc-800 hover:border-emerald-500/50 hover:bg-zinc-800/50 transition-all text-center"
            >
              <div className="w-12 h-12 rounded-full bg-emerald-500/10 flex items-center justify-center group-hover:scale-110 transition-transform">
                <Globe className="w-6 h-6 text-emerald-500" />
              </div>
              <span className="text-sm font-medium text-zinc-200 group-hover:text-emerald-400 truncate w-full">
                {world
                  .replace('.glb', '')
                  .replace(/_/g, ' ')
                  .replace(/([A-Z])/g, ' $1') // Add space before uppercase letters
                  .trim() // Remove leading space if the first letter was uppercase
                }
              </span>
            </button>
          ))}
          
          {worlds.length === 0 && (
            <div className="col-span-full py-8 text-center text-zinc-500 italic">
              No worlds found in library.
            </div>
          )}
        </div>

        <div className="p-4 border-t border-zinc-800 bg-zinc-900/50 text-xs text-zinc-500 flex justify-between items-center">
            <span>Local Library</span>
            {/* <span className="font-mono opacity-50">./frontend/public/worlds</span> */}
        </div>
      </div>
    </div>
  );
};

export default WorldPicker;