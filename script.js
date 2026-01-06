// 1. Global State
let html5QrCode = null;
let isScanning = true;
const myLibrary = [];

const HTML5_QR_CODE_CDN = 'https://unpkg.com/html5-qrcode@2.3.8/dist/html5-qrcode.min.js';

// 2. Library Loader
function ensureHtml5QrcodeLoaded() {
  return new Promise((resolve, reject) => {
    if (window.Html5Qrcode) return resolve(true);
    const s = document.createElement('script');
    s.src = HTML5_QR_CODE_CDN;
    s.onload = () => resolve(true);
    s.onerror = () => reject(new Error("Could not load scanner library. Check internet."));
    document.head.appendChild(s);
  });
}

// 3. The Scanner Start Function
async function startScanner() {
  try {
    if (!html5QrCode) {
      // Focus specifically on EAN_13 (ISBN barcodes) for better speed
      html5QrCode = new Html5Qrcode("reader", { 
        formatsToSupport: [ Html5QrcodeSupportedFormats.EAN_13 ] 
      });
    }

    const config = {
      fps: 20,
      qrbox: { width: 300, height: 180 }, // Rectangular for ISBN
      aspectRatio: 1.777778
    };

    await html5QrCode.start(
      { facingMode: "environment" }, 
      config,
      onScanSuccess
    );
    
    console.log("Back camera active and optimized for ISBN.");
    document.getElementById('scanner-error').textContent = "";
  } catch (err) {
    console.error("Scanner failed:", err);
    document.getElementById('scanner-error').textContent = "Camera error: Please ensure you allowed permissions.";
  }
}

// 4. Handle Success
async function onScanSuccess(decodedText) {
  if (!isScanning) return;
  isScanning = false; 

  // Feedback: Vibrate phone if supported
  if (navigator.vibrate) navigator.vibrate(100);

  console.log('Detected:', decodedText);
  await handleScannedBook(decodedText);

  // Pause for 3 seconds so it doesn't scan the same book twice
  setTimeout(() => { isScanning = true; }, 3000);
}

// 5. API Fetch and Library Logic
async function handleScannedBook(isbn) {
  const cleanIsbn = String(isbn).replace(/[^0-9Xx]/g, '');
  
  // Check if book already exists
  if (myLibrary.some(b => b.isbn === cleanIsbn)) {
    alert("Book already in your library!");
    return;
  }

  try {
    const res = await fetch(`https://www.googleapis.com/books/v1/volumes?q=isbn:${cleanIsbn}`);
    const data = await res.json();
    
    if (!data.items) {
      alert("Book details not found, but added to list as ISBN: " + cleanIsbn);
      addBookToState({ isbn: cleanIsbn, title: "Unknown Title", author: "Unknown", image: "" });
      return;
    }

    const info = data.items[0].volumeInfo;
    const book = {
      id: Date.now().toString(36),
      isbn: cleanIsbn,
      title: info.title || 'Unknown Title',
      author: (info.authors && info.authors.join(', ')) || 'Unknown Author',
      image: (info.imageLinks && (info.imageLinks.thumbnail || info.imageLinks.smallThumbnail)) || '',
      isRead: false,
      rating: 0
    };

    addBookToState(book);
  } catch (err) {
    console.error('API error:', err);
  }
}

function addBookToState(book) {
  myLibrary.push(book);
  saveLibrary();
  renderLibrary();
}

// 6. UI Rendering
function renderLibrary() {
  const list = document.getElementById('book-list');
  if (!list) return;
  list.innerHTML = '';

  myLibrary.forEach(book => {
    const li = document.createElement('li');
    li.className = 'book-item';
    li.innerHTML = `
      <img class="book-cover" src="${book.image || 'https://via.placeholder.com/50x75?text=No+Cover'}" alt="cover">
      <div class="book-info">
        <strong>${book.title}</strong><br>
        <em>${book.author}</em>
      </div>
      <button onclick="deleteBook('${book.id}')" style="background:#ff4444; color:white; border:none; padding:5px; border-radius:4px;">Delete</button>
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
    myLibrary.length = 0;
    myLibrary.push(...data);
  }
}

// 7. Initialization
document.addEventListener('DOMContentLoaded', async () => {
  loadLibrary();
  renderLibrary();
  
  try {
    await ensureHtml5QrcodeLoaded();
    startScanner();
  } catch (err) {
    document.getElementById('scanner-error').textContent = err.message;
  }

  // Manual Add Logic
  const addBtn = document.getElementById('add-book-btn');
  if (addBtn) {
    addBtn.addEventListener('click', async () => {
      const isbn = prompt('Enter 13-digit ISBN:');
      if (isbn) await handleScannedBook(isbn);
    });
  }
});

// 8. Export to CSV
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