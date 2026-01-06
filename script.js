/**
 * 1. GLOBAL STATE & CONFIGURATION
 */
const Quagga_CDN = "https://cdn.jsdelivr.net/npm/@ericblade/quagga2/dist/quagga.min.js";
let myLibrary = [];
let isScanning = true;
let lastResult = null;
let count = 0;

/**
 * 2. MATHEMATICAL VALIDATION (ISBN-13 Checksum)
 * This prevents "phantom" reads by ensuring the 13th digit matches the 
 * mathematical result of the first 12.
 */
function isValidISBN13(isbn) {
    // Must be 13 digits and start with 978 or 979
    if (!/^97[89]\d{10}$/.test(isbn)) return false;

    let sum = 0;
    for (let i = 0; i < 12; i++) {
        // Multiply even indices by 1, odd by 3
        sum += parseInt(isbn[i]) * (i % 2 === 0 ? 1 : 3);
    }
    const checkDigit = (10 - (sum % 10)) % 10;
    return checkDigit === parseInt(isbn[12]);
}

/**
 * 3. SCANNER INITIALIZATION
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
                    aspectRatio: { min: 1, max: 2 },
                    // Try to force high resolution for sharper barcode lines
                    width: { ideal: 1280 },
                    height: { ideal: 720 }
                },
            },
            decoder: {
                readers: ["ean_reader"] // EAN-13 is the standard for ISBN
            },
            locate: true,
            halfSample: true,
            patchSize: "medium",
            frequency: 10
        }, function (err) {
            if (err) {
                document.getElementById('scanner-error').textContent = "Camera Error: " + err;
                return;
            }
            Quagga.start();
        });

        Quagga.onDetected(onScanSuccess);

    } catch (e) {
        document.getElementById('scanner-error').textContent = "Failed to load scanner.";
    }
}

/**
 * 4. SUCCESS HANDLER (The "Hard Guard" Logic)
 */
async function onScanSuccess(data) {
    if (!isScanning) return;
    
    const code = data.codeResult.code;

    // STEP 1: Math Check (Prefix + Checksum)
    if (!isValidISBN13(code)) return;

    // STEP 2: Stability Check (Require 8 consecutive identical reads)
    // We lowered this slightly from 10 to 8 for better speed, but kept it strict.
    if (code === lastResult) {
        count++;
    } else {
        lastResult = code;
        count = 0;
    }

    if (count >= 8) { 
        isScanning = false; 
        
        // Feedback
        const viewport = document.querySelector('#interactive');
        if(viewport) viewport.style.border = "8px solid #28a745";
        if (navigator.vibrate) navigator.vibrate(100);

        console.log("Verified ISBN:", code);
        await handleScannedBook(code);

        // Reset after 3 seconds
        setTimeout(() => {
            isScanning = true;
            if(viewport) viewport.style.border = "none";
            lastResult = null;
            count = 0;
        }, 3000);
    }
}

/**
 * 5. DATA FETCHING (Google Books API)
 */
async function handleScannedBook(isbn) {
    if (myLibrary.some(b => b.isbn === isbn)) {
        alert("Already in library!");
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
                image: (info.imageLinks && (info.imageLinks.thumbnail || info.imageLinks.smallThumbnail)) || "https://via.placeholder.com/50x75?text=No+Cover"
            };
        } else {
            // Fallback if details aren't in Google's DB
            book = {
                id: Date.now().toString(36),
                isbn: isbn,
                title: "ISBN: " + isbn,
                author: "Unknown Author",
                image: "https://via.placeholder.com/50x75?text=No+Cover"
            };
        }

        myLibrary.push(book);
        saveLibrary();
        renderLibrary();
    } catch (err) {
        console.error("API Error:", err);
    }
}

/**
 * 6. UI & STORAGE HELPERS
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
            </div>
            <button class="delete-btn" onclick="deleteBook('${book.id}')">Delete</button>
        `;
        list.appendChild(li);
    });
}

function deleteBook(id) {
    myLibrary = myLibrary.filter(b => b.id !== id);
    saveLibrary();
    renderLibrary();
}

function saveLibrary() {
    localStorage.setItem('myLibrary', JSON.stringify(myLibrary));
}

function loadLibrary() {
    const raw = localStorage.getItem('myLibrary');
    if (raw) myLibrary = JSON.parse(raw);
}

/**
 * 7. INITIALIZATION
 */
document.addEventListener('DOMContentLoaded', () => {
    loadLibrary();
    renderLibrary();
    startScanner();

    // Manual Add Fallback
    const addBtn = document.getElementById('add-book-btn');
    if (addBtn) {
        addBtn.addEventListener('click', async () => {
            const isbn = prompt('Enter ISBN (13 digits):');
            if (isbn) {
                const clean = isbn.replace(/\D/g, '');
                if (clean.length >= 10) await handleScannedBook(clean);
            }
        });
    }

    // Export to CSV
    const exportBtn = document.getElementById('export-btn');
    if (exportBtn) {
        exportBtn.addEventListener('click', () => {
            if (myLibrary.length === 0) return alert("Library is empty");
            const headers = ["Title", "Author", "ISBN"];
            const rows = myLibrary.map(b => [`"${b.title}"`, `"${b.author}"`, `'${b.isbn}`]);
            const csv = [headers, ...rows].map(e => e.join(",")).join("\n");
            const blob = new Blob([csv], { type: 'text/csv' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = "my_library.csv";
            a.click();
        });
    }
});