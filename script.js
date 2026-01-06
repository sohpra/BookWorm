// 1. Initialize the Scanner here
let html5QrCode = null;
let isScanning = true;

//const config = { fps: 5, qrbox: { width: 250, height: 250 } };

const HTML5_QR_CODE_CDN = 'https://unpkg.com/html5-qrcode@2.3.8/dist/html5-qrcode.min.js';
const HTML5_QR_CODE_CDN_FALLBACK = 'https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/dist/html5-qrcode.min.js';
// 1a. Ensure html5-qrcode library is loaded

function ensureHtml5QrcodeLoaded(timeout = 20000) {
  return new Promise((resolve, reject) => {
    if (window.Html5Qrcode) return resolve(true);

    let timedOut = false;
    const attempts = [];
    const timer = setTimeout(() => {
      timedOut = true;
      reject(new Error('Timed out loading html5-qrcode library; attempted: ' + attempts.join(', ')));
    }, timeout);

    function tryLoad(src, onSuccess, onError) {
      attempts.push(src);
      const existing = document.querySelector(`script[src="${src}"]`);
      if (existing) {
        // If it's already in the DOM, wait for it to load or error
        existing.addEventListener('load', onSuccess);
        existing.addEventListener('error', onError);
        return;
      }
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = onSuccess;
      s.onerror = onError;
      document.head.appendChild(s);
    }

    // Try local vendor first (reliable when offline or CDN blocked)
    tryLoad('/vendor/html5-qrcode.min.js', () => {
      if (timedOut) return;
      clearTimeout(timer);
      if (window.Html5Qrcode) return resolve(true);
      // vendor loaded but did not initialize the global; fall through to CDNs
      tryLoad(HTML5_QR_CODE_CDN, onCdnLoaded, onCdnError);
    }, () => {
      if (timedOut) return;
      // vendor failed or not present -> try primary CDN
      tryLoad(HTML5_QR_CODE_CDN, onCdnLoaded, onCdnError);
    });

    function onCdnLoaded() {
      if (timedOut) return;
      clearTimeout(timer);
      if (window.Html5Qrcode) return resolve(true);
      // CDN script loaded but Html5Qrcode not defined
      // Try fallback CDN
      tryLoad(HTML5_QR_CODE_CDN_FALLBACK, () => {
        if (timedOut) return;
        clearTimeout(timer);
        if (window.Html5Qrcode) return resolve(true);
        return reject(new Error('html5-qrcode script loaded but global not present.'));
      }, (e) => { clearTimeout(timer); reject(new Error('Failed to load fallback CDN: ' + (e && e.message ? e.message : e))); });
    }

    function onCdnError(e) {
      if (timedOut) return;
      // primary CDN failed -> try fallback CDN
      tryLoad(HTML5_QR_CODE_CDN_FALLBACK, () => {
        if (timedOut) return;
        clearTimeout(timer);
        if (window.Html5Qrcode) return resolve(true);
        return reject(new Error('html5-qrcode script loaded from fallback CDN but global not present.'));
      }, (err) => {
        if (timedOut) return;
        clearTimeout(timer);
        // last resort: try vendor again in case it was being added separately
        tryLoad('/vendor/html5-qrcode.min.js', () => {
          if (window.Html5Qrcode) return resolve(true);
          return reject(new Error('Failed to load any html5-qrcode sources. Attempted: ' + attempts.join(', ')));
        }, (e2) => { reject(new Error('Failed to load any html5-qrcode sources. Attempted: ' + attempts.join(', '))); });
      });
    }
  });
}

function showScannerError(msg) {
  const el = document.getElementById('scanner-error');
  const retry = document.getElementById('retry-camera-btn');
  if (el) {
    el.textContent = msg || '';
    el.style.display = msg ? 'block' : 'none';
  }
  if (retry) retry.style.display = msg ? 'inline-block' : 'none';
}

function clearScannerError() {
  showScannerError('');
}

// 2. The Scanner Start Function
function startScanner() {
  clearScannerError();

  if (!window.Html5Qrcode) {
    const msg = 'html5-qrcode library not loaded';
    console.error(msg);
    showScannerError(msg);
    return;
  }

  if (!html5QrCode) html5QrCode = new Html5Qrcode('reader');

  // We are defining the settings directly here to avoid "selfie" resets
  html5QrCode.start(
    { facingMode: "environment" }, // 1. Force Back Camera
    {
      fps: 20,                       // 2. Faster scanning
      qrbox: { width: 280, height: 180 }, // 3. Slightly larger box for distance
      aspectRatio: 1.777778          // 4. Widescreen helps some sensors focus
    },
    onScanSuccess
  )
    .then(() => clearScannerError())
    .catch(err => {
      console.error("Scanner won't start:", err);
      // Fallback: If 'environment' fails, try starting without constraints
      html5QrCode.start({ facingMode: "user" }, { fps: 10, qrbox: 250 }, onScanSuccess);
    });
}

