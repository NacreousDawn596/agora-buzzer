import requests
import json
import asyncio
import websockets

API_BASE = "http://https://agora-buzzer.fly.dev/"
WS_BASE = "ws://https://agora-buzzer.fly.dev/"

async def test_admin_ws():
    print("--- Testing Admin Login and WS ---")
    
    # 1. Login
    login_data = {"username": "admin", "password": "agora2025!"}
    res = requests.post(f"{API_BASE}/login", json=login_data)
    if res.status_code != 200:
        print(f"FAILED: Login failed with {res.status_code}: {res.text}")
        return
    
    data = res.json()
    ws_token = data.get("ws_token")
    if not ws_token:
        print("FAILED: ws_token missing from login response")
        return
    
    print(f"SUCCESS: Got ws_token: {ws_token[:20]}...")

    # 2. Connect to WS
    ws_url = f"{WS_BASE}/ws/session/main?token={ws_token}"
    try:
        async with websockets.connect(ws_url) as websocket:
            print("SUCCESS: Connected to WebSocket")
            
            # 3. Wait for connection message
            msg = await websocket.recv()
            msg_data = json.loads(msg)
            print(f"RECEIVED: {msg_data.get('type')}")
            
            if msg_data.get("type") == "connected" and msg_data.get("role") == "admin":
                print("PASSED: Admin WS connection fully verified")
            else:
                print(f"FAILED: Unexpected welcome message: {msg_data}")
                
    except Exception as e:
        print(f"FAILED: WebSocket connection failed: {e}")

if __name__ == "__main__":
    asyncio.run(test_admin_ws())
