// 1. GLOBAL STATE & CONFIG
const Quagga_CDN = "https://cdn.jsdelivr.net/npm/@ericblade/quagga2/dist/quagga.min.js";
let myLibrary = [];
let isScanning = true;
let lastResult = null;
let count = 0;

// 2. LIBRARY LOADER (Ensures Quagga is ready)
function loadQuagga() {
    return new Promise((resolve, reject) => {
        if (window.Quagga) return resolve();
        const script = document.createElement("script");
        script.src = Quagga_CDN;
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
    });
}

// 3. INITIALIZE SCANNER
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
                    aspectRatio: { min: 1, max: 2 }
                },
            },
            decoder: {
                readers: ["ean_reader"] // Focus strictly on ISBN format
            },
            locate: true,
            halfSample: true,
            patchSize: "medium"
        }, function (err) {
            if (err) {
                console.error(err);
                document.getElementById('scanner-error').textContent = "Camera Error: " + err;
                return;
            }
            console.log("Quagga Ready.");
            Quagga.start();
        });

        Quagga.onDetected(onScanSuccess);

    } catch (e) {
        document.getElementById('scanner-error').textContent = "Failed to load scanner library.";
    }
}

// 4. HANDLE SCAN SUCCESS (With Stability Filter)
async function onScanSuccess(data) {
    if (!isScanning) return;
    
    const code = data.codeResult.code;

    // RULE 1: Must be an ISBN (Starts with 978 or 979)
    if (!code.startsWith("978") && !code.startsWith("979")) {
        return; 
    }

    // RULE 2: Stability Check (Must see same code 5 times to prevent "garbage" reads)
    if (code === lastResult) {
        count++;
    } else {
        lastResult = code;
        count = 0;
    }

    if (count >= 5) { 
        isScanning = false; // Pause scanner
        console.log("Confirmed ISBN: " + code);
        
        // Visual Feedback: Green border
        const viewport = document.querySelector('#interactive');
        if(viewport) viewport.style.border = "5px solid #28a745";
        
        // Vibrate phone if supported
        if (navigator.vibrate) navigator.vibrate(100);

        await handleScannedBook(code);

        // Reset for next scan after a 3-second delay
        setTimeout(() => {
            isScanning = true;
            if(viewport) viewport.style.border = "none";
            lastResult = null;
            count = 0;
        }, 3000);
    }
}

// 5. BOOK LOGIC (Google Books API)
async function handleScannedBook(isbn) {
    // Prevent duplicates
    if (myLibrary.some(b => b.isbn === isbn)) {
        alert("This book is already in your library.");
        return;
    }

    try {
        const res = await fetch(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}`);
        const data = await res.json();
        
        if (!data.items || data.items.length === 0) {
            // Fallback: Add with just the ISBN if API doesn't have details
            addBookToState({
                id: Date.now().toString(36),
                isbn: isbn,
                title: "Unknown Title",
                author: "Unknown Author",
                image: "https://via.placeholder.com/50x75?text=No+Cover"
            });
            return;
        }

        const info = data.items[0].volumeInfo;
        const book = {
            id: Date.now().toString(36),
            isbn: isbn,
            title: info.title || "Unknown Title",
            author: (info.authors && info.authors.join(', ')) || "Unknown Author",
            image: (info.imageLinks && (info.imageLinks.thumbnail || info.imageLinks.smallThumbnail)) || "https://via.placeholder.com/50x75?text=No+Cover"
        };

        addBookToState(book);
    } catch (err) {
        console.error("API Error:", err);
        alert("Error connecting to book database.");
    }
}

function addBookToState(book) {
    myLibrary.push(book);
    saveLibrary();
    renderLibrary();
}

// 6. UI & STORAGE
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
    const idx = myLibrary.findIndex(b => b.id === id);
    if (idx !== -1) {
        myLibrary.splice(idx, 1);
        saveLibrary();
        renderLibrary();
    }
}

function saveLibrary() {
    localStorage.setItem('myLibrary', JSON.stringify(myLibrary));
}

function loadLibrary() {
    const raw = localStorage.getItem('myLibrary');
    if (raw) {
        const data = JSON.parse(raw);
        myLibrary.length = 0;
        myLibrary.push(...data);
    }
}

// 7. INITIALIZATION ON LOAD
document.addEventListener('DOMContentLoaded', () => {
    loadLibrary();
    renderLibrary();
    startScanner();

    // Manual Add Logic
    const addBtn = document.getElementById('add-book-btn');
    if (addBtn) {
        addBtn.addEventListener('click', async () => {
            const isbn = prompt('Enter 13-digit ISBN:');
            if (isbn && (isbn.length >= 10)) {
                const cleanIsbn = isbn.replace(/[^0-9Xx]/g, '');
                await handleScannedBook(cleanIsbn);
            }
        });
    }

    // Export CSV Logic
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