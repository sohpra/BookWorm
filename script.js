// 1. Configuration & State
const Quagga_CDN = "https://cdn.jsdelivr.net/npm/@ericblade/quagga2/dist/quagga.min.js";
let myLibrary = [];
let isScanning = true;

// 2. Load the Library
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

// 3. Initialize Quagga
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
                readers: ["ean_reader"] // ISBNs use EAN-13 format
            },
            locate: true, // This tells Quagga to search for the barcode in the image
            halfSample: true, // Improves performance on mobile
            patchSize: "medium" // Size of the search area
        }, function (err) {
            if (err) {
                console.error(err);
                document.getElementById('scanner-error').textContent = "Camera Error: " + err;
                return;
            }
            console.log("Quagga initialized.");
            Quagga.start();
        });

        // Listen for successful scans
        Quagga.onDetected(onScanSuccess);

    } catch (e) {
        document.getElementById('scanner-error').textContent = "Failed to load scanner library.";
    }
}

// 4. Handle Scan Success
async function onScanSuccess(data) {
    if (!isScanning) return;
    
    const code = data.codeResult.code;
    
    // Quagga can be sensitive; verify it's a 13-digit ISBN
    if (code.length === 13) {
        isScanning = false;
        console.log("ISBN detected: " + code);
        
        // Visual feedback
        const viewport = document.querySelector('#interactive');
        viewport.style.border = "5px solid #28a745";
        
        await handleScannedBook(code);

        // Reset scanner after 3 seconds
        setTimeout(() => {
            isScanning = true;
            viewport.style.border = "none";
        }, 3000);
    }
}

// 5. Book Logic (Google Books API)
async function handleScannedBook(isbn) {
    if (myLibrary.some(b => b.isbn === isbn)) {
        console.log("Already in library");
        return;
    }

    try {
        const res = await fetch(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}`);
        const data = await res.json();
        
        if (!data.items) {
            alert("Book not found for ISBN: " + isbn);
            return;
        }

        const info = data.items[0].volumeInfo;
        const book = {
            id: Date.now().toString(36),
            isbn: isbn,
            title: info.title || "Unknown",
            author: (info.authors && info.authors.join(', ')) || "Unknown",
            image: (info.imageLinks && info.imageLinks.thumbnail) || ""
        };

        myLibrary.push(book);
        saveLibrary();
        renderLibrary();
    } catch (err) {
        console.error("API error", err);
    }
}

// 6. UI & Storage Helpers
function renderLibrary() {
    const list = document.getElementById('book-list');
    if (!list) return;
    list.innerHTML = '';
    myLibrary.forEach(book => {
        const li = document.createElement('li');
        li.className = 'book-item';
        li.innerHTML = `
            <img src="${book.image}" style="width:50px;">
            <div><strong>${book.title}</strong><br>${book.author}</div>
            <button onclick="deleteBook('${book.id}')">Delete</button>
        `;
        list.appendChild(li);
    });
}

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

// 7. Start on Page Load
document.addEventListener('DOMContentLoaded', () => {
    loadLibrary();
    renderLibrary();
    startScanner();
});