import React, { useState, useEffect } from 'react';
import { getSimulation } from '../engine/simulation_instance';
import { Play, Pause, RotateCcw, Activity } from 'lucide-react';

const DebugPanel: React.FC = () => {
  const [isPaused, setIsPaused] = useState(true);
  const [stats, setStats] = useState({ stepCount: 0, entityCount: 0 });

  useEffect(() => {
    const interval = setInterval(() => {
      const sim = getSimulation();
      setIsPaused(sim.getIsPaused());
      setStats({
        stepCount: sim.getWorld().getState().stepCount,
        entityCount: sim.getWorld().getAllEntities().length,
      });
    }, 100);

    return () => clearInterval(interval);
  }, []);

  const handleTogglePause = () => {
    const sim = getSimulation();
    if (sim.getIsPaused()) {
      sim.start();
    } else {
      sim.pause();
    }
    setIsPaused(!sim.getIsPaused());
  };

  const handleReset = () => {
    const sim = getSimulation();
    sim.reset();
  };

  return (
    <div className="absolute top-4 left-4 p-4 bg-zinc-900/80 backdrop-blur-md border border-zinc-700 rounded-lg shadow-xl text-zinc-100 w-64 pointer-events-auto">
      <div className="flex items-center justify-between mb-4 border-b border-zinc-700 pb-2">
        <h2 className="text-lg font-bold flex items-center gap-2">
          <Activity className="w-5 h-5 text-emerald-400" />
          WorldWeaver
        </h2>
      </div>

      <div className="space-y-4">
        <div className="flex gap-2">
          <button
            onClick={handleTogglePause}
            className="flex-1 flex items-center justify-center gap-2 py-2 bg-zinc-700 hover:bg-zinc-600 rounded transition-colors border border-white"
          >
            {isPaused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
            {isPaused ? 'Resume' : 'Pause'}
          </button>
          <button
            onClick={handleReset}
            className="p-2 bg-zinc-700 hover:bg-zinc-600 rounded transition-colors border border-white"
            title="Reset Simulation"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>

        <div className="text-xs font-mono space-y-1 text-zinc-400">
          <div className="flex justify-between">
            <span>Steps:</span>
            <span className="text-zinc-100">{stats.stepCount}</span>
          </div>
          <div className="flex justify-between">
            <span>Entities:</span>
            <span className="text-zinc-100">{stats.entityCount}</span>
          </div>
          <div className="flex justify-between">
            <span>Hz:</span>
            <span className="text-zinc-100">{getSimulation().getHz()}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DebugPanel;
