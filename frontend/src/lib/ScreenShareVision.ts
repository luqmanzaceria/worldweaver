import { RealtimeVision } from '@overshoot/sdk';

export class ScreenShareVision extends RealtimeVision {
  private actualSource: any;

  constructor(config: any) {
    // 1. Store the actual source config provided by the user
    const actualSource = config.source;
    
    // 2. Create a modified config to satisfy the base class validation
    const safeConfig = { ...config };
    if (actualSource?.type === 'screen') {
        // Pass a valid 'camera' source to the parent to bypass strict validation
        safeConfig.source = { type: 'camera', cameraFacing: 'environment' };
    }

    // 3. Initialize parent with safe config
    super(safeConfig);
    
    // 4. Restore the actual source for our internal use
    this.actualSource = actualSource;
  }

  // We no longer need to override validateConfig if we pass a valid config to super()
  // But we can keep it if we want to add custom validation for 'screen' type later.
  // For now, removing the override relies on the parent validating the 'safeConfig' 
  // and we trust our internal logic for the screen part.

  async createMediaStream(source: any) {
    // Use our stored actual source if defined, otherwise fall back to the passed source
    const targetSource = this.actualSource || source;

    if (targetSource.type === 'screen') {
      console.log("[ScreenShareVision] Requesting display media...");
      try {
          const stream = await navigator.mediaDevices.getDisplayMedia({
            video: {
                frameRate: { ideal: 30, max: 60 },
            },
            audio: false
          });
          return stream;
      } catch (err) {
          console.error("[ScreenShareVision] Failed to get display media:", err);
          throw err;
      }
    }
    return super.createMediaStream(targetSource);
  }
}
