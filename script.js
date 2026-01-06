const GOOGLE_SHEET_URL = "https://script.google.com/macros/s/AKfycbw1oZV1HEO21oadgp6IKkq9XR4v-2fwuinuKnAr_U1SyFYIrWqcNIpy6gux44pzgBAa_g/exec";
const Quagga_CDN = "https://cdn.jsdelivr.net/npm/@ericblade/quagga2/dist/quagga.min.js";

let myLibrary = [];
let isScanning = false;

// 1. Navigation
function showView(viewId) {
    document.querySelectorAll('.view').forEach(v => v.style.display = 'none');
    document.getElementById(viewId).style.display = 'block';
    if (viewId === 'view-scanner') { startScanner(); } else { if(window.Quagga) Quagga.stop(); isScanning = false; }
}

// 2. Custom Modal
function askReadStatus(title) {
    return new Promise((resolve) => {
        const modal = document.getElementById('read-modal');
        document.getElementById('modal-title').textContent = title;
        modal.style.display = 'flex';
        document.getElementById('btn-read-yes').onclick = () => { modal.style.display = 'none'; resolve(true); };
        document.getElementById('btn-read-no').onclick = () => { modal.style.display = 'none'; resolve(false); };
    });
}

// 3. Cloud Sync
async function loadLibrary() {
    showStatus("Syncing...", "#17a2b8");
    try {
        const response = await fetch(GOOGLE_SHEET_URL, { redirect: 'follow' });
        const data = await response.json();
        if (Array.isArray(data)) {
            myLibrary = data.map(b => ({ ...b, id: Math.random().toString(36).substr(2, 9) }));
            renderLibrary();
            localStorage.setItem('myLibrary', JSON.stringify(myLibrary));
            showStatus("Sync OK", "#28a745");
        }
    } catch (e) { showStatus("Sync Failed", "#dc3545"); }
}

async function cloudSync(action, book) {
    fetch(GOOGLE_SHEET_URL, {
        method: "POST",
        mode: "no-cors",
        redirect: 'follow',
        body: JSON.stringify({ action: action, data: book })
    });
}

// 4. Scanner Logic
async function startScanner() {
    isScanning = true;
    if (!window.Quagga) {
        const s = document.createElement("script");
        s.src = Quagga_CDN;
        await new Promise(r => s.onload = r);
        document.head.appendChild(s);
    }
    Quagga.init({
        inputStream: { type: "LiveStream", target: "#interactive", constraints: { facingMode: "environment" } },
        decoder: { readers: ["ean_reader"] }
    }, (err) => { if(!err) Quagga.start(); });
    Quagga.onDetected(async (res) => {
        if (!isScanning) return;
        isScanning = false;
        Quagga.stop();
        await handleScannedBook(res.codeResult.code);
    });
}

async function handleScannedBook(isbn) {
    showStatus("Fetching...", "#007bff");
    try {
        const res = await fetch(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}`);
        const data = await res.json();
        const info = data.items ? data.items[0].volumeInfo : { title: "Unknown" };
        const hasRead = await askReadStatus(info.title);
        
        const book = {
            id: Date.now().toString(36),
            isbn: isbn,
            title: info.title,
            author: info.authors ? info.authors[0] : "Unknown",
            image: info.imageLinks ? info.imageLinks.thumbnail : "",
            isRead: hasRead
        };
        
        myLibrary.push(book);
        renderLibrary();
        cloudSync('add', book);
        showView('view-home');
    } catch (e) { isScanning = true; startScanner(); }
}

// 5. UI Helpers
function renderLibrary() {
    const list = document.getElementById('book-list');
    list.innerHTML = myLibrary.map(b => `
        <li class="book-item">
            <img src="${b.image}">
            <div class="book-info">
                <strong>${b.title}</strong><br>
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
    if(b) { b.isRead = !b.isRead; renderLibrary(); cloudSync('update', b); }
}

function deleteBook(id) {
    const b = myLibrary.find(x => x.id === id);
    if(b && confirm("Delete?")) { 
        myLibrary = myLibrary.filter(x => x.id !== id); 
        renderLibrary(); 
        cloudSync('delete', b); 
    }
}

function showStatus(m, c) {
    const t = document.createElement("div"); t.className = "toast";
    t.textContent = m; t.style.background = c;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2000);
}

// Initial Load
const saved = localStorage.getItem('myLibrary');
if (saved) { myLibrary = JSON.parse(saved); renderLibrary(); }
document.getElementById('manual-btn').onclick = () => {
    const i = prompt("Enter ISBN:"); if(i) handleScannedBook(i);
};