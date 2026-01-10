/* ===================== CONFIG ===================== */
const GOOGLE_SHEET_URL =
  "https://script.google.com/macros/s/AKfycbw1oZV1HEO21oadgp6IKkq9XR4v-2fwuinuKnAr_U1SyFYIrWqcNIpy6gux44pzgBAa_g/exec";
const Quagga_CDN =
  "https://cdn.jsdelivr.net/npm/@ericblade/quagga2/dist/quagga.min.js";

// TODO: Replace with your real key when Google Books is provisioned.
// Leave as "" to skip Google Books and use OpenLibrary only.
const GOOGLE_BOOKS_API_KEY = "YOUR_KEY";

let myLibrary = [];
let scannerActive = false;
let detectionLocked = false;
let mediaStream = null;

// detection stability
let lastCode = null;
let sameCount = 0;
let lastAcceptTs = 0;

/* ===================== NAVIGATION ===================== */
function showView(id) {
  document.querySelectorAll(".view").forEach((v) => (v.style.display = "none"));
  document.getElementById(id).style.display = "block";

  if (id === "view-scanner") {
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
  const p = new Promise((res, rej) => {
    s.onload = res;
    s.onerror = rej;
  });
  document.head.appendChild(s);
  await p;
}

function resetDetectionStability() {
  lastCode = null;
  sameCount = 0;
  lastAcceptTs = 0;
}

function isPlausibleIsbnBarcode(raw) {
  // allow digits and possibly X for ISBN-10
  const cleaned = raw.replace(/[^0-9X]/gi, "");
  if (cleaned.length === 13) {
    // ISBN-13 should usually start with 978 or 979
    return cleaned.startsWith("978") || cleaned.startsWith("979");
  }
  if (cleaned.length === 10) return true;
  return false;
}

async function startScanner() {
  if (scannerActive) return;
  scannerActive = true;
  detectionLocked = false;
  resetDetectionStability();

  const box = document.getElementById("interactive");
  box.innerHTML = "";

  await loadQuagga();

  // Request higher-res camera stream up front (helps a lot on phones)
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
      audio: false,
    });
  } catch {
    alert("Camera permission denied.");
    scannerActive = false;
    return;
  }

  Quagga.init(
    {
      inputStream: {
        type: "LiveStream",
        target: box,
        constraints: {
          facingMode: "environment",
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        // Helps avoid iOS Safari forcing fullscreen
        area: { top: "25%", right: "10%", left: "10%", bottom: "25%" }, // focus center area
      },
      decoder: {
        readers: ["ean_reader"], // EAN-13 covers ISBN-13 (978/979)
        multiple: false,
      },
      locate: true,
      locator: {
        patchSize: "large",
        halfSample: false, // more accurate (slower, but worth it on phones)
      },
      numOfWorkers: navigator.hardwareConcurrency || 4,
      frequency: 10, // process 10 frames/sec
    },
    (err) => {
      if (err) {
        console.error("Quagga init error:", err);
        showToast("Scanner failed to start", "#dc3545");
        scannerActive = false;
        return;
      }
      Quagga.start();

      const v = box.querySelector("video");
      if (v) {
        v.setAttribute("playsinline", "true");
        v.setAttribute("webkit-playsinline", "true");
        v.play().catch(() => {});
      }
    }
  );

  // Ensure we don't accumulate handlers.
  if (Quagga.offDetected) Quagga.offDetected(onDetectedRaw);
  Quagga.onDetected(onDetectedRaw);

  // Optional: draw debug boxes (comment out if you don't want it)
  // if (Quagga.onProcessed) {
  //   Quagga.onProcessed((result) => {});
  // }
}

function stopScanner() {
  scannerActive = false;
  detectionLocked = false;
  resetDetectionStability();

  try {
    if (window.Quagga) Quagga.stop();
  } catch {}

  if (mediaStream) {
    try {
      mediaStream.getTracks().forEach((t) => t.stop());
    } catch {}
    mediaStream = null;
  }

  const el = document.getElementById("interactive");
  if (el) el.innerHTML = "";
}

