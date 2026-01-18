import React, { useEffect, useRef, useState } from 'react';
import { RealtimeVision } from '@overshoot/sdk';
import { Camera, StopCircle, Play, RefreshCw } from 'lucide-react';

const OvershootVision: React.FC = () => {
  const [isActive, setIsActive] = useState(false);
  const [result, setResult] = useState<string>('');
  const [prompt, setPrompt] = useState('Describe what you see');
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const visionRef = useRef<RealtimeVision | null>(null);
  
  // Draggable panel state - use null to indicate initial position
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const panelRef = useRef<HTMLDivElement>(null);
  
  // Drag handlers
  const handleMouseDown = React.useCallback((e: React.MouseEvent) => {
    if (!panelRef.current) return;
    const rect = panelRef.current.getBoundingClientRect();
    setIsDragging(true);
    
    // Calculate offset from mouse position to top-left corner of panel
    setDragOffset({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    });
    e.preventDefault();
    e.stopPropagation();
  }, []);

  React.useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!panelRef.current) return;
      const panel = panelRef.current;
      const rect = panel.getBoundingClientRect();
      const maxX = window.innerWidth - rect.width;
      const maxY = window.innerHeight - rect.height;
      
      // Calculate new position based on mouse position minus offset
      let newX = e.clientX - dragOffset.x;
      let newY = e.clientY - dragOffset.y;
      
      // Clamp to viewport bounds
      newX = Math.max(0, Math.min(newX, maxX));
      newY = Math.max(0, Math.min(newY, maxY));
      
      setPosition({ x: newX, y: newY });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, dragOffset]);

  useEffect(() => {
    // Cleanup on unmount
    return () => {
      if (visionRef.current) {
        visionRef.current.stop();
      }
    };
  }, []);

  const startStream = async () => {
    try {
      setError(null);
      // Initialize RealtimeVision with provided configuration
      const vision = new RealtimeVision({
        // Use local proxy to avoid CORS
        apiUrl: "/api/overshoot", 
        apiKey: "ovs_6bdee043bca8803bb5f33bf5a2b3bc26",
        prompt: prompt,
        // Using minimal configuration as per getting-started docs
        source: { type: 'camera', cameraFacing: 'environment' },
        debug: true, // Enable debug logging
        onResult: (res: any) => {
          console.log("HIHIHIIHIH")
          console.log("Overshoot Raw Result:", res); // Debug log
             if (res && res.result) {
                 const text = typeof res.result === 'string' ? res.result : JSON.stringify(res.result, null, 2);
                 setResult(text);
             }
        },
        onError: (err: any) => {
            console.error("Overshoot Error Full Object:", err);
            if (err.details) {
                console.error("Validation Details:", err.details);
            }
            
            // Check for validation details
            let errorMessage = err.message;
            if (err.details) {
                errorMessage += `\nDetails: ${JSON.stringify(err.details)}`;
            }
            setError(errorMessage);
            
            // Don't necessarily stop on temporary errors, but if it's fatal:
            if (errorMessage.includes("Unauthorized") || errorMessage.includes("Network")) {
                setIsActive(false);
            }
        }
      });

      visionRef.current = vision;
      await vision.start();
      setIsActive(true);

      // Attach stream to video element for preview
      const stream = vision.getMediaStream();
      if (videoRef.current && stream) {
        videoRef.current.srcObject = stream;
      }

    } catch (err: any) {
      console.error("Failed to start vision:", err);
      setError(err.message || "Failed to start");
      setIsActive(false);
    }
  };

  const stopStream = async () => {
    if (visionRef.current) {
      await visionRef.current.stop();
      visionRef.current = null;
    }
    setIsActive(false);
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };

  const updatePrompt = async () => {
      if (visionRef.current && isActive) {
          try {
              await visionRef.current.updatePrompt(prompt);
          } catch (err: any) {
              setError("Failed to update prompt: " + err.message);
          }
      }
  };

  const panelStyle: React.CSSProperties = {
    position: 'absolute',
    width: '320px',
    cursor: isDragging ? 'grabbing' : 'default'
  };
  
  // Use bottom/right for initial position, left/top after dragging
  if (position === null) {
    panelStyle.bottom = '16px';
    panelStyle.right = '16px';
  } else {
    panelStyle.left = `${position.x}px`;
    panelStyle.top = `${position.y}px`;
  }

  return (
    <div 
      ref={panelRef}
      className="bg-black/80 backdrop-blur-md p-4 rounded-lg text-white border border-white/10 shadow-xl z-50 pointer-events-auto select-none"
      style={panelStyle}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div 
        className="flex items-center gap-2 mb-4 border-b border-white/10 pb-2 -mx-4 -mt-4 px-4 pt-4 cursor-grab active:cursor-grabbing"
        onMouseDown={handleMouseDown}
      >
        <Camera className="w-5 h-5 text-blue-400 select-none" />
        <h2 className="font-semibold select-none flex-1">Overshoot Vision</h2>
        {/* Drag indicator - three horizontal lines (grip handle) */}
        <div className="flex flex-col gap-1 items-center select-none opacity-60 hover:opacity-100 transition-opacity">
          <div className="w-4 h-0.5 bg-white/60 rounded-full"></div>
          <div className="w-4 h-0.5 bg-white/60 rounded-full"></div>
          <div className="w-4 h-0.5 bg-white/60 rounded-full"></div>
        </div>
      </div>

      <div className="space-y-4">
        {/* Video Preview */}
        <div className="relative aspect-video bg-black/50 rounded overflow-hidden border border-white/5">
             <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover transform scale-x-[-1]" // Mirror effect for user facing, remove if environment
             />
             {!isActive && (
                 <div className="absolute inset-0 flex items-center justify-center text-white/30 text-sm">
                     Camera Off
                 </div>
             )}
        </div>

        {/* Controls */}
        <div className="flex gap-2">
            {!isActive ? (
                <button
                    onClick={startStream}
                    className="flex-1 bg-blue-600 hover:bg-blue-500 text-white py-2 px-4 rounded flex items-center justify-center gap-2 transition-colors"
                >
                    <Play className="w-4 h-4" /> Start Stream
                </button>
            ) : (
                <button
                    onClick={stopStream}
                    className="flex-1 bg-red-600 hover:bg-red-500 text-white py-2 px-4 rounded flex items-center justify-center gap-2 transition-colors"
                >
                    <StopCircle className="w-4 h-4" /> Stop
                </button>
            )}
        </div>

        {/* Prompt Input */}
        <div className="space-y-1">
            <label className="text-xs text-white/60">Prompt</label>
            <div className="flex gap-2">
                <input
                    type="text"
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    className="flex-1 bg-white/10 border border-white/10 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-blue-500"
                    onKeyDown={(e) => e.key === 'Enter' && updatePrompt()}
                />
                {isActive && (
                    <button 
                        onClick={updatePrompt} 
                        className="text-xs bg-white/10 hover:bg-white/20 p-2 rounded"
                        title="Update Prompt"
                    >
                        <RefreshCw className="w-4 h-4" />
                    </button>
                )}
            </div>
        </div>

        {/* Result Output */}
        <div className="space-y-1">
            <label className="text-xs text-white/60">Analysis Result</label>
            <div className="h-32 bg-black/30 rounded p-2 text-sm overflow-y-auto font-mono text-green-400 border border-white/5 whitespace-pre-wrap">
                {result || <span className="text-white/30 italic">Waiting for results...</span>}
            </div>
        </div>

        {error && (
            <div className="text-red-400 text-xs p-2 bg-red-900/20 rounded border border-red-500/20 break-words">
                {error}
            </div>
        )}
      </div>
    </div>
  );
};

export default OvershootVision;
