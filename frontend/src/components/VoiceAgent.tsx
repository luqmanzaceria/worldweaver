import React, { useState, useCallback, useEffect } from 'react';
import {
  LiveKitRoom,
  useVoiceAssistant,
  RoomAudioRenderer,
  useLocalParticipant,
  useRemoteParticipants,
  useTracks,
  useRoomContext,
} from '@livekit/components-react';
import { Mic, PhoneOff, Loader2 } from 'lucide-react';
import { Track } from 'livekit-client';

const TrackSubscriptionLogger: React.FC = () => {
  const tracks = useTracks([Track.Source.Microphone]);
  const remoteParticipants = useRemoteParticipants();
  
  useEffect(() => {
    const remoteTracks = tracks.filter(t => !t.participant.isLocal);
    const participantIds = remoteParticipants.map(p => p.identity);
    
    console.log('[VoiceAgent] Room participants (remote):', participantIds);
    console.log('[VoiceAgent] Current remote tracks:', remoteTracks.length);
    
    remoteTracks.forEach(t => {
      console.log(`[VoiceAgent] Subscription state for ${t.participant.identity}:`, t.publication?.isSubscribed ? 'SUBSCRIBED' : 'NOT SUBSCRIBED');
    });
  }, [tracks, remoteParticipants]);
  return null;
};

