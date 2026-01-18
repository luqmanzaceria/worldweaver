import React, { useEffect, useRef, useState } from 'react';
import { ScreenShareVision } from '../lib/ScreenShareVision';

const SHOW_VIDEO_STREAM = true;

const OvershootVision: React.FC<{ initialPrompt?: string }> = ({ initialPrompt }) => {
  const [isActive, setIsActive] = useState(false);
  const [result, setResult] = useState<string>('');
  const [prompt, setPrompt] = useState('Describe what you see. It is a historical landscape, give real dates, details, and events about this landscape. Your audience is a grade 10 history class. Do not mention anything about Minecraft, rendering, 3D world, or adjacent. You can only give historic information.');
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const visionRef = useRef<any>(null);

  const resultRef = useRef<HTMLDivElement>(null);

  // Update prompt when prop changes
  useEffect(() => {
    if (initialPrompt) {
        setPrompt(initialPrompt);
        // If the vision instance exists, update it immediately
        if (visionRef.current) {
            visionRef.current.updatePrompt(initialPrompt).catch((err: any) => {
                console.error("Failed to auto-update prompt:", err);
            });
        }
    }
  }, [initialPrompt]);

  useEffect(() => {
    // Auto-start stream on mount
    startStream();
    
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
        processing: {
          clip_length_seconds: 1.5,
          delay_seconds: 2.5,
          fps: 30,
          sampling_ratio: 0.7
        },      
        debug: true, // Enable debug logging
        onResult: (res: any) => {
          console.log("HIHIHIIHIH")
          console.log("Overshoot Raw Result:", res); // Debug log
             if (res && res.result) {
                 const text = typeof res.result === 'string' ? res.result : JSON.stringify(res.result, null, 2);
                 setResult(text);
                 // @ts-ignore
                 window.latestOvershootContext = text;
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
      className="absolute bottom-4 right-4 w-[640px] bg-zinc-900/80 backdrop-blur-md p-4 rounded-lg text-zinc-100 border border-zinc-700 shadow-xl z-50 pointer-events-auto"
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
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

        {/* Result Output */}
        <div className="space-y-1">
            <div 
                ref={resultRef}
                className="h-48 bg-black/30 rounded p-2 text-sm overflow-y-auto font-mono text-green-400 whitespace-pre-wrap scroll-smooth"
            >
                {result}
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
