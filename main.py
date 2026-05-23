import os
import socket
from fastapi import FastAPI
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles

app = FastAPI(title="DropQR")

# Mount static files
app.mount("/static", StaticFiles(directory="static"), name="static")

def get_local_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(('10.255.255.255', 1))
        IP = s.getsockname()[0]
    except Exception:
        IP = '127.0.0.1'
    finally:
        s.close()
    return IP

@app.get("/", response_class=HTMLResponse)
async def read_index():
    with open("static/index.html", "r") as f:
        return f.read()

@app.get("/api/ip")
async def get_ip():
    scheme = "https" if os.path.exists("cert.pem") else "http"
    return {"url": f"{scheme}://{get_local_ip()}:8000"}

if __name__ == "__main__":
    import uvicorn
    if os.path.exists("cert.pem") and os.path.exists("key.pem"):
        uvicorn.run(app, host="0.0.0.0", port=8000, ssl_certfile="cert.pem", ssl_keyfile="key.pem")
    else:
        uvicorn.run(app, host="0.0.0.0", port=8000)