const VoiceAgentInner: React.FC<{ onDisconnect: (e: React.MouseEvent) => void }> = ({ onDisconnect }) => {
  const { state } = useVoiceAssistant();
  const { localParticipant } = useLocalParticipant();
  const [isPressing, setIsPressing] = useState(false);

  useEffect(() => {
    console.log('[VoiceAgent] Inner mounted. Participant:', localParticipant?.identity || 'None');
  }, [localParticipant]);
  
  const setMic = useCallback(async (enabled: boolean) => {
    try {
        if (localParticipant) {
            console.log('[VoiceAgent] PTT: Setting mic to', enabled);
            await localParticipant.setMicrophoneEnabled(enabled);
        } else {
            console.error('[VoiceAgent] PTT: Cannot set mic - no localParticipant');
        }
    } catch (err) {
        console.error('[VoiceAgent] PTT: Failed to set mic:', err);
    }
  }, [localParticipant]);

  // Push-to-Talk handlers
  const handlePTTStart = useCallback(async (e: React.MouseEvent | React.TouchEvent) => {
    console.log('[VoiceAgent] PTT Button Down');
    e.stopPropagation();
    setIsPressing(true);
    await setMic(true);
  }, [setMic]);

  const handlePTTEnd = useCallback(async (e: React.MouseEvent | React.TouchEvent) => {
    console.log('[VoiceAgent] PTT Button Up');
    e.stopPropagation();
    setIsPressing(false);
    // Tiny delay to avoid clipping the end of the sentence
    setTimeout(() => setMic(false), 150);
  }, [setMic]);

  useEffect(() => {
    // Force mic OFF initially for PTT
    if (localParticipant) {
        console.log('[VoiceAgent] PTT: Ensuring mic is initially OFF');
        setMic(false);
    }
  }, [localParticipant, setMic]);

  return (
    <div 
        className="flex flex-col items-center gap-4 p-5 bg-zinc-950/95 rounded-xl border border-zinc-800 shadow-2xl backdrop-blur-xl w-72 text-left"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between w-full">
        <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${
            state === 'speaking' ? 'bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 
            isPressing ? 'bg-blue-500 animate-bounce shadow-[0_0_8px_rgba(59,130,246,0.5)]' : 
            'bg-zinc-700'
            }`} />
            <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">
            {state === 'speaking' ? 'Agent Speaking' : 
            isPressing ? 'Listening' : 
            'Ready'}
            </span>
        </div>
        <button 
            onClick={onDisconnect}
            className="p-1.5 rounded-md hover:bg-red-500/10 text-zinc-500 hover:text-red-400 transition-colors"
            title="Disconnect Voice"
        >
            <PhoneOff className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Main interaction button - Always PTT */}
      <div className="w-full">
        <button
            onMouseDown={handlePTTStart}
            onMouseUp={handlePTTEnd}
            onMouseLeave={handlePTTEnd}
            onTouchStart={handlePTTStart}
            onTouchEnd={handlePTTEnd}
            className={`w-full py-8 rounded-xl flex flex-col items-center justify-center gap-2 transition-all border-2 ${
                isPressing 
                    ? 'bg-emerald-500/20 border-emerald-500 shadow-[0_0_20px_rgba(16,185,129,0.2)] scale-[0.98]' 
                    : 'bg-zinc-900 border-zinc-800 hover:border-zinc-700'
            }`}
        >
            <div className={`p-4 rounded-full ${isPressing ? 'bg-emerald-500 text-zinc-950' : 'bg-zinc-800 text-zinc-400'}`}>
                <Mic className="w-7 h-7" />
            </div>
            <span className={`text-[11px] font-black uppercase tracking-tighter ${isPressing ? 'text-emerald-400' : 'text-zinc-500'}`}>
                {isPressing ? 'Release to Send' : 'Hold to Speak'}
            </span>
        </button>
      </div>
    </div>
  );
};

export const VoiceAgent: React.FC = () => {
  const [isConnected, setIsConnected] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const apiBase = import.meta.env.VITE_BLENDER_API_URL ?? 'http://localhost:8787';

  const handleToggle = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isConnected) {
      console.log('[VoiceAgent] Disconnecting...');
      setIsConnected(false);
      setToken(null);
      setUrl(null);
      return;
    }

    setIsLoading(true);
    try {
      console.log('[VoiceAgent] Fetching token from:', `${apiBase}/token`);
      const response = await fetch(`${apiBase}/token`);
      if (!response.ok) {
          const text = await response.text();
          throw new Error(`Server error: ${text}`);
      }
      const data = await response.json();
      console.log('[VoiceAgent] Received token and URL:', data.serverUrl);
      
      if (data.token && data.serverUrl) {
        setToken(data.token);
        setUrl(data.serverUrl);
        setIsConnected(true);
      } else {
        console.error('Failed to get LiveKit token:', data.error);
        alert('LiveKit not configured on backend. Check console for details.');
      }
    } catch (error) {
      console.error('Error connecting to voice agent:', error);
      alert(`Connection failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsLoading(false);
    }
  }, [isConnected, apiBase]);

  return (
    <div className="fixed bottom-4 left-[280px] z-50 pointer-events-auto">
      {isConnected && token && url ? (
        <LiveKitRoom
          token={token}
          serverUrl={url}
          connect={true}
          audio={true}
          video={false}
          onConnected={() => console.log('[VoiceAgent] Connected to LiveKit Room')}
          onDisconnected={() => {
            console.log('[VoiceAgent] Disconnected from LiveKit Room');
            setIsConnected(false);
            setToken(null);
            setUrl(null);
          }}
          onError={(err) => console.error('[VoiceAgent] LiveKit Room Error:', err)}
        >
          <VoiceAgentInner onDisconnect={handleToggle} />
          <RoomAudioRenderer />
          <TrackSubscriptionLogger />
        </LiveKitRoom>
      ) : (
        <button
          onClick={handleToggle}
          disabled={isLoading}
          className={`flex items-center gap-2 px-4 py-2 rounded-full border shadow-2xl transition-all ${
            isLoading 
              ? 'bg-zinc-800 border-zinc-700 text-zinc-500 cursor-not-allowed' 
              : 'bg-emerald-500 text-zinc-950 border-emerald-400 hover:bg-emerald-400 hover:scale-105 active:scale-95'
          }`}
        >
          {isLoading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Mic className="w-4 h-4" />
          )}
          <span className="text-sm font-bold tracking-tight">
            {isLoading ? 'Connecting...' : 'Ask a question!'}
          </span>
        </button>
      )}
    </div>
  );
};

export default VoiceAgent;
