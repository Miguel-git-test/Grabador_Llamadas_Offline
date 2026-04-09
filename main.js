// VoxRecord - Main Logic

let mediaRecorder;
let audioChunks = [];
let startTime;
let timerInterval;
let db;

// -- Database Setup (IndexedDB) --
const initDB = () => {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('VoxRecordDB', 1);
        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains('recordings')) {
                db.createObjectStore('recordings', { keyPath: 'id', autoIncrement: true });
            }
        };
        request.onsuccess = (e) => {
            db = e.target.result;
            resolve(db);
        };
        request.onerror = (e) => reject(e);
    });
};

// -- Navigation --
const initNavigation = () => {
    const navItems = document.querySelectorAll('.nav-item');
    const views = document.querySelectorAll('.view');

    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const targetViewId = item.getAttribute('data-view');
            
            // Update Active Nav
            navItems.forEach(i => i.classList.remove('active'));
            item.classList.add('active');

            // Update Active View
            views.forEach(v => v.classList.remove('active'));
            document.getElementById(targetViewId).classList.add('active');

            if (targetViewId === 'gallery-view') {
                renderGallery();
            }
        });
    });
};

// -- Recording Logic --
let recordingStartTime;

const startRecording = async () => {
    try {
        // Mejoramos la calidad desactivando los filtros que pueden "ahogar" la voz en grabaciones ambientales
        const constraints = {
            audio: {
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false
            }
        };
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        mediaRecorder = new MediaRecorder(stream);
        audioChunks = [];

        mediaRecorder.ondataavailable = (event) => {
            audioChunks.push(event.data);
        };

        mediaRecorder.onstop = async () => {
            const durationMs = Date.now() - recordingStartTime;
            const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
            await saveRecording(audioBlob, durationMs);
            renderGallery();
        };

        mediaRecorder.start();
        recordingStartTime = Date.now();
        startTime = Date.now();
        updateTimer();
        timerInterval = setInterval(updateTimer, 1000);
        
        // UI Updates
        document.getElementById('record-btn').classList.add('recording');
        document.getElementById('status-text').innerText = 'Grabando...';
        document.querySelector('#record-btn i').setAttribute('data-lucide', 'square');
        lucide.createIcons();
        
        startVisualizer(stream);
    } catch (err) {
        console.error('Error accessing microphone:', err);
        alert('Err: Se requiere permiso de micrófono para grabar.');
    }
};

const stopRecording = () => {
    mediaRecorder.stop();
    mediaRecorder.stream.getTracks().forEach(track => track.stop());
    clearInterval(timerInterval);
    
    // UI Updates
    document.getElementById('record-btn').classList.remove('recording');
    document.getElementById('status-text').innerText = 'Listo para grabar';
    document.querySelector('#record-btn i').setAttribute('data-lucide', 'mic');
    document.getElementById('timer').innerText = '00:00';
    lucide.createIcons();
};

const updateTimer = () => {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const mins = String(Math.floor(elapsed / 60)).padStart(2, '0');
    const secs = String(elapsed % 60).padStart(2, '0');
    document.getElementById('timer').innerText = `${mins}:${secs}`;
};

// -- Visualizer --
const startVisualizer = (stream) => {
    const canvas = document.getElementById('visualizer');
    const ctx = canvas.getContext('2d');
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const draw = () => {
        if (!mediaRecorder || mediaRecorder.state === 'inactive') return;
        requestAnimationFrame(draw);
        analyser.getByteFrequencyData(dataArray);

        ctx.fillStyle = 'rgba(5, 5, 5, 0.2)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const barWidth = (canvas.width / bufferLength) * 2.5;
        let x = 0;

        for (let i = 0; i < bufferLength; i++) {
            const barHeight = dataArray[i] / 2;
            ctx.fillStyle = `rgb(0, ${242 + barHeight}, 254)`;
            ctx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
            x += barWidth + 1;
        }
    };
    draw();
};

// -- Storage --
const saveRecording = async (blob, durationMs) => {
    const transaction = db.transaction(['recordings'], 'readwrite');
    const store = transaction.objectStore('recordings');
    
    const elapsed = Math.floor(durationMs / 1000);
    const mins = String(Math.floor(elapsed / 60)).padStart(2, '0');
    const secs = String(elapsed % 60).padStart(2, '0');
    const formattedDuration = `${mins}:${secs}`;

    const recording = {
        name: `Llamada ${new Date().toLocaleString()}`,
        date: new Date().toISOString(),
        blob: blob,
        duration: formattedDuration,
        durationMs: durationMs
    };
    store.add(recording);
    return new Promise((resolve) => transaction.oncomplete = resolve);
};

const getAllRecordings = () => {
    return new Promise((resolve) => {
        const transaction = db.transaction(['recordings'], 'readonly');
        const store = transaction.objectStore('recordings');
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result);
    });
};

const deleteRecording = async (id) => {
    const transaction = db.transaction(['recordings'], 'readwrite');
    const store = transaction.objectStore('recordings');
    store.delete(id);
    transaction.oncomplete = () => renderGallery();
};

const renameRecording = async (id, oldName) => {
    const newName = prompt('Cambiar nombre:', oldName);
    if (!newName) return;
    
    const transaction = db.transaction(['recordings'], 'readwrite');
    const store = transaction.objectStore('recordings');
    const request = store.get(id);
    request.onsuccess = () => {
        const data = request.result;
        data.name = newName;
        store.put(data);
        renderGallery();
    };
};

// -- Gallery UI --
let currentAudio = null;
let currentAudioId = null;

