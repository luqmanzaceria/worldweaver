import React, { useEffect, useState } from 'react';

const MCP_STATUS_URL = import.meta.env.VITE_BLENDER_API_URL
  ? `${import.meta.env.VITE_BLENDER_API_URL}/mcp/status`
  : 'http://localhost:8787/mcp/status';

const McpStatusPanel: React.FC = () => {
  const [status, setStatus] = useState<'unknown' | 'connected' | 'error' | 'starting'>('unknown');
  const [detail, setDetail] = useState<string>('');
  const [logs, setLogs] = useState<string[]>([]);

  useEffect(() => {
    let isMounted = true;

    const poll = async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 1500);
      try {
        const response = await fetch(MCP_STATUS_URL, { signal: controller.signal });
        const data = await response.json();
        if (!isMounted) return;
        if (data.ok) {
          setStatus('connected');
          setDetail(`BlenderMCP reachable (${MCP_STATUS_URL})`);
          setLogs(Array.isArray(data.logs) ? data.logs : []);
        } else if (data.state === 'starting') {
          setStatus('starting');
          setDetail(`Starting MCP server... (${MCP_STATUS_URL})`);
          setLogs(Array.isArray(data.logs) ? data.logs : []);
        } else {
          setStatus('error');
          setDetail(data.error ?? `BlenderMCP not reachable (${MCP_STATUS_URL})`);
          setLogs(Array.isArray(data.logs) ? data.logs : []);
        }
      } catch (error) {
        if (!isMounted) return;
        const message =
          error instanceof DOMException && error.name === 'AbortError'
            ? `Timed out contacting MCP server (${MCP_STATUS_URL})`
            : error instanceof Error
              ? error.message
              : `Connection failed (${MCP_STATUS_URL})`;
        setStatus('error');
        setDetail(message);
      } finally {
        clearTimeout(timeout);
      }
    };

    poll();
    const interval = setInterval(poll, 2000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  const statusColor =
    status === 'connected'
      ? 'text-emerald-400'
      : status === 'starting'
        ? 'text-sky-400'
        : status === 'error'
          ? 'text-amber-400'
          : 'text-zinc-400';

  return (
    <div 
      className="absolute bottom-4 left-4 w-64 rounded-lg border border-zinc-700 bg-zinc-900/80 p-3 text-zinc-100 shadow-xl backdrop-blur-md pointer-events-auto"
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="text-xs uppercase tracking-wide text-zinc-500">MCP Status</div>
      <div className={`mt-1 text-sm font-semibold ${statusColor}`}>
        {status === 'connected'
          ? 'Connected'
          : status === 'starting'
            ? 'Starting...'
            : status === 'error'
              ? 'Disconnected'
              : 'Checking...'}
      </div>
      <div className="mt-1 text-xs text-zinc-400">{detail}</div>
      {logs.length > 0 && (
        <div className="mt-2 max-h-24 overflow-y-auto rounded border border-zinc-800 bg-zinc-950/60 p-2 text-[10px] text-zinc-500">
          {logs.slice(-8).map((line, index) => (
            <div key={`${line}-${index}`}>{line}</div>
          ))}
        </div>
      )}
    </div>
  );
};

export default McpStatusPanel;

