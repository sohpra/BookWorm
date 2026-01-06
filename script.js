/**
 * 1. CONFIGURATION
 */
const GOOGLE_SHEET_URL = "https://script.google.com/macros/s/AKfycbw1oZV1HEO21oadgp6IKkq9XR4v-2fwuinuKnAr_U1SyFYIrWqcNIpy6gux44pzgBAa_g/exec"; 
const Quagga_CDN = "https://cdn.jsdelivr.net/npm/@ericblade/quagga2/dist/quagga.min.js";

let myLibrary = [];
let isScanning = false;

/**
 * 2. NAVIGATION & PERMISSIONS
 */
function showView(viewId) {
    // Hide all views
    document.querySelectorAll('.view').forEach(v => v.style.display = 'none');
    
    // Show target view
    const target = document.getElementById(viewId);
    target.style.display = 'block';
    
    if (viewId === 'view-scanner') {
        // Wait 200ms for the browser to render the div before starting camera
        setTimeout(() => {
            startScanner();
        }, 200);
    } else {
        if (window.Quagga) {
            Quagga.stop();
        }
        isScanning = false;
    }
}

/**
 * 3. SCANNER LOGIC
 */
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
        // Requesting camera - this triggers the prompt
        await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
    } catch (e) {
        alert("Camera blocked. Please check your browser settings.");
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
                // This ensures the best resolution for barcodes
                width: { ideal: 1280 },
                height: { ideal: 720 }
            }
        },
        decoder: { readers: ["ean_reader"] }
    }, (err) => {
        if (err) return console.error(err);
        Quagga.start();
        
        // FIX: Manually force the video to play inline for iPhone/Safari
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
    
    const isbn = data.codeResult.code;
    await handleScannedBook(isbn);
}

/**
 * 4. BOOK PROCESSING
 */
async function handleScannedBook(isbn) {
    showStatus("Fetching details...", "#6c5ce7");
    try {
        const res = await fetch(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}`);
        const data = await res.json();
        
        let info = { title: "Unknown", authors: ["Unknown"] };
        if (data.items && data.items.length > 0) info = data.items[0].volumeInfo;

        const hasRead = await askReadStatus(info.title);

        // FIX: Solve the "Mixed Content" warning by forcing the image to HTTPS
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
        showStatus("Error", "#dc3545");
        showView('view-home');
    }
}

/**
 * 5. CLOUD & SYNC
 */
async function loadLibrary() {
    showStatus("Syncing...", "#17a2b8");
    if (!GOOGLE_SHEET_URL || GOOGLE_SHEET_URL.includes("PASTE_YOUR")) return;

    try {
        const response = await fetch(GOOGLE_SHEET_URL, { redirect: 'follow' });
        const data = await response.json();
        if (Array.isArray(data)) {
            // Overwrite local with cloud (The Ghost Killer)
            myLibrary = data.map(b => ({ ...b, id: Math.random().toString(36).substr(2, 9) }));
            saveLibrary();
            renderLibrary();
            showStatus("Cloud Synced", "#28a745");
        }
    } catch (e) {
        showStatus("Offline Mode", "#6c757d");
    }
}

async function cloudSync(action, book) {
    fetch(GOOGLE_SHEET_URL, {
        method: "POST",
        mode: "no-cors",
        redirect: 'follow',
        body: JSON.stringify({ action: action, data: book })
    });
}

/**
 * 6. UI HELPERS
 */
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
    if (!list) return;
    list.innerHTML = myLibrary.map(b => `
        <li class="book-item">
            <img src="${b.image}">
            <div class="book-info">
                <strong>${b.title}</strong>
                <em>${b.author}</em>
                <br>
                <span class="status-flag ${b.isRead ? 'read' : 'unread'}" onclick="toggleRead('${b.id}')">
                    ${b.isRead ? '✅ Read' : '📖 Unread'}
                </span>
            </div>
            <button class="delete-btn" onclick="deleteBook('${b.id}')">🗑️</button>
        </li>
    `).join('');
}

function toggleRead(id) {
    const book = myLibrary.find(b => b.id === id);
    if (book) {
        book.isRead = !book.isRead;
        renderLibrary();
        saveLibrary();
        cloudSync('update', book);
    }
}

function deleteBook(id) {
    const book = myLibrary.find(b => b.id === id);
    if (book && confirm(`Delete "${book.title}"?`)) {
        myLibrary = myLibrary.filter(b => b.id !== id);
        renderLibrary();
        saveLibrary();
        cloudSync('delete', book);
    }
}

function saveLibrary() { localStorage.setItem('myLibrary', JSON.stringify(myLibrary)); }

function showStatus(msg, color) {
    const t = document.createElement("div"); t.className = "toast";
    t.textContent = msg; t.style.background = color;
    document.body.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 400); }, 2000);
}

// Initial Load
document.addEventListener('DOMContentLoaded', () => {
    const saved = localStorage.getItem('myLibrary');
    if (saved) { myLibrary = JSON.parse(saved); renderLibrary(); }
    showView('view-home');
});