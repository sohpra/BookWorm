/**
 * 1. CONFIGURATION
 * Replace the URL below with your LATEST "Anyone" deployment URL.
 */
const GOOGLE_SHEET_URL = "https://script.google.com/macros/s/AKfycbw1oZV1HEO21oadgp6IKkq9XR4v-2fwuinuKnAr_U1SyFYIrWqcNIpy6gux44pzgBAa_g/exec"; 
const Quagga_CDN = "https://cdn.jsdelivr.net/npm/@ericblade/quagga2/dist/quagga.min.js";

let myLibrary = [];
let isScanning = true;
let lastResult = null;
let count = 0;

/**
 * 2. APP INITIALIZATION & CLOUD FETCHING
 */
document.addEventListener('DOMContentLoaded', () => {
    loadLibrary(); // Initial load
    showView('view-home');

    // Manual Add Logic
    document.getElementById('add-book-btn').addEventListener('click', async () => {
        const isbn = prompt('Enter ISBN:');
        if (isbn) await handleScannedBook(isbn.replace(/\D/g, ''));
    });
});

async function loadLibrary() {
    showStatus("Connecting to Cloud...", "#17a2b8");
    
    if (!GOOGLE_SHEET_URL || GOOGLE_SHEET_URL.includes("PASTE_YOUR")) return;

    try {
        // 'cors' mode is required for doGet to work correctly
        const response = await fetch(GOOGLE_SHEET_URL, { 
            method: 'GET',
            mode: 'cors', 
            redirect: 'follow' 
        });

        if (!response.ok) throw new Error("Network response was not ok");
        
        const cloudData = await response.json();
        
        if (Array.isArray(cloudData)) {
            myLibrary = cloudData.map(book => ({
                ...book,
                id: Math.random().toString(36).substr(2, 9)
            }));
            saveLibrary();
            renderLibrary();
            showStatus("Sync Complete", "#28a745");
        }
    } catch (err) {
        console.error("Sync Error:", err);
        showStatus("Sync Failed - Check Console", "#dc3545");
    }
}

/**
 * 3. CLOUD SYNC ENGINE (doPost)
 */
async function cloudSync(action, book) {
    if (!GOOGLE_SHEET_URL || GOOGLE_SHEET_URL.includes("PASTE_YOUR")) return;
    try {
        await fetch(GOOGLE_SHEET_URL, {
            method: "POST",
            mode: "no-cors", // Required for Google Apps Script
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: action, data: book })
        });
        console.log(`Cloud ${action} successful`);
    } catch (err) {
        console.error(`Cloud ${action} failed:`, err);
    }
}

/**
 * 4. VIEW & MODAL LOGIC
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
 * 5. SCANNER & BOOK PROCESSING
 */
async function startScanner() {
    if (!window.Quagga) await loadQuagga();
    Quagga.init({
        inputStream: {
            name: "Live",
            type: "LiveStream",
            target: document.querySelector('#interactive'),
            constraints: { facingMode: "environment" }
        },
        decoder: { readers: ["ean_reader"] }
    }, (err) => {
        if (!err) Quagga.start();
    });
    Quagga.onDetected(onScanSuccess);
}

async function loadQuagga() {
    return new Promise((res) => {
        const s = document.createElement("script");
        s.src = Quagga_CDN;
        s.onload = res;
        document.head.appendChild(s);
    });
}

async function onScanSuccess(data) {
    if (!isScanning) return;
    const code = data.codeResult.code;
    if (code === lastResult) { count++; } else { lastResult = code; count = 0; }

    if (count >= 12) { 
        isScanning = false; 
        document.body.classList.add('flash-active');
        await handleScannedBook(code);
    }
}

async function handleScannedBook(isbn) {
    // DUPLICATE CHECK
    if (myLibrary.some(b => b.isbn.toString() === isbn.toString())) {
        alert("This book is already in your library!");
        showView('view-home');
        return;
    }

    showStatus("Fetching details...", "#007bff");

    try {
        const res = await fetch(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}`);
        const data = await res.json();
        
        let bookInfo = { title: "ISBN: " + isbn, authors: ["Unknown"] };
        if (data.items && data.items.length > 0) bookInfo = data.items[0].volumeInfo;

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
        cloudSync('add', book); // Write to Sheets
        
        showStatus("Saved!", "#28a745");
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
 * 6. LIBRARY MANAGEMENT
 */
function toggleRead(id) {
    const book = myLibrary.find(b => b.id === id);
    if(book) {
        book.isRead = !book.isRead;
        saveLibrary();
        renderLibrary();
        cloudSync('update', book); // Update Sheets
    }
}

async function deleteBook(id) {
    const bookToDelete = myLibrary.find(b => b.id === id);
    if (!bookToDelete) return;

    if (confirm(`Delete "${bookToDelete.title}"?`)) {
        // Remove from UI and Local Storage immediately
        myLibrary = myLibrary.filter(b => b.id !== id);
        saveLibrary();
        renderLibrary();

        // Tell Google to delete it
        try {
            await cloudSync('delete', bookToDelete);
            showStatus("Deleted everywhere", "#dc3545");
        } catch (err) {
            // Even if the cloud call fails, the book is gone from the UI
            console.log("Cloud delete failed, but local copy removed.");
        }
    }
}

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

function saveLibrary() { localStorage.setItem('myLibrary', JSON.stringify(myLibrary)); }

function showStatus(message, color) {
    const toast = document.createElement("div");
    toast.textContent = message;
    toast.className = "toast";
    toast.style.backgroundColor = color;
    document.body.appendChild(toast);
    setTimeout(() => { toast.style.opacity = "0"; setTimeout(() => toast.remove(), 500); }, 2000);
}