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

    // --- FOUNTAIN CODE UTILS ---
    class PRNG {
        constructor(seed) { this.state = seed >>> 0; }
        next() {
            this.state = (this.state * 1664525 + 1013904223) >>> 0;
            return this.state;
        }
    }

    function getIndices(seed, degree, numBlocks) {
        let prng = new PRNG(seed);
        let indices = new Set();
        while (indices.size < degree) {
            indices.add(prng.next() % numBlocks);
        }
        return Array.from(indices);
    }

    function sampleDegree(numBlocks) {
        let r = Math.random();
        if (r < 0.5) return 1;
        if (r < 0.8) return 2;
        if (r < 0.95) return 3;
        return Math.floor(Math.random() * numBlocks) + 1;
    }

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

    function xorArrays(a, b) {
        let res = new Uint8Array(a.length);
        for (let i = 0; i < a.length; i++) res[i] = a[i] ^ b[i];
        return res;
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

    const CHUNK_SIZE = 100; // Optimized size for fast L-level scanning on any device
    let fountainBlocks = [];
    let flashInterval = null;
    let currentFrame = 0;
    let qrcode = null;
    let fileIdStr = "";

    dropZone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', e => {
        if (e.target.files.length) handleFile(e.target.files[0]);
    });

    function updateEstTime() {
        if (fountainBlocks.length > 0) {
            const fps = parseInt(fpsSlider.value);
            const estSeconds = Math.ceil((fountainBlocks.length) / fps);
            estTime.textContent = `EST: ~${estSeconds}s FOR ${fountainBlocks.length} BLOCKS`;
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
        fountainBlocks = [];
        dropZone.classList.remove('hidden');
        document.getElementById('connect-info').classList.remove('hidden');
        fileInfo.classList.add('hidden');
        sendSettings.classList.add('hidden');
        startFlashBtn.classList.add('hidden');
        removeFileBtn.classList.add('hidden');
    }
    removeFileBtn.addEventListener('click', resetSender);

    function handleFile(file) {
        fileName.textContent = file.name;
        fileSize.textContent = formatBytes(file.size);
        dropZone.classList.add('hidden');
        document.getElementById('connect-info').classList.add('hidden');
        fileInfo.classList.remove('hidden');
        sendSettings.classList.remove('hidden');
        startFlashBtn.classList.remove('hidden');
        removeFileBtn.classList.remove('hidden');

        startFlashBtn.disabled = true;
        startFlashBtn.textContent = "PROCESSING...";

        const reader = new FileReader();
        reader.onload = e => {
            prepareChunks(file.name, file.type, e.target.result);
            startFlashBtn.disabled = false;
            startFlashBtn.textContent = "START TRANSFER";
        };
        reader.readAsArrayBuffer(file);
    }

    function prepareChunks(filename, mime, buffer) {
        fileIdStr = Math.random().toString(36).substring(2, 6).toUpperCase();

        const metaStr = JSON.stringify({ n: filename, m: mime, l: buffer.byteLength });
        const metaBytes = new TextEncoder().encode(metaStr);
        const totalLen = 2 + metaBytes.length + buffer.byteLength;

        let fullData = new Uint8Array(totalLen);
        fullData[0] = (metaBytes.length >> 8) & 0xFF;
        fullData[1] = metaBytes.length & 0xFF;
        fullData.set(metaBytes, 2);
        fullData.set(new Uint8Array(buffer), 2 + metaBytes.length);

        fountainBlocks = [];
        const N = Math.ceil(fullData.length / CHUNK_SIZE);
        for (let i = 0; i < N; i++) {
            let chunk = new Uint8Array(CHUNK_SIZE);
            let slice = fullData.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
            chunk.set(slice);
            fountainBlocks.push(chunk);
        }

        updateEstTime();
    }

    startFlashBtn.addEventListener('click', () => {
        if (!fountainBlocks.length) return;
        switchState('state-send-flash');
        currentFrame = 0;
        startFlashingInterval();
    });

    stopFlashBtn.addEventListener('click', () => {
        stopFlashing();
        switchState('state-send-init');
    });

    function startFlashingInterval() {
        if (!qrcode) {
            qrcode = new QRCode(document.getElementById('qrcode'), {
                width: 280, height: 280,
                colorDark: "#000000", colorLight: "#ffffff",
                correctLevel: QRCode.CorrectLevel.L
            });
        }
        const fps = parseInt(fpsSlider.value);
        const intervalMs = 1000 / fps;

        flashInterval = setInterval(() => {
            const seed = Math.floor(Math.random() * 0xFFFFFFFF);
            let degree = sampleDegree(fountainBlocks.length);
            if (degree > fountainBlocks.length) degree = fountainBlocks.length;

            const indices = getIndices(seed, degree, fountainBlocks.length);

            let payload = new Uint8Array(CHUNK_SIZE);
            for (let idx of indices) {
                payload = xorArrays(payload, fountainBlocks[idx]);
            }

            const b64 = uint8ToBase64(payload);
            const qrStr = `LT|${fileIdStr}|${fountainBlocks.length}|${seed}|${degree}|${b64}`;

            qrcode.clear();
            qrcode.makeCode(qrStr);

            currentFrame++;
            flashProgress.style.width = `${(currentFrame % fountainBlocks.length) / fountainBlocks.length * 100}%`;
            flashText.textContent = `FLASHED: ${currentFrame} (ENDLESS FOUNTAIN)`;
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
    let receiverFileId = null;

    let solvedBlocks = [];
    let droplets = [];
    let solvedCount = 0;
    let totalReceiverBlocks = 0;

    startScanBtn.addEventListener('click', () => {
        initAudio(); // Initialize audio context on user interaction
        solvedBlocks = [];
        droplets = [];
        solvedCount = 0;
        totalReceiverBlocks = 0;
        receiverFileId = null;

        receiveProgress.style.width = '0%';
        receiveText.textContent = '0/0 BLOCKS';

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
            alert("CAMERA ERROR: " + err);
            switchState('state-receive-init');
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
        if (!text.startsWith('LT|')) return;

        const parts = text.split('|');
        if (parts.length < 6) return;

        const fileId = parts[1];
        const N = parseInt(parts[2]);
        const seed = parseInt(parts[3]);
        const degree = parseInt(parts[4]);
        const payload = base64ToUint8(parts[5]);

        if (!receiverFileId) {
            receiverFileId = fileId;
            totalReceiverBlocks = N;
            solvedBlocks = new Array(N).fill(null);
        } else if (receiverFileId !== fileId) return;

        const indices = getIndices(seed, degree, N);
        let droplet = { indices: new Set(indices), payload: payload };

        let isUseful = false;

        // XOR out any already solved blocks
        for (let idx of Array.from(droplet.indices)) {
            if (solvedBlocks[idx]) {
                droplet.payload = xorArrays(droplet.payload, solvedBlocks[idx]);
                droplet.indices.delete(idx);
            }
        }

        if (droplet.indices.size > 0) {
            droplets.push(droplet);
            isUseful = true;
        }

        if (isUseful) {
            triggerTick();
        }

        processDroplets();

        receiveProgress.style.width = `${(solvedCount / totalReceiverBlocks) * 100}%`;
        receiveText.textContent = `${solvedCount}/${totalReceiverBlocks} BLOCKS`;

        if (solvedCount === totalReceiverBlocks && totalReceiverBlocks > 0) {
            finalizeTransfer();
        }
    }

    function processDroplets() {
        let changed = true;
        while (changed) {
            changed = false;
            for (let i = droplets.length - 1; i >= 0; i--) {
                let d = droplets[i];
                if (d.indices.size === 1) {
                    let idx = Array.from(d.indices)[0];
                    if (!solvedBlocks[idx]) {
                        solvedBlocks[idx] = d.payload;
                        solvedCount++;

                        // XOR this solved block from all other droplets
                        for (let j = 0; j < droplets.length; j++) {
                            if (i !== j && droplets[j].indices.has(idx)) {
                                droplets[j].payload = xorArrays(droplets[j].payload, d.payload);
                                droplets[j].indices.delete(idx);
                            }
                        }
                        changed = true;
                    }
                    droplets.splice(i, 1);
                }
            }
        }
    }

    function finalizeTransfer() {
        stopScanning();
        triggerSuccess();

        let fullData = new Uint8Array(totalReceiverBlocks * CHUNK_SIZE);
        for (let i = 0; i < totalReceiverBlocks; i++) {
            fullData.set(solvedBlocks[i], i * CHUNK_SIZE);
        }

        const metaLen = (fullData[0] << 8) | fullData[1];
        const metaBytes = fullData.slice(2, 2 + metaLen);
        const metaStr = new TextDecoder().decode(metaBytes);
        const meta = JSON.parse(metaStr);

        const fileBytes = fullData.slice(2 + metaLen, 2 + metaLen + meta.l);

        const blob = new Blob([fileBytes], { type: meta.m });
        const url = URL.createObjectURL(blob);

        receivedFilename.textContent = meta.n;
        downloadBtn.href = url;
        downloadBtn.download = meta.n;

        switchState('state-receive-done');
    }

    function formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024, sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
});
