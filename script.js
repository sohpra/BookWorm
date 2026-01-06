/**
 * 1. GLOBAL STATE & CONFIGURATION
 */
const Quagga_CDN = "https://cdn.jsdelivr.net/npm/@ericblade/quagga2/dist/quagga.min.js";
const GOOGLE_SHEET_URL = "https://script.google.com/macros/s/AKfycbw1oZV1HEO21oadgp6IKkq9XR4v-2fwuinuKnAr_U1SyFYIrWqcNIpy6gux44pzgBAa_g/exec"; // <--- Paste your URL here

let myLibrary = [];
let isScanning = true;
let lastResult = null;
let count = 0;

/**
 * 2. VALIDATION & CLOUD SYNC LOGIC
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

async function syncToGoogleSheets(book) {
    if (GOOGLE_SHEET_URL.includes("PASTE_YOUR")) return; // Skip if URL not set
    try {
        await fetch(GOOGLE_SHEET_URL, {
            method: "POST",
            mode: "no-cors",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(book)
        });
        console.log("Cloud Sync: Success");
    } catch (err) {
        console.error("Cloud Sync: Failed", err);
    }
}

/**
 * 3. SCANNER INITIALIZATION (Quagga2)
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
                constraints: {
                    facingMode: "environment",
                    width: { ideal: 1280 },
                    height: { ideal: 720 }
                },
            },
            decoder: { readers: ["ean_reader"] },
            locate: true,
            halfSample: true,
            patchSize: "medium"
        }, function (err) {
            if (err) return;
            Quagga.start();
        });
        Quagga.onDetected(onScanSuccess);
    } catch (e) {
        showStatus("Scanner failed to load", "#dc3545");
    }
}

/**
 * 4. SUCCESS HANDLER
 */
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

    if (count >= 10) { 
        isScanning = false; 
        document.body.classList.add('flash-active');
        if (navigator.vibrate) navigator.vibrate([100, 50, 100]);

        await handleScannedBook(code);

        setTimeout(() => {
            isScanning = true;
            document.body.classList.remove('flash-active');
            lastResult = null;
            count = 0;
        }, 3000);
    }
}

/**
 * 5. DATA FETCHING & UI UPDATE
 */
async function handleScannedBook(isbn) {
    if (myLibrary.some(b => b.isbn === isbn)) {
        showStatus("Already in library!", "#ffc107");
        return;
    }

    try {
        const res = await fetch(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}`);
        const data = await res.json();
        
        let book;
        if (data.items && data.items.length > 0) {
            const info = data.items[0].volumeInfo;
            book = {
                id: Date.now().toString(36),
                isbn: isbn,
                title: info.title || "Unknown Title",
                author: (info.authors && info.authors.join(', ')) || "Unknown Author",
                image: (info.imageLinks && (info.imageLinks.thumbnail || info.imageLinks.smallThumbnail)) || "https://via.placeholder.com/50x75?text=No+Cover",
                category: info.categories ? info.categories[0] : "General",
                rating: info.averageRating || "N.A."
            };
            showStatus(`Added: ${book.title}`, "#28a745");
        } else {
            book = {
                id: Date.now().toString(36),
                isbn: isbn,
                title: "ISBN: " + isbn,
                author: "Unknown Author",
                image: "https://via.placeholder.com/50x75?text=No+Cover",
                category: "Unknown",
                rating: "N.A."
            };
            showStatus("Saved ISBN (Details not found)", "#17a2b8");
        }

        myLibrary.push(book);
        saveLibrary();
        renderLibrary();
        syncToGoogleSheets(book); // Cloud Sync

    } catch (err) {
        showStatus("API Error", "#dc3545");
    }
}

/**
 * 6. UI HELPERS
 */
function showStatus(message, color) {
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
                    <span class="badge-rate">⭐ ${book.rating}</span>
                </div>
            </div>
            <button class="delete-btn" onclick="deleteBook('${book.id}')">Delete</button>
        `;
        list.appendChild(li);
    });
}

/**
 * 7. PERSISTENCE & INIT
 */
function deleteBook(id) {
    myLibrary = myLibrary.filter(b => b.id !== id);
    saveLibrary();
    renderLibrary();
}

function saveLibrary() { localStorage.setItem('myLibrary', JSON.stringify(myLibrary)); }
function loadLibrary() {
    const raw = localStorage.getItem('myLibrary');
    if (raw) myLibrary = JSON.parse(raw);
}

document.addEventListener('DOMContentLoaded', () => {
    loadLibrary();
    renderLibrary();
    startScanner();

    // Manual Add Logic
    document.getElementById('add-book-btn').addEventListener('click', async () => {
        const isbn = prompt('Enter ISBN:');
        if (isbn && isbn.length >= 10) {
            const clean = isbn.replace(/\D/g, '');
            await handleScannedBook(clean);
        }
    });

    // CSV Export Logic
    document.getElementById('export-btn').addEventListener('click', () => {
        if (myLibrary.length === 0) return alert("Library is empty");
        const headers = ["Title", "Author", "ISBN", "Category", "Rating"];
        const rows = myLibrary.map(b => [`"${b.title}"`, `"${b.author}"`, `'${b.isbn}`, `"${b.category}"`, b.rating]);
        const csv = [headers, ...rows].map(e => e.join(",")).join("\n");
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "my_library.csv";
        a.click();
    });
});