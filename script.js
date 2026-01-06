/* ===================== CONFIG ===================== */
const GOOGLE_SHEET_URL = "https://script.google.com/macros/s/AKfycbw1oZV1HEO21oadgp6IKkq9XR4v-2fwuinuKnAr_U1SyFYIrWqcNIpy6gux44pzgBAa_g/exec";
const Quagga_CDN = "https://cdn.jsdelivr.net/npm/@ericblade/quagga2/dist/quagga.min.js";

let myLibrary = [];
let scannerActive = false;
let detectionLocked = false;
let mediaStream = null;

/* ===================== NAVIGATION ===================== */
function showView(id) {
  document.querySelectorAll('.view').forEach(v => v.style.display = 'none');
  document.getElementById(id).style.display = 'block';

  if (id === 'view-scanner') {
    setTimeout(startScanner, 200);
  } else {
    stopScanner();
  }
}

/* ===================== SCANNER ===================== */
async function loadQuagga() {
  if (window.Quagga) return;
  const s = document.createElement("script");
  s.src = Quagga_CDN;
  const p = new Promise((res, rej) => { s.onload = res; s.onerror = rej; });
  document.head.appendChild(s);
  await p;
}

async function startScanner() {
  if (scannerActive) return;
  scannerActive = true;
  detectionLocked = false;

  const box = document.getElementById('interactive');
  box.innerHTML = '';

  await loadQuagga();

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
  } catch {
    alert("Camera permission denied.");
    scannerActive = false;
    return;
  }

  Quagga.init({
    inputStream: { type: "LiveStream", target: box, constraints: { facingMode: "environment" }},
    decoder: { readers: ["ean_reader"] },
    locate: true
  }, err => {
    if (err) return console.error(err);
    Quagga.start();
    const v = box.querySelector("video");
    if (v) { v.setAttribute("playsinline", "true"); v.play(); }
  });

  if (Quagga.offDetected) Quagga.offDetected(onDetected);
  Quagga.onDetected(onDetected);
}

function stopScanner() {
  scannerActive = false;
  detectionLocked = false;
  try { if (window.Quagga) Quagga.stop(); } catch {}
  if (mediaStream) { mediaStream.getTracks().forEach(t => t.stop()); mediaStream = null; }
  document.getElementById('interactive').innerHTML = '';
}

async function onDetected(data) {
  if (detectionLocked) return;
  detectionLocked = true;
  stopScanner();
  if (navigator.vibrate) navigator.vibrate(100);
  handleISBN(data.codeResult.code);
}

