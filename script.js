/**
 * 1. CONFIGURATION & STATE
 */
const GOOGLE_SHEET_URL = "PASTE_YOUR_NEW_DEPLOYMENT_URL_HERE"; 
const Quagga_CDN = "https://cdn.jsdelivr.net/npm/@ericblade/quagga2/dist/quagga.min.js";

let myLibrary = [];
let isScanning = true;
let lastResult = null;
let count = 0;

/**
 * 2. NAVIGATION (Single Page App Logic)
 */
function showView(viewId) {
    document.querySelectorAll('.view').forEach(v => v.style.display = 'none');
    document.getElementById(viewId).style.display = 'block';
    
    if (viewId === 'view-scanner') {
        isScanning = true;
        startScanner();
    } else {
        if (window.Quagga) Quagga.stop();
    }
}

/**
 * 3. CUSTOM MODAL LOGIC (Yes/No instead of OK/Cancel)
 */
function askReadStatus(title) {
    return new Promise((resolve) => {
        const modal = document.getElementById('read-modal');
        const titleEl = document.getElementById('modal-title');
        const yesBtn = document.getElementById('btn-read-yes');
        const noBtn = document.getElementById('btn-read-no');

        titleEl.textContent = title;
        modal.style.display = 'flex';

        const handleChoice = (status) => {
            modal.style.display = 'none';
            yesBtn.onclick = null;
            noBtn.onclick = null;
            resolve(status);
        };

        yesBtn.onclick = () => handleChoice(true);
        noBtn.onclick = () => handleChoice(false);
    });
}

/**
 * 4. CLOUD SYNC ENGINE
 */
async function cloudSync(action, book) {
    if (!GOOGLE_SHEET_URL || GOOGLE_SHEET_URL.includes("PASTE_YOUR")) return;
    try {
        await fetch(GOOGLE_SHEET_URL, {
            method: "POST",
            mode: "no-cors",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: action, data: book })
        });
        console.log(`Cloud ${action}: Success`);
    } catch (err) {
        console.error(`Cloud ${action}: Failed`, err);
    }
}

/**
 * 5. SCANNER LOGIC
 */
async function loadQuagga() {
    return new Promise((resolve, reject) => {
        if (window.Quagga) return resolve();
        const script = document.createElement("script");
        script.src = Quagga_CDN;
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
    });
}

async function startScanner() {
    try {
        await loadQuagga();
        Quagga.init({
            inputStream: {
                name: "Live",
                type: "LiveStream",
                target: document.querySelector('#interactive'),
                constraints: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
            },
            decoder: { readers: ["ean_reader"] },
            locate: true
        }, (err) => {
            if (err) return;
            Quagga.start();
        });
        Quagga.onDetected(onScanSuccess);
    } catch (e) {
        showStatus("Scanner Error", "#dc3545");
    }
}

async function onScanSuccess(data) {
    if (!isScanning) return;
    const code = data.codeResult.code;

    if (code === lastResult) {
        count++;
    } else {
        lastResult = code;
        count = 0;
    }

    if (count >= 12) { 
        isScanning = false; 
        document.body.classList.add('flash-active');
        if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
        await handleScannedBook(code);
    }
}

/**
 * 6. BOOK PROCESSING & DUPLICATE CHECK
 */
async function handleScannedBook(isbn) {
    // DUPLICATE CHECK
    if (myLibrary.some(b => b.isbn === isbn)) {
        alert("Already in library!");
        showView('view-home');
        return;
    }

    showStatus("Searching...", "#007bff");

    try {
        const res = await fetch(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}`);
        const data = await res.json();
        
        let bookInfo = { title: "Unknown", authors: ["Unknown"] };
        if (data.items && data.items.length > 0) {
            bookInfo = data.items[0].volumeInfo;
        }

        // Use Custom Modal instead of confirm()
        const hasRead = await askReadStatus(bookInfo.title);

        const book = {
            id: Date.now().toString(36),
            isbn: isbn,
            title: bookInfo.title,
            author: (bookInfo.authors && bookInfo.authors.join(', ')) || "Unknown",
            image: (bookInfo.imageLinks?.thumbnail) || "https://via.placeholder.com/50x75?text=No+Cover",
            category: bookInfo.categories ? bookInfo.categories[0] : "General",
            rating: bookInfo.averageRating || "N.A.",
            isRead: hasRead
        };

        myLibrary.push(book);
        saveLibrary();
        renderLibrary();
        cloudSync('add', book);
        
        showStatus("Saved to Cloud!", "#28a745");
        
        setTimeout(() => {
            document.body.classList.remove('flash-active');
            showView('view-home');
        }, 1200);

    } catch (err) {
        showStatus("API Error", "#dc3545");
        isScanning = true;
    }
}

/**
 * 7. LIBRARY ACTIONS
 */
function toggleRead(id) {
    const book = myLibrary.find(b => b.id === id);
    if(book) {
        book.isRead = !book.isRead;
        saveLibrary();
        renderLibrary();
        cloudSync('update', book);
    }
}

function deleteBook(id) {
    const bookToDelete = myLibrary.find(b => b.id === id);
    if (bookToDelete && confirm(`Delete "${bookToDelete.title}"?`)) {
        myLibrary = myLibrary.filter(b => b.id !== id);
        saveLibrary();
        renderLibrary();
        cloudSync('delete', bookToDelete);
    }
}

/**
 * 8. UI & PERSISTENCE
 */
function renderLibrary() {
    const list = document.getElementById('book-list');
    if (!list) return;
    list.innerHTML = '';

    myLibrary.forEach(book => {
        const li = document.createElement('li');
        li.className = 'book-item';
        li.innerHTML = `
            <img src="${book.image}">
            <div class="book-info">
                <strong>${book.title}</strong>
                <em>${book.author}</em>
                <div class="badges">
                    <span class="badge-cat">${book.category}</span>
                    <span class="status-flag ${book.isRead ? 'read' : 'unread'}" onclick="toggleRead('${book.id}')">
                        ${book.isRead ? '✅ Read' : '📖 Unread'}
                    </span>
                </div>
            </div>
            <button class="delete-btn" onclick="deleteBook('${book.id}')">🗑️</button>
        `;
        list.appendChild(li);
    });
}

function showStatus(message, color) {
    const statusEl = document.createElement("div");
    statusEl.textContent = message;
    statusEl.className = "toast";
    statusEl.style.backgroundColor = color;
    document.body.appendChild(statusEl);
    setTimeout(() => {
        statusEl.style.opacity = "0";
        setTimeout(() => statusEl.remove(), 500);
    }, 2000);
}

function saveLibrary() { localStorage.setItem('myLibrary', JSON.stringify(myLibrary)); }
function loadLibrary() {
    const raw = localStorage.getItem('myLibrary');
    if (raw) myLibrary = JSON.parse(raw);
}

document.addEventListener('DOMContentLoaded', () => {
    loadLibrary();
    renderLibrary();
    showView('view-home');

    document.getElementById('add-book-btn').addEventListener('click', async () => {
        const isbn = prompt('Enter ISBN:');
        if (isbn) await handleScannedBook(isbn.replace(/\D/g, ''));
    });
});