// 3. What happens when a book is found
async function onScanSuccess(decodedText) {
  if (!isScanning) return;

  isScanning = false; // Pause scanning logic
  console.log('ISBN detected:', decodedText);

  try {
    const added = await handleScannedBook(decodedText);
    if (added) {
      console.log('Book found and added to library');
    }
  } catch (error) {
    console.error('API Error:', error);
  }

  // Always wait 3 seconds then allow scanning again
  setTimeout(() => { isScanning = true; }, 3000);
}


// Local library state and UI
const myLibrary = [];

function saveLibrary() {
  try {
    localStorage.setItem('myLibrary', JSON.stringify(myLibrary));
  } catch (e) {
    console.warn('Could not save library to localStorage', e);
  }
}

function loadLibrary() {
  try {
    const raw = localStorage.getItem('myLibrary');
    if (!raw) return;
    const arr = JSON.parse(raw);
    myLibrary.length = 0;
    arr.forEach(item => myLibrary.push(item));
  } catch (e) {
    console.warn('Could not load library from localStorage', e);
  }
}

function renderLibrary() {
  const list = document.getElementById('book-list');
  if (!list) return;
  list.innerHTML = '';

  // grid of book cards
  myLibrary.forEach(book => {
    const li = document.createElement('li');
    li.className = 'book-item';

    const img = document.createElement('img');
    img.className = 'book-cover';
    img.alt = book.title || 'No cover';
    if (book.image) img.src = book.image;

    const info = document.createElement('div');
    info.className = 'book-info';
    info.innerHTML = `<strong>${escapeHtml(book.title)}</strong><br><em>${escapeHtml(book.author)}</em>`;

    const controls = document.createElement('div');
    controls.className = 'book-controls';

    // Read checkbox
    const readLabel = document.createElement('label');
    readLabel.textContent = 'Read: ';
    const readCheckbox = document.createElement('input');
    readCheckbox.type = 'checkbox';
    readCheckbox.checked = !!book.isRead;
    readCheckbox.addEventListener('change', () => {
      book.isRead = readCheckbox.checked;
      saveLibrary();
    });
    readLabel.appendChild(readCheckbox);

    // Rating select (0-5)
    const ratingSelect = document.createElement('select');
    ratingSelect.className = 'book-rating';
    const optNone = document.createElement('option');
    optNone.value = '0';
    optNone.text = 'Not rated';
    ratingSelect.appendChild(optNone);
    for (let r = 1; r <= 5; r++) {
      const opt = document.createElement('option');
      opt.value = String(r);
      opt.text = `${r} ★`;
      ratingSelect.appendChild(opt);
    }
    ratingSelect.value = String(book.rating || 0);
    ratingSelect.addEventListener('change', () => {
      book.rating = parseInt(ratingSelect.value, 10);
      saveLibrary();
    });

    // Delete button
    const delBtn = document.createElement('button');
    delBtn.textContent = 'Delete';
    delBtn.addEventListener('click', () => {
      deleteBook(book.id);
    });

    controls.appendChild(readLabel);
    controls.appendChild(ratingSelect);
    controls.appendChild(delBtn);

    li.appendChild(img);
    li.appendChild(info);
    li.appendChild(controls);
    list.appendChild(li);
  });
}

function normalizeIsbn(isbn) {
  return String(isbn || '').replace(/[^0-9Xx]/g, '').toUpperCase();
}

function makeId() {
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2,8);
}

function addBook(book) {
  if (!book || !book.isbn) return false;
  // normalize ISBN
  book.isbn = normalizeIsbn(book.isbn);
  if (myLibrary.some(b => normalizeIsbn(b.isbn) === book.isbn)) {
    console.log('Book already in library:', book.isbn);
    return false;
  }

  // ensure required fields
  if (!book.id) book.id = makeId();
  if (!('isRead' in book)) book.isRead = false;
  if (!('rating' in book)) book.rating = 0;
  // image key for UI
  if (!book.image && book.cover) book.image = book.cover;

  myLibrary.push(book);
  saveLibrary();
  renderLibrary();
  return true;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"]+/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[s] || s));
}

function appendOutput(msg) {
  const outEl = document.getElementById('diagnostics-output');
  if (!outEl) return;
  outEl.style.display = 'block';
  outEl.textContent += msg + '\n';
}

function deleteBook(id) {
  const idx = myLibrary.findIndex(b => b.id === id);
  if (idx === -1) return false;
  myLibrary.splice(idx, 1);
  saveLibrary();
  renderLibrary();
  return true;
}

