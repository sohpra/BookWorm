// 1. Initialize Global State
let html5QrCode = null;
let isScanning = true;
const myLibrary = [];

const HTML5_QR_CODE_CDN = 'https://unpkg.com/html5-qrcode@2.3.8/dist/html5-qrcode.min.js';
const HTML5_QR_CODE_CDN_FALLBACK = 'https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/dist/html5-qrcode.min.js';

// 2. Library Loading Logic
function ensureHtml5QrcodeLoaded(timeout = 20000) {
  return new Promise((resolve, reject) => {
    if (window.Html5Qrcode) return resolve(true);
    const s = document.createElement('script');
    s.src = HTML5_QR_CODE_CDN;
    s.onload = () => resolve(true);
    s.onerror = () => {
        const s2 = document.createElement('script');
        s2.src = HTML5_QR_CODE_CDN_FALLBACK;
        s2.onload = () => resolve(true);
        s2.onerror = reject;
        document.head.appendChild(s2);
    };
    document.head.appendChild(s);
  });
}

// 3. The CLEANED Start Function
function startScanner() {
  if (!html5QrCode) html5QrCode = new Html5Qrcode("reader");

  const config = {
    fps: 20,
    qrbox: { width: 280, height: 180 },
    aspectRatio: 1.777778
  };

  // We use facingMode: "environment" without "exact" to prevent crashes, 
  // but we put it first to ensure Safari picks the back camera.
  html5QrCode.start(
    { facingMode: "environment" }, 
    config,
    onScanSuccess
  )
  .then(() => {
      console.log("Back camera active");
      clearScannerError();
  })
  .catch(err => {
      console.error("Scanner failed:", err);
      showScannerError("Camera error. Please refresh and allow access.");
  });
}

// 4. Scanning Success Logic
async function onScanSuccess(decodedText) {
  if (!isScanning) return;
  isScanning = false; 
  
  // Visual feedback: briefly hide the box or show a message
  console.log('ISBN detected:', decodedText);

  try {
    const added = await handleScannedBook(decodedText);
    if (added) {
        // Optional: play a sound or vibrate phone here
    }
  } catch (error) {
    console.error('API Error:', error);
  }

  // Wait 3 seconds before allowing next scan
  setTimeout(() => { isScanning = true; }, 3000);
}

// 5. Google Books API & Library Management
async function handleScannedBook(isbn) {
  const cleanIsbn = String(isbn).replace(/[^0-9Xx]/g, '');
  if (myLibrary.some(b => b.isbn === cleanIsbn)) return null;

  try {
    const res = await fetch(`https://www.googleapis.com/books/v1/volumes?q=isbn:${cleanIsbn}`);
    const data = await res.json();
    if (!data.items) {
        alert("Book not found in database.");
        return null;
    }

    const info = data.items[0].volumeInfo;
    const book = {
      id: Date.now().toString(36),
      isbn: cleanIsbn,
      title: info.title || 'Unknown',
      author: (info.authors && info.authors.join(', ')) || 'Unknown',
      image: (info.imageLinks && info.imageLinks.thumbnail) || '',
      isRead: false,
      rating: 0
    };

    myLibrary.push(book);
    saveLibrary();
    renderLibrary();
    return book;
  } catch (err) {
    return null;
  }
}

// 6. UI Helpers
function renderLibrary() {
  const list = document.getElementById('book-list');
  if (!list) return;
  list.innerHTML = '';
  myLibrary.forEach(book => {
    const li = document.createElement('li');
    li.className = 'book-item';
    li.innerHTML = `
        <img class="book-cover" src="${book.image}" alt="cover">
        <div class="book-info">
            <strong>${book.title}</strong><br>
            <em>${book.author}</em>
        </div>
        <button onclick="deleteBook('${book.id}')">Delete</button>
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

function saveLibrary() { localStorage.setItem('myLibrary', JSON.stringify(myLibrary)); }
function loadLibrary() {
  const raw = localStorage.getItem('myLibrary');
  if (raw) {
      const data = JSON.parse(raw);
      myLibrary.push(...data);
  }
}

function showScannerError(msg) { document.getElementById('scanner-error').textContent = msg; }
function clearScannerError() { document.getElementById('scanner-error').textContent = ''; }

// 7. Initialize Everything
document.addEventListener('DOMContentLoaded', async () => {
  loadLibrary();
  renderLibrary();
  
  try {
    await ensureHtml5QrcodeLoaded();
    startScanner();
  } catch (err) {
    showScannerError("Library failed to load.");
  }

  // Manual Add Button
  const addBtn = document.getElementById('add-book-btn');
  if (addBtn) {
    addBtn.addEventListener('click', async () => {
      const isbn = prompt('Enter ISBN:');
      if (isbn) await handleScannedBook(isbn);
    });
  }
});

// 8. Export Function
document.getElementById('export-btn').addEventListener('click', () => {
  const headers = ["Title", "Author", "ISBN"];
  const rows = myLibrary.map(b => [`"${b.title}"`, `"${b.author}"`, `'${b.isbn}`]);
  const csv = [headers, ...rows].map(e => e.join(",")).join("\n");
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "library.csv";
  a.click();
});