const renderGallery = async () => {
    const recordings = await getAllRecordings();
    const list = document.getElementById('recordings-list');
    const emptyState = document.getElementById('empty-state');

    if (recordings.length === 0) {
        emptyState.style.display = 'block';
        list.innerHTML = '';
        list.appendChild(emptyState);
        return;
    }

    emptyState.style.display = 'none';
    list.innerHTML = '';

    recordings.reverse().forEach(rec => {
        const item = document.createElement('div');
        item.className = `recording-item glass ${currentAudioId === rec.id ? 'active' : ''}`;
        item.dataset.id = rec.id;
        
        item.innerHTML = `
            <div class="recording-header">
                <div class="recording-info">
                    <div class="recording-title">${rec.name}</div>
                    <div class="recording-meta">${new Date(rec.date).toLocaleDateString()} • ${rec.duration}</div>
                </div>
                <div class="recording-actions">
                    <button class="action-btn play-toggle" title="Reproducir">
                        <i data-lucide="${currentAudioId === rec.id ? 'pause' : 'play'}"></i>
                    </button>
                    <button class="action-btn rename" title="Renombrar"><i data-lucide="edit-3"></i></button>
                    <button class="action-btn delete" title="Borrar"><i data-lucide="trash-2"></i></button>
                    <button class="action-btn download" title="Descargar"><i data-lucide="download"></i></button>
                </div>
            </div>
            <div class="playback-container">
                <div class="seek-bar-container">
                    <span class="time-display current-time">00:00</span>
                    <input type="range" class="seek-bar" value="0" min="0" max="${rec.durationMs || 0}">
                    <span class="time-display total-time">${rec.duration}</span>
                </div>
            </div>
        `;

        // Action Handlers
        item.querySelector('.play-toggle').onclick = () => togglePlayback(rec, item);
        item.querySelector('.rename').onclick = (e) => { e.stopPropagation(); renameRecording(rec.id, rec.name); };
        item.querySelector('.delete').onclick = (e) => { e.stopPropagation(); deleteRecording(rec.id); };
        item.querySelector('.download').onclick = (e) => { e.stopPropagation(); downloadAudio(rec.blob, rec.name); };

        list.appendChild(item);
    });
    lucide.createIcons();
};

const togglePlayback = (rec, item) => {
    if (currentAudioId === rec.id) {
        if (currentAudio.paused) {
            currentAudio.play();
            item.querySelector('.play-toggle i').setAttribute('data-lucide', 'pause');
        } else {
            currentAudio.pause();
            item.querySelector('.play-toggle i').setAttribute('data-lucide', 'play');
        }
        lucide.createIcons();
        return;
    }

    // New Audio
    if (currentAudio) {
        currentAudio.pause();
        const activeItem = document.querySelector('.recording-item.active');
        if (activeItem) activeItem.classList.remove('active');
    }

    const url = URL.createObjectURL(rec.blob);
    currentAudio = new Audio(url);
    currentAudioId = rec.id;
    item.classList.add('active');
    
    const seekBar = item.querySelector('.seek-bar');
    const currentTimeDisplay = item.querySelector('.current-time');
    
    currentAudio.ontimeupdate = () => {
        const ms = currentAudio.currentTime * 1000;
        seekBar.value = ms;
        
        const elapsed = Math.floor(currentAudio.currentTime);
        const mins = String(Math.floor(elapsed / 60)).padStart(2, '0');
        const secs = String(elapsed % 60).padStart(2, '0');
        currentTimeDisplay.innerText = `${mins}:${secs}`;
    };

    seekBar.oninput = () => {
        currentAudio.currentTime = seekBar.value / 1000;
    };

    currentAudio.onended = () => {
        item.classList.remove('active');
        currentAudioId = null;
        renderGallery();
    };

    currentAudio.play();
    renderGallery(); // To update icons
};

const downloadAudio = (blob, name) => {
    const safeName = name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${safeName}.webm`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
};

// -- PWA Installation Logic --
let deferredPrompt;
const installBtn = document.getElementById('install-btn');

window.addEventListener('beforeinstallprompt', (e) => {
    // Evitar que el navegador lo muestre automáticamente
    e.preventDefault();
    deferredPrompt = e;
    // Mostrar nuestro botón personalizado
    if (installBtn) installBtn.style.display = 'flex';
});

if (installBtn) {
    installBtn.addEventListener('click', async () => {
        if (!deferredPrompt) return;
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        console.log(`User response to install: ${outcome}`);
        deferredPrompt = null;
        installBtn.style.display = 'none';
    });
}

// -- Initialization --
document.addEventListener('DOMContentLoaded', async () => {
    await initDB();
    initNavigation();

    // Register Service Worker con la ruta correcta para GitHub Pages
    if ('serviceWorker' in navigator) {
        const swPath = window.location.pathname.includes('/Grabador_Llamadas_Offline/') 
            ? '/Grabador_Llamadas_Offline/sw.js' 
            : './sw.js';

        navigator.serviceWorker.register(swPath)
            .then(() => console.log('Service Worker Registered'));
    }
    
    const recordBtn = document.getElementById('record-btn');

    recordBtn.addEventListener('click', () => {
        if (!mediaRecorder || mediaRecorder.state === 'inactive') {
            startRecording();
        } else {
            stopRecording();
        }
    });

    document.getElementById('check-perms-btn').addEventListener('click', async () => {
        try {
            await navigator.mediaDevices.getUserMedia({ audio: true });
            alert('¡Permiso de micrófono concedido!');
        } catch (e) {
            alert('No se pudo acceder al micrófono. Por favor, revisa los ajustes del navegador.');
        }
    });
});