/* ===================== BOOK FLOW ===================== */
async function handleISBN(isbn) {
  isbn = isbn.replace(/[^0-9X]/gi, "");

  if (!isValidISBN(isbn)) {
    showToast("This barcode is not a book ISBN", "#dc3545");
    showView("view-home");
    return;
  }

  showToast("Searching...", "#6c5ce7");

  try {
    let title, author, image;

    // Try Google Books first
    try {
      const g = await fetch(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}&maxResults=1&key=YOUR_KEY`);
      const gj = await g.json();
      if (gj.items && gj.items.length) {
        const i = gj.items[0].volumeInfo;
        title = i.title;
        author = i.authors?.join(", ");
        image = i.imageLinks?.thumbnail;
      }
    } catch {}

    // Fallback to OpenLibrary if Google failed
    if (!title) {
      const o = await fetch(`https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`);
      const oj = await o.json();
      const b = oj[`ISBN:${isbn}`];
      if (!b) throw new Error("Not found");

      title = b.title;
      author = b.authors?.map(a => a.name).join(", ");
      image = b.cover?.medium;
    }

    title ||= "Unknown";
    author ||= "Unknown";
    image ||= "https://via.placeholder.com/50x75?text=No+Cover";
    image = image.replace("http://", "https://");

    const isRead = await askReadStatus(title);
    const book = { isbn, title, author, image, isRead };

    myLibrary = myLibrary.filter(b => b.isbn !== isbn);
    myLibrary.push(book);
    saveLibrary();
    renderLibrary();
    cloudSync("add", book);
    showView("view-library");

  } catch {
    showToast("Book not found", "#dc3545");
    showView("view-home");
  }
}


/* ===================== CLOUD ===================== */
async function loadLibrary() {
  showToast("Syncing...", "#17a2b8");
  try {
    const res = await fetch(GOOGLE_SHEET_URL);
    const data = await res.json();
    if (Array.isArray(data)) {
      myLibrary = data;
      saveLibrary();
      renderLibrary();
      showToast("Sync OK", "#28a745");
    }
  } catch { showToast("Offline Mode", "#6c757d"); }
}

function cloudSync(action, book) {
  fetch(GOOGLE_SHEET_URL, {
    method: "POST",
    body: JSON.stringify({ action, data: book })
  });
}

/* ===================== UI ===================== */
function askReadStatus(title) {
  return new Promise(res => {
    const m = document.getElementById("read-modal");
    document.getElementById("modal-title").textContent = title;
    m.style.display = "flex";
    document.getElementById("btn-read-yes").onclick = () => { m.style.display = "none"; res(true); };
    document.getElementById("btn-read-no").onclick = () => { m.style.display = "none"; res(false); };
  });
}

function renderLibrary() {
  const list = document.getElementById("book-list");
  list.innerHTML = "";
  myLibrary.forEach(b => {
    const li = document.createElement("li");
    li.className = "book-item";

    const img = document.createElement("img");
    img.src = b.image;

    const info = document.createElement("div");
    info.className = "book-info";

    const title = document.createElement("strong");
    title.textContent = b.title;

    const flag = document.createElement("span");
    flag.className = `status-flag ${b.isRead ? "read" : "unread"}`;
    flag.textContent = b.isRead ? "✅ Read" : "📖 Unread";
    flag.onclick = () => toggleRead(b.isbn);

    const del = document.createElement("button");
    del.className = "delete-btn";
    del.textContent = "🗑️";
    del.onclick = () => deleteBook(b.isbn);

    info.append(title, flag);
    li.append(img, info, del);
    list.appendChild(li);
  });
}

function toggleRead(isbn) {
  const b = myLibrary.find(x => x.isbn === isbn);
  if (!b) return;
  b.isRead = !b.isRead;
  saveLibrary();
  renderLibrary();
  cloudSync("update", b);
}

function deleteBook(isbn) {
  if (!confirm("Delete?")) return;
  myLibrary = myLibrary.filter(b => b.isbn !== isbn);
  saveLibrary();
  renderLibrary();
  cloudSync("delete", { isbn });
}

/* ===================== UTIL ===================== */
function saveLibrary() {
  localStorage.setItem("myLibrary", JSON.stringify(myLibrary));
}

function showToast(msg, color) {
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;
  t.style.background = color;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2500);
}

function isValidISBN(isbn) {
  if (isbn.length === 10) {
    let sum = 0;
    for (let i = 0; i < 10; i++) {
      let c = isbn[i] === 'X' ? 10 : parseInt(isbn[i]);
      sum += c * (10 - i);
    }
    return sum % 11 === 0;
  }

  if (isbn.length === 13) {
    let sum = 0;
    for (let i = 0; i < 13; i++) {
      let n = parseInt(isbn[i]);
      sum += n * (i % 2 === 0 ? 1 : 3);
    }
    return sum % 10 === 0;
  }

  return false;
}

/* ===================== MANUAL ISBN ===================== */
document.getElementById("manual-btn").onclick = () => {
  const isbn = prompt("Enter ISBN:");
  if (isbn) handleISBN(isbn.trim());
};

/* ===================== INIT ===================== */
window.onload = () => {
  const saved = localStorage.getItem("myLibrary");
  if (saved) myLibrary = JSON.parse(saved);
  renderLibrary();
  showView("view-home");
};