function onDetectedRaw(result) {
  if (detectionLocked) return;

  const raw = result?.codeResult?.code;
  if (!raw) return;

  // Filter out obviously non-ISBN EAN noise early
  if (!isPlausibleIsbnBarcode(raw)) return;

  // Require the same code 3 times in a row (huge reliability improvement)
  if (raw === lastCode) sameCount += 1;
  else {
    lastCode = raw;
    sameCount = 1;
  }

  // Also debounce accepts
  const now = Date.now();
  if (now - lastAcceptTs < 1200) return;

  if (sameCount >= 3) {
    lastAcceptTs = now;
    onDetected(result);
  }
}

async function onDetected(result) {
  if (detectionLocked) return;
  detectionLocked = true;

  stopScanner();

  if (navigator.vibrate) navigator.vibrate(80);

  const raw = result.codeResult.code;
  handleISBN(raw);
}

/* ===================== BOOK FLOW ===================== */
function normalizeIsbn(raw) {
  return raw.replace(/[^0-9X]/gi, "");
}

async function lookupGoogleBooks(isbn) {
  if (!GOOGLE_BOOKS_API_KEY || GOOGLE_BOOKS_API_KEY === "YOUR_KEY") return null;

  const url = `https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}&maxResults=1&key=${encodeURIComponent(
    GOOGLE_BOOKS_API_KEY
  )}`;

  const r = await fetch(url);
  const j = await r.json();

  if (!j.items || !j.items.length) return null;

  const i = j.items[0].volumeInfo || {};
  return {
    title: i.title || null,
    author: i.authors?.join(", ") || null,
    image: i.imageLinks?.thumbnail || null,
  };
}

async function lookupOpenLibrary(isbn) {
  const url = `https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data&exact=true`;
  const r = await fetch(url);
  const j = await r.json();

  const b = j[`ISBN:${isbn}`];
  if (!b) return null;

  const title = b.title || null;
  const author = b.authors?.map(a => a.name).join(", ") || null;

  // cover
  let image = b.cover?.medium || b.cover?.large || b.cover?.small || null;
  if (image) image = image.replace("http://", "https://");
  const fallback = `https://covers.openlibrary.org/b/isbn/${isbn}-M.jpg`;

  // subjects (best source = work subjects)
  let rawSubjects = [];

  // sometimes api/books includes subjects directly
  if (Array.isArray(b.subjects) && b.subjects.length) {
    rawSubjects = b.subjects.map(s => (typeof s === "string" ? s : s?.name)).filter(Boolean);
  }

  // better: fetch work subjects
  try {
    const workKey = b.works?.[0]?.key; // e.g. "/works/OL123W"
    if (workKey) {
      const wr = await fetch(`https://openlibrary.org${workKey}.json`);
      const wj = await wr.json();
      if (Array.isArray(wj.subjects) && wj.subjects.length) {
        rawSubjects = wj.subjects;
      }
    }
  } catch {}

  const category = normaliseCategory(rawSubjects);

  return {
    title,
    author,
    image: image || fallback,
    category,
  };
}



async function handleISBN(raw) {
  const isbn = normalizeIsbn(raw);

  if (!isValidISBN(isbn)) {
    showToast("Not a valid book ISBN", "#dc3545");
    showView("view-home");
    return;
  }

  showToast("Searching...", "#6c5ce7");

  try {
    // OpenLibrary first (category-aware), then Google fallback
    let meta = await lookupOpenLibrary(isbn);
    if (!meta) meta = await lookupGoogleBooks(isbn);
    if (!meta) throw new Error("Not found");

    const title = meta.title || "Unknown";
    const author = meta.author || "Unknown";
    const image = (meta.image || `https://covers.openlibrary.org/b/isbn/${isbn}-M.jpg`)
      .replace("http://", "https://");

    const category = meta.category || "General & Other";

    const isRead = await askReadStatus(title);

    const book = { isbn, title, author, image, category, isRead };

    // upsert locally
    myLibrary = myLibrary.filter(b => b.isbn !== isbn);
    myLibrary.push(book);

    saveLibrary();

    // IMPORTANT: update filter dropdown + render via filters
    populateCategoryFilter();
    applyFilters();

    cloudSync("add", book); // your GAS may return "Exists", but local will still be fine
    showView("view-library");
  } catch (e) {
    console.error("Lookup failed:", e);
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
      myLibrary = data.map((b) => {
        const isbn = (b.isbn || "").toString().trim();

        const img =
          (b.image || "").toString().replace("http://", "https://") ||
          (isbn
            ? `https://covers.openlibrary.org/b/isbn/${isbn}-M.jpg`
            : "https://via.placeholder.com/50x75?text=No+Cover");

        // 👇 IMPORTANT: keep category from sheet
        const category = (b.category || "").toString().trim() || "General & Other";

        return {
          isbn,
          title: b.title || "Unknown",
          author: b.author || "Unknown",
          image: img,
          category,
          isRead: !!b.isRead,
        };
      });

      saveLibrary();
      populateCategoryFilter();
      applyFilters(); // renders via renderLibrary(filtered)
      showToast("Sync OK", "#28a745");
      return;
    }

    showToast("No data returned", "#dc3545");
  } catch (e) {
    console.error(e);
    showToast("Offline Mode", "#6c757d");
    // still show local library
    populateCategoryFilter();
    applyFilters();
  }
}


