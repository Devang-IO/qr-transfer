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
    let qrChunks = [];
    let flashInterval = null;
    let currentFrame = 0;
    let qrcode = null;

    dropZone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', e => {
        if (e.target.files.length) handleFile(e.target.files[0]);
    });

    function updateEstTime() {
        if (qrChunks.length > 0) {
            const fps = parseInt(fpsSlider.value);
            const estSeconds = Math.ceil(qrChunks.length / fps);
            estTime.textContent = `LOOP: ${estSeconds}s FOR ${qrChunks.length} FRAMES`;
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

    removeFileBtn.addEventListener('click', resetSender);

    function resetSender() {
        fileInput.value = "";
        qrChunks = [];
        dropZone.classList.remove('hidden');
        document.getElementById('connect-info').classList.remove('hidden');
        fileInfo.classList.add('hidden');
        sendSettings.classList.add('hidden');
        startFlashBtn.classList.add('hidden');
        removeFileBtn.classList.add('hidden');
    }

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
            const base64Data = e.target.result.split(',')[1];
            prepareChunks(file.name, file.type, base64Data);
            startFlashBtn.disabled = false;
            startFlashBtn.textContent = "START TRANSFER";
        };
        reader.readAsDataURL(file);
    }

    function prepareChunks(filename, mime, base64) {
        const fileId = Math.random().toString(36).substring(2, 6).toUpperCase();
        qrChunks = [];
        const totalDataChunks = Math.ceil(base64.length / CHUNK_SIZE);
        const totalChunks = totalDataChunks + 1;

        qrChunks.push(`DQR|${fileId}|0|${totalChunks}|META|${filename}|${mime}`);

        for (let i = 0; i < totalDataChunks; i++) {
            const chunkData = base64.substring(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
            qrChunks.push(`DQR|${fileId}|${i + 1}|${totalChunks}|DATA|${chunkData}`);
        }

        updateEstTime();
    }

    startFlashBtn.addEventListener('click', () => {
        if (!qrChunks.length) return;
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
            qrcode.clear();
            qrcode.makeCode(qrChunks[currentFrame]);

            flashProgress.style.width = `${((currentFrame + 1) / qrChunks.length) * 100}%`;
            flashText.textContent = `FRAME ${currentFrame + 1}/${qrChunks.length}`;

            currentFrame = (currentFrame + 1) % qrChunks.length;
        }, intervalMs);
    }

    function stopFlashingInterval() {
        if (flashInterval) clearInterval(flashInterval);
    }

    function stopFlashing() {
        stopFlashingInterval();
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
    let receivedChunks = new Map();
    let receiverFileId = null;
    let receiverTotalChunks = 0;
    let receiverMeta = null;

    startScanBtn.addEventListener('click', () => {
        receivedChunks.clear();
        receiverFileId = null;
        receiverTotalChunks = 0;
        receiverMeta = null;
        receiveProgress.style.width = '0%';
        receiveText.textContent = '0/0 CHUNKS';

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
        if (!text.startsWith('DQR|')) return;

        const parts = text.split('|');
        if (parts.length < 5) return;

        const fileId = parts[1];
        const index = parseInt(parts[2]);
        const total = parseInt(parts[3]);
        const type = parts[4];

        if (!receiverFileId) {
            receiverFileId = fileId;
            receiverTotalChunks = total;
        } else if (receiverFileId !== fileId) return;

        if (!receivedChunks.has(index)) {
            if (type === 'META') {
                receiverMeta = { filename: parts[5], mime: parts[6] };
            } else {
                receivedChunks.set(index, parts.slice(5).join('|'));
            }

            const count = receivedChunks.size + (receiverMeta ? 1 : 0);
            receiveProgress.style.width = `${(count / total) * 100}%`;
            receiveText.textContent = `${count}/${total} CHUNKS`;

            if (count === total && receiverMeta) finalizeTransfer();
        }
    }

    function finalizeTransfer() {
        stopScanning();
        let fullBase64 = "";
        for (let i = 1; i < receiverTotalChunks; i++) fullBase64 += receivedChunks.get(i);

        receivedFilename.textContent = receiverMeta.filename;
        downloadBtn.href = `data:${receiverMeta.mime};base64,${fullBase64}`;
        downloadBtn.download = receiverMeta.filename;

        switchState('state-receive-done');
    }

    function formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024, sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
});
