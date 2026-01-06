/**
 * 1. CONFIGURATION & STATE
 */
const GOOGLE_SHEET_URL = "https://script.google.com/macros/library/d/1CYciXGVi-7PmPiWoB2V8aFsbNa71JjK4aLTxSjH1789-A7BugjhSMahQ/2https://script.google.com/macros/s/AKfycbw1oZV1HEO21oadgp6IKkq9XR4v-2fwuinuKnAr_U1SyFYIrWqcNIpy6gux44pzgBAa_g/exec"; 
const Quagga_CDN = "https://cdn.jsdelivr.net/npm/@ericblade/quagga2/dist/quagga.min.js";

let myLibrary = [];
let isScanning = true;
let lastResult = null;
let count = 0;

/**
 * 2. NAVIGATION (Single Page App Logic)
 */
function showView(viewId) {
    // Hide all views
    document.querySelectorAll('.view').forEach(v => v.style.display = 'none');
    // Show selected view
    document.getElementById(viewId).style.display = 'block';
    
    // Handle Scanner Lifecycle
    if (viewId === 'view-scanner') {
        isScanning = true;
        startScanner();
    } else {
        if (window.Quagga) {
            Quagga.stop();
        }
    }
}

/**
 * 3. CLOUD SYNC ENGINE
 * Sends Action (add/update/delete) + Data to Google Sheets
 */
async function cloudSync(action, book) {
    if (!GOOGLE_SHEET_URL || GOOGLE_SHEET_URL.includes("PASTE_YOUR")) return;
    try {
        await fetch(GOOGLE_SHEET_URL, {
            method: "POST",
            mode: "no-cors",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                action: action,
                data: book
            })
        });
        console.log(`Cloud ${action}: Success`);
    } catch (err) {
        console.error(`Cloud ${action}: Failed`, err);
    }
}

/**
 * 4. SCANNER & VALIDATION
 */
function isValidISBN13(isbn) {
    if (!/^97[89]\d{10}$/.test(isbn)) return false;
    let sum = 0;
    for (let i = 0; i < 12; i++) {
        sum += parseInt(isbn[i]) * (i % 2 === 0 ? 1 : 3);
    }
    const checkDigit = (10 - (sum % 10)) % 10;
    return checkDigit === parseInt(isbn[12]);
}

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
            locate: true,
            patchSize: "medium"
        }, function (err) {
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

    if (!isValidISBN13(code)) return;

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
 * 5. BOOK PROCESSING & DUPLICATE CHECK
 */
async function handleScannedBook(isbn) {
    // DUPLICATE CHECK
    if (myLibrary.some(b => b.isbn === isbn)) {
        alert("This book is already in your library!");
        showView('view-home');
        return;
    }

    showStatus("Fetching details...", "#007bff");

    try {
        const res = await fetch(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}`);
        const data = await res.json();
        
        let book;
        if (data.items && data.items.length > 0) {
            const info = data.items[0].volumeInfo;
            
            // ASK IF READ
            const hasRead = confirm(`Found: ${info.title}\n\nHave you read this book?`);
            
            book = {
                id: Date.now().toString(36),
                isbn: isbn,
                title: info.title || "Unknown Title",
                author: (info.authors && info.authors.join(', ')) || "Unknown Author",
                image: (info.imageLinks?.thumbnail) || "https://via.placeholder.com/50x75?text=No+Cover",
                category: info.categories ? info.categories[0] : "General",
                rating: info.averageRating || "N.A.",
                isRead: hasRead
            };
        } else {
            const hasRead = confirm(`Book details not found for ISBN ${isbn}.\n\nHave you read this?`);
            book = {
                id: Date.now().toString(36),
                isbn: isbn,
                title: "ISBN: " + isbn,
                author: "Unknown Author",
                image: "https://via.placeholder.com/50x75?text=No+Cover",
                category: "Unknown",
                rating: "N.A.",
                isRead: hasRead
            };
        }

        myLibrary.push(book);
        saveLibrary();
        renderLibrary();
        cloudSync('add', book);
        
        showStatus("Successfully Saved!", "#28a745");
        
        // Return home after success
        setTimeout(() => {
            document.body.classList.remove('flash-active');
            showView('view-home');
        }, 1500);

    } catch (err) {
        showStatus("API Error", "#dc3545");
        isScanning = true;
    }
}

/**
 * 6. LIBRARY ACTIONS (Update & Delete)
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
 * 7. UI RENDERING
 */
function renderLibrary() {
    const list = document.getElementById('book-list');
    if (!list) return;
    list.innerHTML = '';

    myLibrary.forEach(book => {
        const li = document.createElement('li');
        li.className = 'book-item';
        li.innerHTML = `
            <img src="${book.image}" alt="cover">
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
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();

    const statusEl = document.createElement("div");
    statusEl.textContent = message;
    statusEl.className = "toast";
    statusEl.style.backgroundColor = color;
    document.body.appendChild(statusEl);
    setTimeout(() => {
        statusEl.style.opacity = "0";
        setTimeout(() => statusEl.remove(), 500);
    }, 2500);
}

/**
 * 8. PERSISTENCE & INITIALIZATION
 */
function saveLibrary() { localStorage.setItem('myLibrary', JSON.stringify(myLibrary)); }
function loadLibrary() {
    const raw = localStorage.getItem('myLibrary');
    if (raw) myLibrary = JSON.parse(raw);
}

document.addEventListener('DOMContentLoaded', () => {
    loadLibrary();
    renderLibrary();
    showView('view-home'); // Start on welcome page

    // Manual Add Logic
    document.getElementById('add-book-btn').addEventListener('click', async () => {
        const isbn = prompt('Enter ISBN:');
        if (isbn) {
            const clean = isbn.replace(/\D/g, '');
            if (clean.length >= 10) await handleScannedBook(clean);
        }
    });
});