async function runDiagnostics() {
  const outEl = document.getElementById('diagnostics-output');
  if (outEl) { outEl.style.display = 'block'; outEl.textContent = 'Running diagnostics...\n'; }

  // getUserMedia test
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    appendOutput('navigator.mediaDevices.getUserMedia is not available in this browser.');
  } else {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      stream.getTracks().forEach(t => t.stop());
      appendOutput('getUserMedia: OK (camera permission available)');
    } catch (err) {
      appendOutput('getUserMedia error: ' + (err && err.message ? err.message : err));
    }
  }

  // enumerateDevices test
  if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
    appendOutput('navigator.mediaDevices.enumerateDevices is not available.');
  } else {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cams = devices.filter(d => d.kind === 'videoinput');
      appendOutput(`videoinput devices (${cams.length}):`);
      cams.forEach((c, i) => appendOutput(`${i+1}. label="${c.label}" id="${c.deviceId}" groupId="${c.groupId}"`));
      if (cams.length === 0) appendOutput('No video input devices found. If labels are empty, try granting camera permission and rerun diagnostics.');
    } catch (err) {
      appendOutput('enumerateDevices error: ' + (err && err.message ? err.message : err));
    }
  }

  // CDN / vendor reachability tests
  const urls = [HTML5_QR_CODE_CDN, HTML5_QR_CODE_CDN_FALLBACK, '/vendor/html5-qrcode.min.js'];
  appendOutput('Checking html5-qrcode reachability...');
  for (const u of urls) {
    try {
      const r = await fetch(u, { method: 'GET', cache: 'no-store' });
      appendOutput(`${u} => HTTP ${r.status} ${r.ok ? 'OK' : 'NOT OK'}`);
    } catch (err) {
      appendOutput(`${u} fetch error: ` + (err && err.message ? err.message : err));
    }
  }

  appendOutput('Diagnostics complete.');
}

// Handle scanned book: lookup Google Books and add to library
async function handleScannedBook(isbn) {
  const cleanIsbn = normalizeIsbn(isbn);
  if (!cleanIsbn) return null;

  // Avoid duplicates early
  if (myLibrary.some(b => normalizeIsbn(b.isbn) === cleanIsbn)) {
    console.log('Already have ISBN in library:', cleanIsbn);
    return null;
  }

  try {
    const url = `https://www.googleapis.com/books/v1/volumes?q=isbn:${encodeURIComponent(cleanIsbn)}`;
    const res = await fetch(url);
    if (!res.ok) {
      console.error('Google Books API error', res.status);
      return null;
    }
    const data = await res.json();
    if (!data.totalItems || data.totalItems === 0) {
      console.warn('No book found for ISBN', cleanIsbn);
      return null;
    }

    const item = data.items[0];
    const info = item.volumeInfo || {};
    const title = info.title || 'Unknown Title';
    const author = (info.authors && info.authors.join(', ')) || 'Unknown Author';
    const cover = (info.imageLinks && (info.imageLinks.thumbnail || info.imageLinks.smallThumbnail)) || '';

    const book = {
      isbn: cleanIsbn,
      title,
      author,
      image: cover,
      isRead: false,
      rating: 0
    };

    const added = addBook(book);
    if (added) console.log('Book added:', cleanIsbn, title);
    return book;
  } catch (err) {
    console.error('Error fetching book details', err);
    return null;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const retryBtn = document.getElementById('retry-camera-btn');
  if (retryBtn) {
    retryBtn.addEventListener('click', () => {
      clearScannerError();
      initScanner();
    });
  }
  const diagBtn = document.getElementById('run-diagnostics-btn');
  if (diagBtn) {
    diagBtn.addEventListener('click', runDiagnostics);
  }
  // Load library from localStorage and render
  loadLibrary();
  renderLibrary();

  const addBtn = document.getElementById('add-book-btn');
  if (addBtn) {
    addBtn.addEventListener('click', async () => {
      const manualIsbn = prompt('Enter ISBN to add:');
      if (manualIsbn) {
        const book = await handleScannedBook(manualIsbn.trim());
        if (book) alert(`Added: ${book.title} by ${book.author}`);
      }
    });
  }

  initScanner();
});

async function initScanner() {
  clearScannerError();
  try {
    await ensureHtml5QrcodeLoaded();
    startScanner();
  } catch (err) {
    const msg = `Failed to load html5-qrcode library: ${err && err.message ? err.message : err}`;
    console.error(msg);
    showScannerError(msg);
  }
}

document.getElementById('export-btn').addEventListener('click', () => {
  if (myLibrary.length === 0) {
    alert("Your library is empty!");
    return;
  }

  // 1. Create CSV Header
  const headers = ["Title", "Author", "ISBN", "Read Status", "Rating"];
  
  // 2. Map library data to rows
  const rows = myLibrary.map(book => [
    `"${book.title}"`, 
    `"${book.author}"`, 
    `'${book.isbn}`, // The ' prevents Excel from formatting it as a number
    book.isRead ? "Read" : "Unread",
    book.rating
  ]);

  // 3. Combine headers and rows
  const csvContent = [headers, ...rows].map(e => e.join(",")).join("\n");

  // 4. Create a hidden link and "click" it to trigger download
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", "my_library_backup.csv");
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
});
