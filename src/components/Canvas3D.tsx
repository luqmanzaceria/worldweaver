import React, { useEffect, useRef } from 'react';
import { getSimulation } from '../engine/simulation_instance';
import { Renderer } from '../engine/renderer';

const Canvas3D: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<Renderer | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // Initialize renderer
    const renderer = new Renderer(containerRef.current);
    rendererRef.current = renderer;

    const simulation = getSimulation();
    simulation.start();

    // Animation loop for rendering (decoupled from simulation)
    let frameId: number;
    const renderLoop = () => {
      renderer.sync(simulation.getWorld());
      renderer.render();
      frameId = requestAnimationFrame(renderLoop);
    };
    renderLoop();

    return () => {
      cancelAnimationFrame(frameId);
      simulation.pause();
    };
  }, []);

  return <div ref={containerRef} className="w-full h-full bg-black" />;
};

export default Canvas3D;
