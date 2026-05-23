import random
import math
import base64
from typing import List, Dict

CHUNK_SIZE = 250
ROBUST_C = 0.1
ROBUST_DELTA = 0.5

def xor_bytes(a: bytes, b: bytes) -> bytes:
    length = max(len(a), len(b))
    a = a.ljust(length, b'\0')
    b = b.ljust(length, b'\0')
    return bytes(x ^ y for x, y in zip(a, b))

def ideal_soliton(K: int, d: int) -> float:
    if d == 1: return 1.0 / K
    return 1.0 / (d * (d - 1))

def robust_soliton(K: int) -> List[float]:
    R = ROBUST_C * math.log(K / ROBUST_DELTA) * math.sqrt(K)
    tau = [0.0] * (K + 1)
    for d in range(1, int(K / R) + 1): tau[d] = R / (d * K)
    for d in range(int(K / R) + 1, K + 1): tau[d] = 0.0
    tau[int(K / R)] += R * math.log(R / ROBUST_DELTA) / K
    mu = [0.0] * (K + 1)
    for d in range(1, K + 1): mu[d] = ideal_soliton(K, d) + tau[d]
    Z = sum(mu)
    return [m / Z for m in mu]

def sample_degree(probabilities: List[float], prng: random.Random) -> int:
    r = prng.random()
    cumulative = 0.0
    for i, p in enumerate(probabilities):
        if i == 0: continue
        cumulative += p
        if r < cumulative: return i
    return len(probabilities) - 1

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
                                self.droplets[j]["payload"] = bytes([a ^ b for a, b in zip(self.droplets[j]["payload"], d["payload"])])
                                self.droplets[j]["indices"].remove(idx)
                        changed = True
                    self.droplets.pop(i)

# Simulate File
full_data = bytearray(b"Hello World! This is a test string to see if the fountain code perfectly encodes and decodes. Let's make it slightly longer. " * 50)
total_len = len(full_data)

blocks = []
N = math.ceil(len(full_data) / CHUNK_SIZE)
for i in range(N):
    chunk = full_data[i*CHUNK_SIZE:(i+1)*CHUNK_SIZE]
    chunk = chunk.ljust(CHUNK_SIZE, b'\0')
    blocks.append(chunk)

total_blocks = len(blocks)
probabilities = robust_soliton(total_blocks)
state = ReceiverState()
state.receiver_file_id = "TEST"
state.total_blocks = total_blocks

print(f"Total blocks: {total_blocks}")

# Generate and receive droplets until complete
generated = 0
while not state.is_done:
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
    qr_text = f"TEST|{total_blocks}|{seed}|{b64_payload}"
    generated += 1
    
    # Receive
    parts = qr_text.split('|')
    recv_seed = int(parts[2])
    recv_payload = base64.b64decode(parts[3])
    
    recv_prng = random.Random(recv_seed)
    recv_probs = robust_soliton(state.total_blocks)
    recv_degree = sample_degree(recv_probs, recv_prng)
    if recv_degree > state.total_blocks: recv_degree = state.total_blocks
    if recv_degree < 1: recv_degree = 1
    recv_indices = set(recv_prng.sample(range(state.total_blocks), recv_degree))
    
    for solved_idx, solved_payload in state.solved_blocks.items():
        if solved_idx in recv_indices:
            recv_payload = xor_bytes(recv_payload, solved_payload)
            recv_indices.remove(solved_idx)
            
    if len(recv_indices) > 0:
        state.droplets.append({"indices": recv_indices, "payload": recv_payload})
        state.process_droplets()
        
    if state.solved_count == state.total_blocks:
        state.is_done = True
        
print(f"Done in {generated} droplets")

recv_full_data = bytearray(state.total_blocks * CHUNK_SIZE)
for i in range(state.total_blocks):
    recv_full_data[i*CHUNK_SIZE : (i+1)*CHUNK_SIZE] = state.solved_blocks[i]

recv_full_data = recv_full_data[:total_len]
if recv_full_data == full_data:
    print("SUCCESS! Data matches perfectly.")
else:
    print("FAIL! Data corruption detected.")
