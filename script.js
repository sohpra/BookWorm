// 1. CONFIGURATION
const GOOGLE_SHEET_URL = "https://script.google.com/macros/s/AKfycbw1oZV1HEO21oadgp6IKkq9XR4v-2fwuinuKnAr_U1SyFYIrWqcNIpy6gux44pzgBAa_g/exec"; 
const Quagga_CDN = "https://cdn.jsdelivr.net/npm/@ericblade/quagga2/dist/quagga.min.js";

let myLibrary = [];
let isScanning = false;

// 2. NAVIGATION (The "Visibility First" Logic)
function showView(viewId) {
    // Hide all views
    document.querySelectorAll('.view').forEach(v => v.style.display = 'none');
    
    // Show selected view
    const target = document.getElementById(viewId);
    if (target) target.style.display = 'block';

    if (viewId === 'view-scanner') {
        // ESSENTIAL: Wait for the browser to "paint" the div before starting camera
        setTimeout(() => { 
            startScanner(); 
        }, 300);
    } else {
        if (window.Quagga) {
            Quagga.stop();
            // Clear the video element to release the camera hardware
            document.getElementById('interactive').innerHTML = '';
        }
        isScanning = false;
    }
}

// 3. SCANNER LOGIC
async function startScanner() {
    isScanning = true;
    const container = document.getElementById('interactive');
    container.innerHTML = ''; // Reset container

    // Load library if not present
    if (!window.Quagga) {
        const s = document.createElement("script");
        s.src = Quagga_CDN;
        await new Promise(r => s.onload = r);
        document.head.appendChild(s);
    }

    // HANDSHAKE: Explicitly request permission
    try {
        await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
    } catch (e) {
        alert("Camera access denied. Check your browser settings and ensure you are on HTTPS.");
        return;
    }

    Quagga.init({
        inputStream: {
            name: "Live",
            type: "LiveStream",
            target: container,
            constraints: { 
                facingMode: "environment",
                width: { ideal: 1280 },
                height: { ideal: 720 }
            }
        },
        decoder: { readers: ["ean_reader"] },
        locate: true
    }, (err) => {
        if (err) {
            console.error("Quagga Init Error:", err);
            return;
        }
        Quagga.start();
        
        // Fix for Safari/iPhone to prevent full-screen takeover
        const video = container.querySelector('video');
        if (video) {
            video.setAttribute("playsinline", "true"); 
            video.play();
        }
    });

    Quagga.onDetected(handleDetection);
}

// 4. DETECTION HANDLER
async function handleDetection(data) {
    if (!isScanning) return;
    isScanning = false;
    Quagga.stop();

    if (navigator.vibrate) navigator.vibrate(100);
    
    const isbn = data.codeResult.code;
    await handleScannedBook(isbn);
}

// 5. DATA PROCESSING
async function handleScannedBook(isbn) {
    showStatus("Searching...", "#6c5ce7");
    try {
        const res = await fetch(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}`);
        const data = await res.json();
        
        let info = { title: "Unknown", authors: ["Unknown"] };
        if (data.items && data.items.length > 0) info = data.items[0].volumeInfo;

        const hasRead = await askReadStatus(info.title);

        // Fix Mixed Content warning for images
        let imgUrl = info.imageLinks ? info.imageLinks.thumbnail : "https://via.placeholder.com/50x75?text=No+Cover";
        imgUrl = imgUrl.replace("http://", "https://");

        const newBook = {
            id: Date.now().toString(36),
            isbn: isbn,
            title: info.title,
            author: info.authors ? info.authors.join(', ') : "Unknown",
            image: imgUrl,
            isRead: hasRead
        };

        myLibrary.push(newBook);
        saveLibrary();
        renderLibrary();
        cloudSync('add', newBook);
        showView('view-library');
    } catch (err) {
        showStatus("Book not found", "#dc3545");
        showView('view-home');
    }
}

// 6. CLOUD & UTILS
async function loadLibrary() {
    showStatus("Syncing...", "#17a2b8");
    try {
        const response = await fetch(GOOGLE_SHEET_URL, { redirect: 'follow' });
        const data = await response.json();
        if (Array.isArray(data)) {
            myLibrary = data.map(b => ({ ...b, id: Math.random().toString(36).substr(2, 9) }));
            renderLibrary();
            saveLibrary();
            showStatus("Sync OK", "#28a745");
        }
    } catch (e) { showStatus("Offline Mode", "#6c757d"); }
}

async function cloudSync(action, book) {
    fetch(GOOGLE_SHEET_URL, {
        method: "POST",
        mode: "no-cors",
        redirect: 'follow',
        body: JSON.stringify({ action: action, data: book })
    });
}

function askReadStatus(title) {
    return new Promise((resolve) => {
        const modal = document.getElementById('read-modal');
        document.getElementById('modal-title').textContent = title;
        modal.style.display = 'flex';
        document.getElementById('btn-read-yes').onclick = () => { modal.style.display = 'none'; resolve(true); };
        document.getElementById('btn-read-no').onclick = () => { modal.style.display = 'none'; resolve(false); };
    });
}

function renderLibrary() {
    const list = document.getElementById('book-list');
    list.innerHTML = myLibrary.map(b => `
        <li class="book-item">
            <img src="${b.image}">
            <div class="book-info">
                <strong>${b.title}</strong>
                <span class="status-flag ${b.isRead?'read':'unread'}" onclick="toggleRead('${b.id}')">
                    ${b.isRead?'✅ Read':'📖 Unread'}
                </span>
            </div>
            <button class="delete-btn" onclick="deleteBook('${b.id}')">🗑️</button>
        </li>
    `).join('');
}

function toggleRead(id) {
    const b = myLibrary.find(x => x.id === id);
    if(b) { b.isRead = !b.isRead; renderLibrary(); saveLibrary(); cloudSync('update', b); }
}

function deleteBook(id) {
    const b = myLibrary.find(x => x.id === id);
    if(b && confirm("Delete?")) {
        myLibrary = myLibrary.filter(x => x.id !== id);
        renderLibrary();
        saveLibrary();
        cloudSync('delete', b);
    }
}

function saveLibrary() { localStorage.setItem('myLibrary', JSON.stringify(myLibrary)); }

function showStatus(m, c) {
    const t = document.createElement("div"); t.className = "toast";
    t.textContent = m; t.style.background = c;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2500);
}

// Initial Load
window.onload = () => {
    const saved = localStorage.getItem('myLibrary');
    if (saved) { myLibrary = JSON.parse(saved); renderLibrary(); }
    showView('view-home');
};