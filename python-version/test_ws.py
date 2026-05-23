import asyncio
import websockets
import json
import base64
import ssl

async def test():
    ssl_context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    ssl_context.check_hostname = False
    ssl_context.verify_mode = ssl.CERT_NONE
    
    # Sender
    async with websockets.connect("wss://127.0.0.1:8000/ws/sender", ssl=ssl_context) as sender_ws:
        file_data = b'{"hello": "world", "this": "is a test of the websocket pipeline"}' * 20
        b64_data = base64.b64encode(file_data).decode('utf-8')
        
        await sender_ws.send(json.dumps({
            "type": "init",
            "filename": "test.json",
            "mime": "application/json",
            "data": b64_data
        }))
        
        ready = json.loads(await sender_ws.recv())
        total_blocks = ready["totalBlocks"]
        print(f"Total blocks: {total_blocks}")
        
        # Receiver
        async with websockets.connect("wss://127.0.0.1:8000/ws/receiver", ssl=ssl_context) as recv_ws:
            received = 0
            while received < total_blocks + 20: # Over-request slightly
                await sender_ws.send("next")
                chunk_msg = json.loads(await sender_ws.recv())
                qr_text = chunk_msg["text"]
                
                await recv_ws.send(json.dumps({"type": "scan", "text": qr_text}))
                reply = json.loads(await recv_ws.recv())
                if reply["type"] == "progress":
                    pass
                elif reply["type"] == "complete":
                    print("SUCCESS! File decoded over WebSockets!")
                    decoded_file = base64.b64decode(reply["file"])
                    assert decoded_file == file_data
                    return

    print("FAILED to decode file.")

asyncio.run(test())
