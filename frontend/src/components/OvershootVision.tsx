import React, { useEffect, useRef, useState } from 'react';
import { RealtimeVision } from '@overshoot/sdk';
import { ScreenShareVision } from '../lib/ScreenShareVision';
import { Camera, StopCircle, Play, RefreshCw, Monitor } from 'lucide-react';

const SHOW_VIDEO_STREAM = false;

const OvershootVision: React.FC = () => {
  const [isActive, setIsActive] = useState(false);
  const [result, setResult] = useState<string>('');
  const [prompt, setPrompt] = useState('Describe what you see');
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const visionRef = useRef<RealtimeVision | null>(null);

  const resultRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Cleanup on unmount
    return () => {
      if (visionRef.current) {
        visionRef.current.stop();
      }
    };
  }, []);

  useEffect(() => {
    if (resultRef.current) {
        resultRef.current.scrollTop = resultRef.current.scrollHeight;
    }
  }, [result]);

  const startStream = async () => {
    try {
      setError(null);
      // Initialize ScreenShareVision with provided configuration
      const vision = new ScreenShareVision({
        // Use local proxy to avoid CORS
        apiUrl: "/api/overshoot", 
        apiKey: "ovs_6bdee043bca8803bb5f33bf5a2b3bc26",
        prompt: prompt,
        // Using minimal configuration as per getting-started docs
        source: { type: 'camera', cameraFacing: 'environment' },
        processing: { fps: 30 },
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

  return (
    <div 
      className="absolute bottom-4 right-4 w-[640px] bg-black/80 backdrop-blur-md p-4 rounded-lg text-white border border-white/10 shadow-xl z-50 pointer-events-auto"
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between mb-4 border-b border-white/10 pb-2">
        <div className="flex items-center gap-2">
          <Monitor className="w-5 h-5 text-blue-400" />
          <h2 className="font-semibold">Overshoot Vision</h2>
        </div>
        <button
          onClick={isActive ? stopStream : startStream}
          className={`flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium transition-colors ${
            isActive 
              ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/30' 
              : 'bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 border border-blue-500/30'
          }`}
        >
          {isActive ? (
            <>
              <StopCircle className="w-3 h-3" /> Stop
            </>
          ) : (
            <>
              <Play className="w-3 h-3" /> Start
            </>
          )}
        </button>
      </div>

      <div className="space-y-4">
        {/* Video Preview */}
        {SHOW_VIDEO_STREAM && (
          <div className="relative aspect-video bg-black/50 rounded overflow-hidden border border-white/5">
              <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover" // Removed mirror effect for OBS screen share
              />
              {!isActive && (
                  <div className="absolute inset-0 flex items-center justify-center text-white/30 text-sm">
                      Camera/OBS Off
                  </div>
              )}
          </div>
        )}

        {/* Prompt Input */}
        <div className="space-y-1">
            <label className="text-xs text-white/60">Prompt</label>
            <div className="flex gap-2">
                <input
                    type="text"
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    className="flex-1 bg-white/10 border border-white/10 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-blue-500"
                    onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === 'Enter') updatePrompt();
                    }}
                    onKeyUp={(e) => e.stopPropagation()}
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
            <div 
                ref={resultRef}
                className="h-32 bg-black/30 rounded p-2 text-sm overflow-y-auto font-mono text-green-400 border border-white/5 whitespace-pre-wrap scroll-smooth"
            >
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
