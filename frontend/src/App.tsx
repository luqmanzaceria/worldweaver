import React, { useState } from 'react';
// import Canvas3D from './components/Canvas3D';
import GlbViewer from './components/GlbViewer';
import DebugPanel from './components/DebugPanel';
import GenerationPanel from './components/GenerationPanel';
import McpStatusPanel from './components/McpStatusPanel';
import OvershootVision from './components/OvershootVision';
import VoiceAgent from './components/VoiceAgent';

const App: React.FC = () => {
  const [assetUrl, setAssetUrl] = useState('/worlds/dummy.glb');

  console.log('[App] Current Asset URL:', assetUrl);

  return (
    <div className="relative w-full h-full">
      {/* <Canvas3D /> */}
      <GlbViewer url={assetUrl} />
      <DebugPanel />
      <GenerationPanel onAsset={setAssetUrl} />
      <McpStatusPanel />
      <VoiceAgent />
      <OvershootVision />
    </div>
  );
};

export default App;
