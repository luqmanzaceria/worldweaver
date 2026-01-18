import { RealtimeVision } from '@overshoot/sdk';

export class ScreenShareVision extends RealtimeVision {
  constructor(config: any) {
    super(config);
  }

  validateConfig(config: any) {
    // Bypass validation for screen source type
    if (config.source?.type === 'screen') {
        // We still want to validate other parts, but since super.validateConfig throws on type='screen',
        // we might need to trick it or just implement partial validation.
        // For simplicity, we'll check the critical API keys here and skip the source check of the parent.
        if (!config.apiUrl) throw new Error("apiUrl is required");
        if (!config.apiKey) throw new Error("apiKey is required");
        return;
    }
    super.validateConfig(config);
  }

  async createMediaStream(source: any) {
    if (source.type === 'screen') {
      console.log("[ScreenShareVision] Requesting display media...");
      try {
          const stream = await navigator.mediaDevices.getDisplayMedia({
            video: {
                // Try to get a reasonable frame rate and resolution
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
    return super.createMediaStream(source);
  }
}
