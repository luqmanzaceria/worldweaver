import asyncio
import logging
import os
from datetime import timedelta
from dotenv import load_dotenv

from livekit import rtc, api
from livekit.agents import voice, AutoSubscribe
from livekit.plugins import openai, silero

load_dotenv(dotenv_path=".env.local")

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("direct-agent")

async def main():
    # Load credentials
    url = os.getenv("LIVEKIT_URL")
    api_key = os.getenv("LIVEKIT_API_KEY")
    api_secret = os.getenv("LIVEKIT_API_SECRET")
    room_name = "worldweaver-room"
    
    if not all([url, api_key, api_secret]):
        logger.error("Missing LiveKit credentials in .env.local")
        return

    logger.info(f"--- Agent Starting (Direct Mode) ---")
    
    # 1. Generate Token for the Agent
    token = (
        api.AccessToken(api_key, api_secret)
        .with_identity("WorldWeaver-Agent")
        .with_name("WorldWeaver AI")
        .with_grants(api.VideoGrants(room_join=True, room=room_name))
        .to_jwt()
    )

    # 2. Connect to the Room
    room = rtc.Room()
    logger.info(f"Connecting to {url}...")
    
    try:
        await room.connect(url, token)
        logger.info(f"Connected to room: {room.name}")
        
        # 3. Setup the Voice Assistant
        assistant = voice.Agent(
            instructions="You are the WorldWeaver voice assistant. You help answer questions about history for students. "
                         "Keep your responses concise and helpful. Respond with a friendly, creative tone. Make the information digestible.",
            stt=openai.STT(),
            llm=openai.LLM(model="gpt-4o-mini"),
            tts=openai.TTS(),
            vad=silero.VAD.load(),
        )

        session = voice.AgentSession()

        @room.on("data_received")
        def on_data_received(data: rtc.DataPacket):
            try:
                import json
                payload = json.loads(data.data.decode())
                if payload.get("type") == "visual_context":
                    context = payload.get("content")
                    logger.info(f"Received visual context: {context}")
                    # Update the assistant's memory/context for the next interaction
                    if hasattr(assistant, 'chat_ctx'):
                        assistant.chat_ctx.append(
                            role="system",
                            text=f"The current visual context (what the user sees) is: {context}. "
                                 f"Use this information to better understand the user's request."
                        )
            except Exception as e:
                logger.error(f"Error processing data packet: {e}")

        @session.on("user_speech_committed")
        def on_user_speech(msg: voice.UserInputTranscribedEvent):
            logger.info(f"USER: {msg.text}")

        @session.on("agent_speech_committed")
        def on_agent_speech(msg: voice.SpeechCreatedEvent):
            logger.info(f"AGENT: {msg.text[:50]}...")

        # Start the assistant session for this room
        logger.info("Starting Assistant Session...")
        await session.start(assistant, room=room)
        
        # Initial greeting
        session.say("World Weaver agent connected. How can I help you?")

        # 4. Keep alive until room disconnects
        logger.info("Agent is live. Waiting for user interaction...")
        while room.connection_state == rtc.ConnectionState.CONN_CONNECTED:
            await asyncio.sleep(1)
            
    except Exception as e:
        logger.error(f"Error: {e}", exc_info=True)
    finally:
        await room.disconnect()
        logger.info("--- Agent Disconnected ---")

if __name__ == "__main__":
    asyncio.run(main())
