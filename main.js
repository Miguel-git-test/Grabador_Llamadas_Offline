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
const startRecording = async () => {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream);
        audioChunks = [];

        mediaRecorder.ondataavailable = (event) => {
            audioChunks.push(event.data);
        };

        mediaRecorder.onstop = async () => {
            const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
            await saveRecording(audioBlob);
            renderGallery();
        };

        mediaRecorder.start();
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
const saveRecording = async (blob) => {
    const transaction = db.transaction(['recordings'], 'readwrite');
    const store = transaction.objectStore('recordings');
    const recording = {
        name: `Llamada ${new Date().toLocaleString()}`,
        date: new Date().toISOString(),
        blob: blob,
        duration: document.getElementById('timer').innerText
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
        item.className = 'recording-item glass';
        item.innerHTML = `
            <div class="recording-info">
                <div class="recording-title">${rec.name}</div>
                <div class="recording-meta">${new Date(rec.date).toLocaleDateString()} • ${rec.duration}</div>
            </div>
            <div class="recording-actions">
                <button class="action-btn play" title="Reproducir"><i data-lucide="play"></i></button>
                <button class="action-btn rename" title="Renombrar"><i data-lucide="edit-3"></i></button>
                <button class="action-btn delete" title="Borrar"><i data-lucide="trash-2"></i></button>
                <button class="action-btn download" title="Descargar"><i data-lucide="download"></i></button>
            </div>
        `;

        // Action Handlers
        item.querySelector('.play').onclick = () => playAudio(rec.blob);
        item.querySelector('.rename').onclick = () => renameRecording(rec.id, rec.name);
        item.querySelector('.delete').onclick = () => deleteRecording(rec.id);
        item.querySelector('.download').onclick = () => downloadAudio(rec.blob, rec.name);

        list.appendChild(item);
    });
    lucide.createIcons();
};

const playAudio = (blob) => {
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.play();
};

const downloadAudio = (blob, name) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name}.webm`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
};

// -- Initialization --
document.addEventListener('DOMContentLoaded', async () => {
    await initDB();
    initNavigation();

    // Register Service Worker
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js')
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