function cloudSync(action, book) {
  fetch(GOOGLE_SHEET_URL, {
    method: "POST",
    body: JSON.stringify({ action, data: book }),
  }).catch(() => {});
}

/* ===================== UI ===================== */
function askReadStatus(title) {
  return new Promise((res) => {
    const m = document.getElementById("read-modal");
    document.getElementById("modal-title").textContent = title;
    m.style.display = "flex";
    document.getElementById("btn-read-yes").onclick = () => {
      m.style.display = "none";
      res(true);
    };
    document.getElementById("btn-read-no").onclick = () => {
      m.style.display = "none";
      res(false);
    };
  });
}

function renderLibrary(list = myLibrary) {
  const ul = document.getElementById("book-list");
  ul.innerHTML = "";

  list.forEach((b) => {
    const li = document.createElement("li");
    li.className = "book-item";

    const img = document.createElement("img");
    img.src = b.image;
    img.alt = b.title || "Book cover";
    img.loading = "lazy";
    img.onerror = () => {
      if (b.isbn) img.src = `https://covers.openlibrary.org/b/isbn/${b.isbn}-M.jpg`;
    };

    const info = document.createElement("div");
    info.className = "book-info";

    const title = document.createElement("strong");
    title.textContent = b.title || "Unknown title";

    const author = document.createElement("div");
    author.style.fontSize = ".85rem";
    author.style.opacity = ".7";
    author.textContent = b.author || "";

    const category = document.createElement("div");
    category.style.fontSize = ".7rem";
    category.style.opacity = ".55";
    category.textContent = "📚 " + (b.category || "Uncategorised");

    const flag = document.createElement("span");
    flag.className = `status-flag ${b.isRead ? "read" : "unread"}`;
    flag.textContent = b.isRead ? "✅ Read" : "📖 Unread";
    flag.onclick = () => toggleRead(b.isbn);

    const del = document.createElement("button");
    del.className = "delete-btn";
    del.textContent = "🗑️";
    del.onclick = () => deleteBook(b.isbn);

    info.append(title, author, category, flag);
    li.append(img, info, del);
    ul.appendChild(li);
  });
}


function toggleRead(isbn) {
  const b = myLibrary.find((x) => x.isbn === isbn);
  if (!b) return;
  b.isRead = !b.isRead;
  saveLibrary();
  renderLibrary();
  cloudSync("update", b);
}

function deleteBook(isbn) {
  if (!confirm("Delete?")) return;
  const b = myLibrary.find((x) => x.isbn === isbn);
  myLibrary = myLibrary.filter((x) => x.isbn !== isbn);
  saveLibrary();
  renderLibrary();
  if (b) cloudSync("delete", b);
  else cloudSync("delete", { isbn });
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
      const c = isbn[i] === "X" ? 10 : parseInt(isbn[i], 10);
      if (Number.isNaN(c)) return false;
      sum += c * (10 - i);
    }
    return sum % 11 === 0;
  }

  if (isbn.length === 13) {
    // Must be digits only
    if (!/^\d{13}$/.test(isbn)) return false;

    let sum = 0;
    for (let i = 0; i < 13; i++) {
      const n = parseInt(isbn[i], 10);
      sum += n * (i % 2 === 0 ? 1 : 3);
    }
    return sum % 10 === 0;
  }

  return false;
}

