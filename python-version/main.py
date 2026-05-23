import os
import sys
import json
import socket
import base64
import random
import math
from typing import Dict, List, Set, Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, FileResponse
from fastapi.staticfiles import StaticFiles
import uvicorn
import ssl

app = FastAPI()

app.mount("/static", StaticFiles(directory="static"), name="static")

CHUNK_SIZE = 250

def get_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(('10.255.255.255', 1))
        IP = s.getsockname()[0]
    except Exception:
        IP = '127.0.0.1'
    finally:
        s.close()
    return IP

@app.get("/")
async def get_index():
    return FileResponse("static/index.html")

@app.get("/api/ip")
async def get_ip_api():
    ip = get_ip()
    port = 8000
    protocol = "https" if os.path.exists("../cert.pem") else "http"
    return {"url": f"{protocol}://{ip}:{port}"}

class ReceiverState:
    def __init__(self):
        self.total_blocks = 0
        self.solved_blocks: Dict[int, bytes] = {}
        self.droplets: List[Dict] = []
        self.solved_count = 0
        self.receiver_file_id = None
        self.is_done = False

    def process_droplets(self):
        changed = True
        while changed:
            changed = False
            for i in range(len(self.droplets)-1, -1, -1):
                d = self.droplets[i]
                if len(d["indices"]) == 1:
                    idx = list(d["indices"])[0]
                    if idx not in self.solved_blocks:
                        self.solved_blocks[idx] = d["payload"]
                        self.solved_count += 1
                        
                        for j in range(len(self.droplets)):
                            if i != j and idx in self.droplets[j]["indices"]:
                                self.droplets[j]["payload"] = xor_bytes(self.droplets[j]["payload"], d["payload"])
                                self.droplets[j]["indices"].remove(idx)
                        changed = True
                    self.droplets.pop(i)

def xor_bytes(a: bytes, b: bytes) -> bytes:
    length = max(len(a), len(b))
    a = a.ljust(length, b'\0')
    b = b.ljust(length, b'\0')
    return bytes(x ^ y for x, y in zip(a, b))

ROBUST_C = 0.1
ROBUST_DELTA = 0.5

def ideal_soliton(K: int, d: int) -> float:
    if d == 1:
        return 1.0 / K
    return 1.0 / (d * (d - 1))

def robust_soliton(K: int) -> List[float]:
    R = ROBUST_C * math.log(K / ROBUST_DELTA) * math.sqrt(K)
    
    tau = [0.0] * (K + 1)
    for d in range(1, int(K / R) + 1):
        tau[d] = R / (d * K)
    for d in range(int(K / R) + 1, K + 1):
        tau[d] = 0.0
    tau[int(K / R)] += R * math.log(R / ROBUST_DELTA) / K

    mu = [0.0] * (K + 1)
    for d in range(1, K + 1):
        mu[d] = ideal_soliton(K, d) + tau[d]
        
    Z = sum(mu)
    return [m / Z for m in mu]

def sample_degree(probabilities: List[float], prng: random.Random) -> int:
    r = prng.random()
    cumulative = 0.0
    for i, p in enumerate(probabilities):
        if i == 0: continue
        cumulative += p
        if r < cumulative:
            return i
    return len(probabilities) - 1

