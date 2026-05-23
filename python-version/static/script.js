document.addEventListener('DOMContentLoaded', () => {
    // Tab switching
    const tabs = document.querySelectorAll('.tab-btn');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            if (tab.dataset.tab === 'send') {
                switchState('state-send-init');
                stopScanning();
            } else {
                switchState('state-receive-init');
                stopFlashing();
            }
        });
    });

    function switchState(stateId) {
        document.querySelectorAll('.state-panel').forEach(p => p.classList.remove('active'));
        document.getElementById(stateId).classList.add('active');
    }

    // --- Generate Connect Phone QR ---
    fetch('/api/ip')
        .then(res => res.json())
        .then(data => {
            document.getElementById('connect-url').textContent = data.url;
            new QRCode(document.getElementById('connect-qrcode'), {
                text: data.url,
                width: 180, height: 180,
                colorDark: "#000000", colorLight: "#ffffff",
                correctLevel: QRCode.CorrectLevel.L
            });
        }).catch(() => { });

    function uint8ToBase64(u8) {
        let bin = '';
        for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
        return btoa(bin);
    }

    function base64ToUint8(b64) {
        let bin = atob(b64);
        let u8 = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
        return u8;
    }

    function getWSUrl(endpoint) {
        let protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        return `${protocol}//${window.location.host}${endpoint}`;
    }

    // --- SENDER LOGIC ---
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');
    const fileInfo = document.getElementById('file-info');
    const fileName = document.getElementById('file-name');
    const fileSize = document.getElementById('file-size');
    const sendSettings = document.getElementById('send-settings');
    const startFlashBtn = document.getElementById('start-flash-btn');
    const removeFileBtn = document.getElementById('remove-file-btn');
    const fpsSlider = document.getElementById('fps-slider');
    const fpsDisplay = document.getElementById('fps-display');
    const flashProgress = document.getElementById('flash-progress');
    const flashText = document.getElementById('flash-text');
    const stopFlashBtn = document.getElementById('stop-flash-btn');
    const estTime = document.getElementById('est-time');
    const textInput = document.getElementById('text-input');
    const orDivider = document.getElementById('or-divider');

    let flashInterval = null;
    let currentFrame = 0;
    let qrcode = null;

    let senderWS = null;
    let senderFileId = null;
    let senderTotalBlocks = 0;

    function connectSenderWS() {
        if (!senderWS || senderWS.readyState !== WebSocket.OPEN) {
            senderWS = new WebSocket(getWSUrl("/ws/sender"));
            senderWS.onmessage = (event) => {
                let data = JSON.parse(event.data);
                if (data.type === "ready") {
                    senderFileId = data.fileId;
                    senderTotalBlocks = data.totalBlocks;

                    const fps = parseInt(fpsSlider.value);
                    const estSeconds = Math.ceil(senderTotalBlocks / fps);
                    estTime.textContent = `EST: ~${estSeconds}s FOR ${senderTotalBlocks} BLOCKS`;

                    startFlashBtn.disabled = false;
                    startFlashBtn.textContent = "START TRANSFER";
                } else if (data.type === "chunk") {
                    if (!qrcode) {
                        qrcode = new QRCode(document.getElementById('qrcode'), {
                            width: 280, height: 280,
                            colorDark: "#000000", colorLight: "#ffffff",
                            correctLevel: QRCode.CorrectLevel.L
                        });
                    }
                    qrcode.clear();
                    qrcode.makeCode(data.text);
                    currentFrame++;
                    flashProgress.style.width = `${(currentFrame % senderTotalBlocks) / senderTotalBlocks * 100}%`;
                    flashText.textContent = `FLASHED: ${currentFrame} (PYTHON WS FOUNTAIN)`;
                }
            };
        }
    }

    dropZone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', e => {
        if (e.target.files.length) handleFile(e.target.files[0]);
    });

    textInput.addEventListener('input', e => {
        const text = e.target.value.trim();
        if (text.length > 0) {
            handleText(text);
        } else {
            resetSender();
        }
    });

    function updateEstTime() {
        if (senderTotalBlocks > 0) {
            const fps = parseInt(fpsSlider.value);
            const estSeconds = Math.ceil(senderTotalBlocks / fps);
            estTime.textContent = `EST: ~${estSeconds}s FOR ${senderTotalBlocks} BLOCKS`;
        } else {
            estTime.textContent = "";
        }
    }

    fpsSlider.addEventListener('input', e => {
        fpsDisplay.textContent = e.target.value;
        updateEstTime();
        if (flashInterval) {
            stopFlashingInterval();
            startFlashingInterval();
        }
    });

    function resetSender() {
        fileInput.value = "";
        textInput.value = "";
        senderTotalBlocks = 0;
        dropZone.classList.remove('hidden');
        textInput.classList.remove('hidden');
        orDivider.classList.remove('hidden');
        document.getElementById('connect-info').classList.remove('hidden');
        fileInfo.classList.add('hidden');
        sendSettings.classList.add('hidden');
        startFlashBtn.classList.add('hidden');
        removeFileBtn.classList.add('hidden');
        if (senderWS) {
            senderWS.close();
            senderWS = null;
        }
    }
    removeFileBtn.addEventListener('click', resetSender);

    function hideInputs() {
        dropZone.classList.add('hidden');
        textInput.classList.add('hidden');
        orDivider.classList.add('hidden');
        document.getElementById('connect-info').classList.add('hidden');
        fileInfo.classList.remove('hidden');
        sendSettings.classList.remove('hidden');
        startFlashBtn.classList.remove('hidden');
        removeFileBtn.classList.remove('hidden');
    }

    function handleText(text) {
        fileName.textContent = "Clipboard Text";
        fileSize.textContent = formatBytes(text.length);
        hideInputs();

        startFlashBtn.disabled = true;
        startFlashBtn.textContent = "PROCESSING ON PYTHON...";

        const encoder = new TextEncoder();
        const buffer = encoder.encode(text).buffer;
        prepareChunks("clipboard.txt", "text/plain", buffer);
    }

    function handleFile(file) {
        fileName.textContent = file.name;
        fileSize.textContent = formatBytes(file.size);
        hideInputs();

        startFlashBtn.disabled = true;
        startFlashBtn.textContent = "UPLOADING TO PYTHON WS...";

        const reader = new FileReader();
        reader.onload = e => {
            prepareChunks(file.name, file.type, e.target.result);
        };
        reader.readAsArrayBuffer(file);
    }

    function prepareChunks(filename, mime, buffer) {
        connectSenderWS();

        // Wait for WS to open
        let checkWS = setInterval(() => {
            if (senderWS && senderWS.readyState === WebSocket.OPEN) {
                clearInterval(checkWS);
                const b64 = uint8ToBase64(new Uint8Array(buffer));
                senderWS.send(JSON.stringify({
                    type: "init",
                    filename: filename,
                    mime: mime,
                    data: b64
                }));
            }
        }, 100);
    }

    startFlashBtn.addEventListener('click', () => {
        if (!senderTotalBlocks) return;
        switchState('state-send-flash');
        currentFrame = 0;
        startFlashingInterval();
    });

    stopFlashBtn.addEventListener('click', () => {
        stopFlashing();
        switchState('state-send-init');
    });

    function startFlashingInterval() {
        const fps = parseInt(fpsSlider.value);
        const intervalMs = 1000 / fps;

        flashInterval = setInterval(() => {
            if (senderWS && senderWS.readyState === WebSocket.OPEN) {
                senderWS.send("next");
            }
        }, intervalMs);
    }

    function stopFlashingInterval() {
        if (flashInterval) clearInterval(flashInterval);
    }

    function stopFlashing() {
        stopFlashingInterval();
    }

    // --- HAPTIC & AUDIO FEEDBACK ---
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    let audioCtx = null;

    function initAudio() {
        if (!audioCtx) audioCtx = new AudioContext();
        if (audioCtx.state === 'suspended') audioCtx.resume();
    }

    function triggerTick() {
        if (navigator.vibrate) navigator.vibrate(10);
        if (audioCtx) {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(800, audioCtx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(10, audioCtx.currentTime + 0.05);
            gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.05);
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.start();
            osc.stop(audioCtx.currentTime + 0.05);
        }
    }

    function triggerSuccess() {
        if (navigator.vibrate) navigator.vibrate([100, 50, 100, 50, 200]);
        if (audioCtx) {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(440, audioCtx.currentTime);
            osc.frequency.setValueAtTime(659.25, audioCtx.currentTime + 0.1);
            osc.frequency.setValueAtTime(880, audioCtx.currentTime + 0.2);
            gain.gain.setValueAtTime(0, audioCtx.currentTime);
            gain.gain.linearRampToValueAtTime(0.2, audioCtx.currentTime + 0.05);
            gain.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.4);
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.start();
            osc.stop(audioCtx.currentTime + 0.5);
        }
    }

    // --- RECEIVER LOGIC ---
    const startScanBtn = document.getElementById('start-scan-btn');
    const stopScanBtn = document.getElementById('stop-scan-btn');
    const receiveProgress = document.getElementById('receive-progress');
    const receiveText = document.getElementById('receive-text');
    const receivedFilename = document.getElementById('received-filename');
    const downloadBtn = document.getElementById('download-btn');
    const resetReceiveBtn = document.getElementById('reset-receive-btn');

    let html5QrcodeScanner = null;
    let receiverWS = null;

    function connectReceiverWS() {
        if (!receiverWS || receiverWS.readyState !== WebSocket.OPEN) {
            receiverWS = new WebSocket(getWSUrl("/ws/receiver"));
            receiverWS.onmessage = (event) => {
                let data = JSON.parse(event.data);
                if (data.type === "progress") {
                    triggerTick();
                    receiveProgress.style.width = `${(data.solved / data.total) * 100}%`;
                    receiveText.textContent = `${data.solved}/${data.total} BLOCKS`;
                } else if (data.type === "complete") {
                    finalizeTransfer(data.meta, data.file);
                }
            };
        } else {
            receiverWS.send(JSON.stringify({ type: "reset" }));
        }
    }

    startScanBtn.addEventListener('click', () => {
        initAudio(); // Initialize audio context on user interaction
        connectReceiverWS();

        receiveProgress.style.width = '0%';
        receiveText.textContent = 'WAITING FOR PYTHON...';

        switchState('state-receive-scan');
        startScanning();
    });

    stopScanBtn.addEventListener('click', () => {
        stopScanning();
        switchState('state-receive-init');
    });

    resetReceiveBtn.addEventListener('click', () => {
        switchState('state-receive-init');
    });

    function startScanning() {
        html5QrcodeScanner = new Html5Qrcode("reader");
        const config = { fps: 15 };

        html5QrcodeScanner.start(
            { facingMode: "environment" }, config,
            (decodedText) => handleScannedCode(decodedText),
            () => { } // ignore errors
        ).catch(err => {
            // Fallback for laptops that only have a front-facing camera
            html5QrcodeScanner.start(
                { facingMode: "user" }, config,
                (decodedText) => handleScannedCode(decodedText),
                () => { }
            ).catch(err2 => {
                alert("CAMERA ERROR: Could not start any camera.");
                switchState('state-receive-init');
            });
        });
    }

    function stopScanning() {
        if (html5QrcodeScanner) {
            html5QrcodeScanner.stop().then(() => {
                html5QrcodeScanner.clear();
                html5QrcodeScanner = null;
            }).catch(() => { });
        }
    }

    function handleScannedCode(text) {
        if (!text.includes('|')) return;

        if (receiverWS && receiverWS.readyState === WebSocket.OPEN) {
            receiverWS.send(JSON.stringify({ type: "scan", text: text }));
        }
    }

    function finalizeTransfer(meta, fileB64) {
        stopScanning();
        triggerSuccess();

        const fileBytes = base64ToUint8(fileB64);
        receivedFilename.textContent = meta.n;

        if (meta.n === "clipboard.txt") {
            const textContent = new TextDecoder().decode(fileBytes);
            document.getElementById('download-btn').classList.add('hidden');
            document.getElementById('copy-text-btn').classList.remove('hidden');
            const textDisplay = document.getElementById('received-text-display');
            textDisplay.classList.remove('hidden');
            textDisplay.textContent = textContent;

            document.getElementById('copy-text-btn').onclick = () => {
                navigator.clipboard.writeText(textContent);
                document.getElementById('copy-text-btn').textContent = "COPIED!";
                setTimeout(() => document.getElementById('copy-text-btn').textContent = "COPY TEXT", 2000);
            };
        } else {
            document.getElementById('download-btn').classList.remove('hidden');
            document.getElementById('copy-text-btn').classList.add('hidden');
            document.getElementById('received-text-display').classList.add('hidden');

            const blob = new Blob([fileBytes], { type: meta.m });
            const url = URL.createObjectURL(blob);
            downloadBtn.href = url;
            downloadBtn.download = meta.n;
        }

        switchState('state-receive-done');
    }

    function formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024, sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
});