function applyFilters() {
  const q = document.getElementById("searchBox").value.toLowerCase();
  const readFilter = document.getElementById("filterRead").value;
  const catFilter = document.getElementById("filterCategory").value;
  const sort = document.getElementById("sortBy").value;

  let books = [...myLibrary];

  // SEARCH
  if (q) {
    books = books.filter(b =>
      (b.title || "").toLowerCase().includes(q) ||
      (b.author || "").toLowerCase().includes(q) ||
      (b.category || "").toLowerCase().includes(q) ||
      (b.isbn || "").includes(q)
    );
  }

  // READ FILTER
  if (readFilter === "read") books = books.filter(b => b.isRead);
  if (readFilter === "unread") books = books.filter(b => !b.isRead);

  // CATEGORY FILTER
  if (catFilter !== "all") books = books.filter(b => b.category === catFilter);

  // SORT
  books.sort((a, b) =>
    (a[sort] || "").toString().localeCompare((b[sort] || "").toString())
  );

  renderLibrary(books);
  updateHomeStats();
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

  populateCategoryFilter();
  applyFilters();
  showView("view-home");
};


function updateHomeStats() {
  const total = myLibrary.length;
  const read = myLibrary.filter(b => b.isRead).length;
  document.getElementById("stat-count").textContent = total;
  document.getElementById("stat-read").textContent = read;
  document.getElementById("stat-unread").textContent = total - read;
}

function normaliseCategory(subjects = []) {
  const s = subjects.map(x => x.toLowerCase());

  if (s.some(x => /mystery|detective|crime|thriller|suspense|private investigator|missing persons|murder/.test(x)))
    return "Mystery & Thriller";

  if (s.some(x => /fantasy|quests|elder wand|mutants/.test(x)))
    return "Fantasy";

  if (s.some(x => /science fiction|sci-fi|alien/.test(x)))
    return "Science Fiction";

  if (s.some(x => /mythology/.test(x)))
    return "Mythology";

  if (s.some(x => /history|historical|roman|romans|england|great britain|asia/.test(x)))
    return "History & Historical Fiction";

  if (s.some(x => /literary|english literature|american literature|classic|fiction/.test(x)))
    return "Literary Fiction";

  if (s.some(x => /romance|love poetry|mothers and daughters/.test(x)))
    return "Romance & Relationships";

  if (s.some(x => /biography|authors|autobiography|biographical fiction/.test(x)))
    return "Biography & Memoir";

  if (s.some(x => /psychology|social|abuse|famil|brothers|society/.test(x)))
    return "Psychology & Society";

  if (s.some(x => /business|economics|leadership|management|corporation|strategy/.test(x)))
    return "Business & Economics";

  if (s.some(x => /self-help|critical thinking|contentment|life change|quality of work life/.test(x)))
    return "Self-Help & Mindfulness";

  if (s.some(x => /children|juvenile|young adult|school/.test(x)))
    return "Children & Young Adult";

  if (s.some(x => /poetry|poems/.test(x)))
    return "Poetry";

  if (s.some(x => /religion|hindu|jewish/.test(x)))
    return "Religion & Spirituality";

  if (s.some(x => /technology|engineering|science/.test(x)))
    return "Technology & Science";

  if (s.some(x => /comic|graphic|astérix|tintin|art|music|humou?r|puzzle/.test(x)))
    return "Comics, Art & Humor";

  if (s.some(x => /travel/.test(x)))
    return "Travel & Adventure";

  if (s.some(x => /language|grammar|translation|education|school/.test(x)))
    return "Education & Language";

  if (s.some(x => /short stories/.test(x)))
    return "Short Stories";

  return "General & Other";
}

function populateCategoryFilter() {
  const select = document.getElementById("filterCategory");
  if (!select) return;

  const cats = [...new Set(myLibrary.map(b => b.category).filter(Boolean))].sort();
  select.innerHTML = `<option value="all">All categories</option>` +
    cats.map(c => `<option value="${c}">${c}</option>`).join("");
}
