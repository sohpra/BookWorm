const GOOGLE_SHEET_URL = "https://script.google.com/macros/s/AKfycbw1oZV1HEO21oadgp6IKkq9XR4v-2fwuinuKnAr_U1SyFYIrWqcNIpy6gux44pzgBAa_g/exec"; 
const Quagga_CDN = "https://cdn.jsdelivr.net/npm/@ericblade/quagga2/dist/quagga.min.js";

let myLibrary = [];
let isScanning = false;

// 1. NAVIGATION & PERMISSIONS
function showView(viewId) {
    // 1. Hide everything first
    document.querySelectorAll('.view').forEach(v => {
        v.style.display = 'none';
    });

    // 2. Show the requested view
    const targetView = document.getElementById(viewId);
    if (targetView) {
        targetView.style.display = 'block';
    }

    // 3. TRIGGER SCANNER ONLY AFTER DISPLAY IS BLOCK
    if (viewId === 'view-scanner') {
        // We give the browser 200ms to physically render the div 
        // before we ask the camera to point at it.
        setTimeout(() => {
            startScanner();
        }, 200);
    } else {
        if (window.Quagga) {
            Quagga.stop();
            const container = document.querySelector('#interactive');
            if (container) container.innerHTML = ''; // Clean up video
        }
        isScanning = false;
    }
}

// 2. SCANNER LOGIC (With iPhone Fixes)
async function startScanner() {
    isScanning = true;
    const container = document.querySelector('#interactive');
    container.innerHTML = ''; 

    if (!window.Quagga) {
        const s = document.createElement("script");
        s.src = Quagga_CDN;
        await new Promise(r => s.onload = r);
        document.head.appendChild(s);
    }

    try {
        // This line forces the browser to show the "Allow Camera" popup
        await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
    } catch (e) {
        alert("Camera access denied. Please enable it in browser settings.");
        showView('view-home');
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
        decoder: { readers: ["ean_reader"] }
    }, (err) => {
        if (err) return console.error(err);
        Quagga.start();
        
        // IMPORTANT: Fix for Safari/iPhone to prevent video from going full-screen
        const video = container.querySelector('video');
        if (video) {
            video.setAttribute("playsinline", "true"); 
            video.setAttribute("muted", "true");
            video.play();
        }
    });

    Quagga.onDetected(handleDetection);
}

async function handleDetection(data) {
    if (!isScanning) return;
    isScanning = false;
    Quagga.stop();
    if (navigator.vibrate) navigator.vibrate(100);
    await handleScannedBook(data.codeResult.code);
}

// 3. BOOK PROCESSING (With HTTPS Image Fix)
async function handleScannedBook(isbn) {
    showStatus("Fetching details...", "#6c5ce7");
    try {
        const res = await fetch(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}`);
        const data = await res.json();
        
        let info = { title: "Unknown", authors: ["Unknown"] };
        if (data.items && data.items.length > 0) info = data.items[0].volumeInfo;

        const hasRead = await askReadStatus(info.title);

        // FIX: Mixed Content - Force Google Image URLs to use HTTPS
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
        showStatus("Error finding book", "#dc3545");
        showView('view-home');
    }
}

// 4. CLOUD & UTILS (Keep your existing cloudSync, loadLibrary, etc. here)
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

function saveLibrary() { localStorage.setItem('myLibrary', JSON.stringify(myLibrary)); }

function showStatus(msg, color) {
    const t = document.createElement("div"); t.className = "toast";
    t.textContent = msg; t.style.background = color;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2000);
}

// Load on start
window.onload = () => {
    const saved = localStorage.getItem('myLibrary');
    if (saved) { myLibrary = JSON.parse(saved); renderLibrary(); }
    showView('view-home');
};