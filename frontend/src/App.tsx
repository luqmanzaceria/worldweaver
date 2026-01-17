import React from 'react';
// import Canvas3D from './components/Canvas3D';
import GlbViewer from './components/GlbViewer';
import DebugPanel from './components/DebugPanel';
import GenerationPanel from './components/GenerationPanel';
import McpStatusPanel from './components/McpStatusPanel';

const App: React.FC = () => {
  return (
    <div className="relative w-full h-full">
      {/* <Canvas3D /> */}
      <GlbViewer />
      <DebugPanel />
      <GenerationPanel />
      <McpStatusPanel />
    </div>
  );
};

export default App;