@app.websocket("/ws/sender")
async def websocket_sender(websocket: WebSocket):
    await websocket.accept()
    probabilities = []
    blocks = []
    file_id = ""
    total_blocks = 0
    try:
        data = await websocket.receive_json()
        if data["type"] == "init":
            filename = data["filename"]
            mime = data["mime"]
            b64_data = data["data"]
            buffer = base64.b64decode(b64_data)
            
            file_id = ''.join(random.choices("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", k=4))
            
            meta_str = json.dumps({"n": filename, "m": mime, "l": len(buffer)})
            meta_bytes = meta_str.encode('utf-8')
            total_len = 2 + len(meta_bytes) + len(buffer)
            
            full_data = bytearray(total_len)
            full_data[0] = (len(meta_bytes) >> 8) & 0xFF
            full_data[1] = len(meta_bytes) & 0xFF
            full_data[2:2+len(meta_bytes)] = meta_bytes
            full_data[2+len(meta_bytes):] = buffer
            
            blocks = []
            N = math.ceil(len(full_data) / CHUNK_SIZE)
            for i in range(N):
                chunk = full_data[i*CHUNK_SIZE:(i+1)*CHUNK_SIZE]
                chunk = chunk.ljust(CHUNK_SIZE, b'\0')
                blocks.append(chunk)
                
            total_blocks = len(blocks)
            probabilities = robust_soliton(total_blocks)
            
            await websocket.send_json({"type": "ready", "fileId": file_id, "totalBlocks": total_blocks})
            
        while True:
            msg = await websocket.receive_text()
            if msg == "next":
                seed = random.randint(0, 0xFFFFFFFF)
                prng = random.Random(seed)
                degree = sample_degree(probabilities, prng)
                if degree > total_blocks: degree = total_blocks
                if degree < 1: degree = 1
                
                indices = prng.sample(range(total_blocks), degree)
                
                payload = bytearray(CHUNK_SIZE)
                for idx in indices:
                    payload = xor_bytes(payload, blocks[idx])
                
                b64_payload = base64.b64encode(payload).decode('utf-8')
                qr_text = f"{file_id}|{total_blocks}|{seed}|{b64_payload}"
                await websocket.send_json({"type": "chunk", "text": qr_text})

    except WebSocketDisconnect:
        pass


@app.websocket("/ws/receiver")
async def websocket_receiver(websocket: WebSocket):
    await websocket.accept()
    state = ReceiverState()
    try:
        while True:
            data = await websocket.receive_json()
            if data["type"] == "scan":
                text = data["text"]
                parts = text.split('|')
                if len(parts) == 4:
                    file_id = parts[0]
                    total_blks = int(parts[1])
                    seed = int(parts[2])
                    payload = base64.b64decode(parts[3])
                    payload = payload.ljust(CHUNK_SIZE, b'\0') # Enforce exact length
                    
                    if state.receiver_file_id is None:
                        state.receiver_file_id = file_id
                        state.total_blocks = total_blks
                        
                    if file_id == state.receiver_file_id and not state.is_done:
                        prng = random.Random(seed)
                        probabilities = robust_soliton(state.total_blocks)
                        degree = sample_degree(probabilities, prng)
                        if degree > state.total_blocks: degree = state.total_blocks
                        if degree < 1: degree = 1
                        
                        indices = set(prng.sample(range(state.total_blocks), degree))
                        
                        for solved_idx, solved_payload in state.solved_blocks.items():
                            if solved_idx in indices:
                                payload = xor_bytes(payload, solved_payload)
                                indices.remove(solved_idx)
                        
                        if len(indices) > 0:
                            state.droplets.append({"indices": indices, "payload": payload})
                            state.process_droplets()
                            
                        await websocket.send_json({"type": "progress", "solved": state.solved_count, "total": state.total_blocks})
                        
                        if state.solved_count == state.total_blocks:
                            state.is_done = True
                            full_data = bytearray(state.total_blocks * CHUNK_SIZE)
                            for i in range(state.total_blocks):
                                full_data[i*CHUNK_SIZE : (i+1)*CHUNK_SIZE] = state.solved_blocks[i]
                            
                            meta_len = (full_data[0] << 8) | full_data[1]
                            meta_bytes = full_data[2 : 2+meta_len]
                            meta = json.loads(meta_bytes.decode('utf-8'))
                            
                            file_bytes = full_data[2+meta_len : 2+meta_len+meta['l']]
                            b64_file = base64.b64encode(file_bytes).decode('utf-8')
                            
                            await websocket.send_json({"type": "complete", "meta": meta, "file": b64_file})

            elif data["type"] == "reset":
                state = ReceiverState()
                
    except WebSocketDisconnect:
        pass

if __name__ == "__main__":
    ip = get_ip()
    port = 8000
    
    cert_path = "../cert.pem"
    key_path = "../key.pem"

    if os.path.exists(cert_path) and os.path.exists(key_path):
        print(f"\nDROPQR STARTED -> https://{ip}:{port}")
        uvicorn.run("main:app", host="0.0.0.0", port=port, ssl_keyfile=key_path, ssl_certfile=cert_path)
    else:
        print(f"\nDROPQR STARTED -> http://{ip}:{port}")
        uvicorn.run("main:app", host="0.0.0.0", port=port)
