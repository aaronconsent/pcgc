/* Polk County Golf Carts — rental flow controller.
 *
 * Single-page, four-step wizard backed by sessionStorage. Carts FIRST
 * (AirBnB-style browse), then dates, contact, payment. Posts the
 * final booking to /api/booking (handled by src/worker.js). All
 * pricing math lives in computePrice(); change the rules there.
 *
 * Inventory: 4 × 4-seater carts @ $75/day + 1 × 6-seater Limo
 * @ $125/day. Free pickup & delivery within 25 miles of Livingston;
 * extended delivery (25–100 mi) is an extra charge quoted separately
 * by PCGC (not auto-billed in checkout).
 *
 * The four 4-seaters re-use two source photos (a + b) — the carts
 * are similar enough that not every one needs a unique shot.
 */

// Fleet — matches the physical inventory numbered by John. Cart #2 is
// the Limo; #3-#6 are the four Yamahas. Make/model/serial are shown on
// the /rentals/ Step 2 tile and on the /agreement/ page so the rental
// agreement always identifies the exact cart(s) leaving the lot.
const CARTS = [
  { id: "cart-2", cartNo: 2, name: "Cart #2 — The Limo", seats: 6, price: 125,
    make: "Club Car Limo", modelDetails: "Gas · White", serial: "LG9939-808771",
    img: "/assets/photos/rentals/limo.jpg", desc: "6-seater Limo. Three rows of seating for the whole crew." },
  { id: "cart-3", cartNo: 3, name: "Cart #3", seats: 4, price: 75,
    make: "Yamaha", modelDetails: "Gas · Tan", serial: "J0B-001578",
    img: "/assets/photos/rentals/4-seater-a.jpg", desc: "4-seater golf cart with rear flip seat." },
  { id: "cart-4", cartNo: 4, name: "Cart #4", seats: 4, price: 75,
    make: "Yamaha", modelDetails: "Gas · Tan", serial: "J0B-105687",
    img: "/assets/photos/rentals/4-seater-b.jpg", desc: "4-seater golf cart with rear flip seat." },
  { id: "cart-5", cartNo: 5, name: "Cart #5", seats: 4, price: 75,
    make: "Yamaha", modelDetails: "Gas · Tan", serial: "J0B-105659",
    img: "/assets/photos/rentals/4-seater-a.jpg", desc: "4-seater golf cart with rear flip seat." },
  { id: "cart-6", cartNo: 6, name: "Cart #6", seats: 4, price: 75,
    make: "Yamaha", modelDetails: "Gas · Grey", serial: "J0K-203736",
    img: "/assets/photos/rentals/4-seater-b.jpg", desc: "4-seater golf cart with rear flip seat." },
];

// One copy of each cart exists in the fleet — a renter can pick up to
// 1 of each. (Total fleet = 6.)
const PER_CART_MAX_QTY = 1;
const MAX_CARTS = CARTS.length;
// Extended delivery (25-100 mi) is billed separately by PCGC — we don't
// auto-charge a number that contradicts the "extra charge" label.
const DELIVERY_EXTENDED_FEE = 0;
const TAX_RATE = 0.0825;

// ---------- Clover Ecommerce SDK (embedded card entry) ----------
// clover holds the initialized SDK instance once /api/config confirms
// public-key + merchant-id are configured. cloverElements holds the
// mounted iframe field references we call .createToken() on.
let clover = null;
let cloverElements = null;
let cloverConfigured = false;

async function initCloverIfConfigured() {
  if (cloverConfigured) return;
  let cfg;
  try {
    const res = await fetch("/api/config");
    if (!res.ok) return;
    cfg = await res.json();
  } catch (_) { return; }
  if (!cfg?.clover?.publicKey || !cfg?.clover?.merchantId) return;

  // Load the Clover.js SDK. Sandbox and production have different
  // hosts; both expose the same window.Clover constructor.
  const sdkSrc = cfg.clover.environment === "production"
    ? "https://checkout.clover.com/sdk.js"
    : "https://checkout.sandbox.dev.clover.com/sdk.js";
  await loadScript(sdkSrc);
  if (!window.Clover) return;

  // eslint-disable-next-line no-undef
  clover = new Clover(cfg.clover.publicKey, { merchantId: cfg.clover.merchantId });
  cloverElements = clover.elements();

  const styles = {
    body:  { fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif", color: "#333" },
    input: { fontSize: "16px", color: "#333" },
    ".invalid": { color: "#c2261a" },
    ".focus":   { color: "#1f5a68" },
  };
  const number = cloverElements.create("CARD_NUMBER", { styles });
  const date   = cloverElements.create("CARD_DATE",   { styles });
  const cvv    = cloverElements.create("CARD_CVV",    { styles });
  const postal = cloverElements.create("CARD_POSTAL_CODE", { styles });
  number.mount("#card-number");
  date.mount("#card-date");
  cvv.mount("#card-cvv");
  postal.mount("#card-postal");

  // Reveal the payment fieldset + flip the CTA to "Pay $X now".
  const fs = document.getElementById("card-fieldset");
  if (fs) fs.hidden = false;
  const btn = document.getElementById("pay-now");
  if (btn) {
    const p = computePrice();
    btn.textContent = `Pay ${fmtMoney(p.grand)} now`;
  }
  cloverConfigured = true;
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    // De-dupe: don't re-add the SDK if it's already on the page.
    if ([...document.scripts].some(s => s.src === src)) return resolve();
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Failed to load " + src));
    document.head.appendChild(s);
  });
}

// ---------- State ----------
// Bumped to v5 for the address-split schema change (street/city/state/
// zip are now separate fields; the old `address` slot is repurposed as
// the delivery drop-off location). v4 sessions get a clean slate.
const STORAGE_KEY = "pcgc.rental.v6";
const state = loadState() || {
  step: 1,
  dates: { start: "", end: "" },
  selection: {},          // { cartId: qty }
  bookedIds: [],          // cart ids unavailable for the selected dates
  availabilityOk: true,   // false if /api/availability errored
  delivery: "pickup",
  contact: {
    name: "", email: "", phone: "", guests: 2,
    street: "", city: "", state: "", zip: "",
    address: "",  // delivery drop-off (only used when delivery != "pickup")
    notes: "",
  },
};

function saveState() {
  try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (_) {}
}
function loadState() {
  try { return JSON.parse(sessionStorage.getItem(STORAGE_KEY)); } catch (_) { return null; }
}

// ---------- Helpers ----------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

function fmtMoney(n) { return "$" + n.toFixed(2); }
function fmtMoneyShort(n) {
  // Drop trailing .00 for clean per-day display ($75 not $75.00)
  return "$" + n.toFixed(2).replace(/\.00$/, "");
}

function daysBetween(a, b) {
  if (!a || !b) return 0;
  const start = new Date(a + "T00:00:00");
  const end = new Date(b + "T00:00:00");
  return Math.max(0, Math.round((end - start) / 86400000));
}

// US federal + observable holidays that trigger the 2-day minimum.
// Kept as MM-DD strings so any year matches without maintenance for
// fixed-date holidays. Floating holidays (Memorial Day, Thanksgiving)
// are handled below in the "special weeks" check.
const HOLIDAYS_FIXED = new Set([
  "01-01", // New Year's Day
  "07-03", "07-04", "07-05", // July 4th window
  "12-24", "12-25", "12-26", // Christmas window
  "12-31", // New Year's Eve
]);

function isHoliday(date) {
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  if (HOLIDAYS_FIXED.has(`${mm}-${dd}`)) return true;
  // Memorial Day: last Monday of May
  if (date.getMonth() === 4 && date.getDay() === 1 && date.getDate() >= 25) return true;
  // Labor Day: first Monday of September
  if (date.getMonth() === 8 && date.getDay() === 1 && date.getDate() <= 7) return true;
  // Thanksgiving + Black Friday: 4th Thursday of Nov and the Friday after
  if (date.getMonth() === 10) {
    if (date.getDay() === 4 && date.getDate() >= 22 && date.getDate() <= 28) return true;
    if (date.getDay() === 5 && date.getDate() >= 23 && date.getDate() <= 29) return true;
  }
  return false;
}

// Walks the date range inclusively and returns true if ANY day falls on
// Saturday, Sunday, or a recognized holiday.
function rangeHitsWeekendOrHoliday(startIso, endIso) {
  const start = new Date(startIso + "T00:00:00");
  const end = new Date(endIso + "T00:00:00");
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dow = d.getDay();
    if (dow === 0 || dow === 6) return true;
    if (isHoliday(d)) return true;
  }
  return false;
}

function totalCarts() {
  return Object.values(state.selection).reduce((s, n) => s + (n | 0), 0);
}

function perDayCarts() {
  // Sum of (per-day price × qty) — independent of trip length.
  let sum = 0;
  for (const cart of CARTS) {
    const qty = state.selection[cart.id] | 0;
    if (qty > 0) sum += cart.price * qty;
  }
  return sum;
}

function computePrice() {
  const days = daysBetween(state.dates.start, state.dates.end);
  const perDay = perDayCarts();
  const subtotal = perDay * Math.max(0, days);
  const deliveryFee = state.delivery === "extended" ? DELIVERY_EXTENDED_FEE : 0;
  const afterDelivery = subtotal + deliveryFee;
  const tax = afterDelivery * TAX_RATE;
  const grand = afterDelivery + tax;
  return { days, perDay, subtotal, deliveryFee, tax, grand, total: totalCarts() };
}

// ---------- Step navigation ----------
function goTo(step) {
  state.step = step;
  saveState();
  $$(".rental-step").forEach(el => {
    el.hidden = (Number(el.dataset.step) !== step);
  });
  $$(".rental-progress li").forEach(li => {
    const n = Number(li.dataset.step);
    li.classList.toggle("active", n === step);
    li.classList.toggle("done", n < step);
  });
  window.scrollTo({ top: 0, behavior: "smooth" });

  if (step === 1) syncDatesStep();
  if (step === 2) renderCartGrid();
  if (step === 4) renderPaymentSummary();
  if (step === 5) renderConfirmation();
}

// ---------- Step 2: Carts (filtered by availability) ----------
function renderCartGrid() {
  const grid = $("#cart-grid");
  const allBooked = $("#all-booked");
  const availLine = $("#cart-availability-line");
  const warn = $("#availability-warning");
  grid.innerHTML = "";

  const booked = new Set(state.bookedIds || []);
  const availableCount = CARTS.filter(c => !booked.has(c.id)).length;

  // Empty state when literally nothing is left for those dates.
  if (availableCount === 0) {
    grid.hidden = true;
    allBooked.hidden = false;
    $("#rental-total").hidden = true;
  } else {
    grid.hidden = false;
    allBooked.hidden = true;
  }

  // Availability headline with the actual count.
  if (state.dates.start && state.dates.end) {
    const start = fmtDate(state.dates.start);
    const end = fmtDate(state.dates.end);
    availLine.innerHTML = `<b>${availableCount} of ${CARTS.length} carts</b> available ${start} → ${end}. 4-seaters $75/day, Limo $125/day.`;
  }
  warn.hidden = state.availabilityOk !== false;

  for (const cart of CARTS) {
    const qty = state.selection[cart.id] | 0;
    const isBooked = booked.has(cart.id);
    const tile = document.createElement("article");
    tile.className = "cart-tile" + (qty > 0 ? " selected" : "") + (isBooked ? " booked" : "");
    tile.innerHTML = `
      <img src="${cart.img}" alt="${cart.name}" loading="lazy">
      ${isBooked ? '<div class="cart-booked-overlay">Booked for these dates</div>' : ''}
      <div class="cart-tile-body">
        <h3>${cart.name}</h3>
        <div class="badges">
          <span class="badge">${cart.seats}-seater</span>
          <span class="badge">${cart.make}</span>
          <span class="badge cart-serial" title="Serial number">${cart.serial}</span>
        </div>
        <p class="desc">${cart.desc}</p>
        <div class="footer">
          <span class="price">${fmtMoneyShort(cart.price)}<small> / day</small></span>
          <div class="stepper" data-id="${cart.id}">
            <button type="button" data-act="dec" aria-label="Remove" ${qty === 0 || isBooked ? "disabled" : ""}>−</button>
            <b>${qty}</b>
            <button type="button" data-act="inc" aria-label="Add" ${qty >= PER_CART_MAX_QTY || isBooked ? "disabled" : ""}>+</button>
          </div>
        </div>
      </div>
    `;
    grid.appendChild(tile);
  }
  grid.addEventListener("click", onStepperClick);
  updateTotalBar();
}

function onStepperClick(ev) {
  const btn = ev.target.closest("button[data-act]");
  if (!btn || btn.disabled) return;
  const stepperEl = btn.closest(".stepper");
  if (!stepperEl) return;
  const id = stepperEl.dataset.id;
  // Booked carts can't be added (also protected by disabled, but
  // belt-and-suspenders against rapid clicks during re-renders).
  if ((state.bookedIds || []).includes(id)) return;
  const current = state.selection[id] | 0;
  let next = current;
  if (btn.dataset.act === "inc") {
    if (current >= PER_CART_MAX_QTY) return;
    next = current + 1;
  } else {
    next = Math.max(0, current - 1);
  }
  if (next === 0) delete state.selection[id];
  else state.selection[id] = next;
  saveState();
  renderCartGrid();
}

function updateTotalBar() {
  const bar = $("#rental-total");
  const total = totalCarts();
  if (total === 0) { bar.hidden = true; return; }
  bar.hidden = false;
  const days = daysBetween(state.dates.start, state.dates.end);
  const perDay = perDayCarts();
  $("#total-count").textContent = total;
  $("#total-count-s").textContent = total === 1 ? "" : "s";
  // We have dates by the time we hit step 2 — show the trip total.
  if (days > 0) {
    $("#total-amount").textContent = `${fmtMoney(perDay * days)} (${days} day${days === 1 ? "" : "s"})`;
  } else {
    $("#total-amount").textContent = `${fmtMoneyShort(perDay)} / day`;
  }
  $("#to-step-3").disabled = total === 0;
}

// Fetch which cart IDs are booked for the selected dates. Fail-open:
// any error → empty array + availabilityOk:false so the UI shows a
// "couldn't verify" notice but doesn't block bookings.
async function fetchAvailability() {
  if (!state.dates.start || !state.dates.end) return { booked: [], ok: true };
  try {
    const url = `/api/availability?start=${state.dates.start}&end=${state.dates.end}`;
    const res = await fetch(url);
    if (!res.ok) return { booked: [], ok: false };
    const data = await res.json();
    return { booked: data.booked || [], ok: true };
  } catch (e) {
    return { booked: [], ok: false };
  }
}

function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

// ---------- Step 1: Dates ----------
function syncDatesStep() {
  const start = $("#date-start");
  const end = $("#date-end");
  const today = new Date().toISOString().slice(0, 10);
  start.min = today;
  end.min = today;
  if (state.dates.start) start.value = state.dates.start;
  if (state.dates.end) end.value = state.dates.end;
  updateDurationLine();
}

function updateDurationLine() {
  const start = $("#date-start").value;
  const end = $("#date-end").value;
  state.dates.start = start;
  state.dates.end = end;
  const d = daysBetween(start, end);
  const out = $("#duration-out");
  if (start && end && d > 0) {
    const perDay = perDayCarts();
    out.textContent = `${d} day${d === 1 ? "" : "s"} × ${fmtMoneyShort(perDay)}/day = ${fmtMoney(perDay * d)} before tax & delivery.`;
  } else if (start && end) {
    out.textContent = "Return date must be after pickup date.";
  } else {
    out.textContent = "";
  }
  saveState();
}

function initStep1() {
  // Once-per-session flow-start ping so the analytics dashboard has
  // a denominator for the booking-submission conversion rate.
  try {
    if (!sessionStorage.getItem("pcgc.rental.flow_started")) {
      sessionStorage.setItem("pcgc.rental.flow_started", "1");
      if (window.pcgcTrack) window.pcgcTrack("rental-flow-start");
    }
  } catch (_) {}

  const start = $("#date-start");
  const end = $("#date-end");
  const today = new Date().toISOString().slice(0, 10);
  start.addEventListener("input", () => {
    end.min = start.value || today;
    if (end.value && end.value < start.value) end.value = "";
    updateDurationLine();
  });
  end.addEventListener("input", updateDurationLine);

  $("#to-step-2").addEventListener("click", async () => {
    const errEl = $("#date-error");
    errEl.hidden = true;
    if (!state.dates.start || !state.dates.end) {
      errEl.textContent = "Pick both a pickup date and a return date.";
      errEl.hidden = false;
      return;
    }
    const days = daysBetween(state.dates.start, state.dates.end);
    if (days < 1) {
      errEl.textContent = "Return date must be at least one day after pickup.";
      errEl.hidden = false;
      return;
    }
    // Weekend/holiday rentals need a 2-day minimum. Weekend = any day
    // in the rental range that falls on Saturday or Sunday; holidays
    // reuse the same rule via a US federal + Texas-notable holiday
    // list defined below.
    if (rangeHitsWeekendOrHoliday(state.dates.start, state.dates.end) && days < 2) {
      errEl.textContent = "Weekend and holiday rentals require a 2-day minimum.";
      errEl.hidden = false;
      return;
    }
    // Block the button while we check availability so a double-click
    // doesn't double-fetch and double-advance.
    const btn = $("#to-step-2");
    const prev = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Checking availability…";
    const { booked, ok } = await fetchAvailability();
    state.bookedIds = booked;
    state.availabilityOk = ok;
    // Drop any selected cart that is now booked (handles the case
    // where the user came back, changed dates, and a cart they had
    // selected is no longer available for the new range).
    for (const id of booked) delete state.selection[id];
    saveState();
    btn.disabled = false;
    btn.textContent = prev;
    goTo(2);
  });
}

// Step 2 has its own "Continue → step 3" button inside the floating
// total bar. Wire it once at boot so the carts step can advance.
function initStep2Continue() {
  $("#to-step-3").addEventListener("click", () => {
    if (totalCarts() === 0) return;
    goTo(3);
  });
}

// ---------- Step 3: Details ----------
function initStep3() {
  $$('input[name="delivery"]').forEach(r => {
    r.checked = r.value === state.delivery;
    r.addEventListener("change", () => {
      state.delivery = r.value;
      $("#address-field").hidden = (state.delivery === "pickup");
      saveState();
    });
  });
  $("#address-field").hidden = (state.delivery === "pickup");

  const fields = {
    "contact-name":    "name",
    "contact-phone":   "phone",
    "contact-email":   "email",
    "contact-guests":  "guests",
    "contact-street":  "street",
    "contact-city":    "city",
    "contact-state":   "state",
    "contact-zip":     "zip",
    "contact-address": "address",
    "contact-notes":   "notes",
  };
  for (const [id, key] of Object.entries(fields)) {
    const el = $("#" + id);
    if (!el) continue;
    if (state.contact[key]) el.value = state.contact[key];
    el.addEventListener("input", () => {
      state.contact[key] = el.value;
      saveState();
    });
  }

  $("#to-step-4").addEventListener("click", () => {
    const err = $("#details-error");
    err.hidden = true;
    const c = state.contact;
    if (!c.name || !c.email || !c.phone) {
      err.textContent = "Name, email, and phone are required.";
      err.hidden = false;
      return;
    }
    if (!/^\S+@\S+\.\S+$/.test(c.email)) {
      err.textContent = "That email doesn't look right.";
      err.hidden = false;
      return;
    }
    if (!c.street.trim() || !c.city.trim() || !c.state.trim() || !c.zip.trim()) {
      err.textContent = "Please fill in your full address (street, city, state, ZIP).";
      err.hidden = false;
      return;
    }
    if (!/^\d{5}(-\d{4})?$/.test(c.zip.trim())) {
      err.textContent = "ZIP should be 5 digits (or 5+4).";
      err.hidden = false;
      return;
    }
    if (state.delivery !== "pickup" && !c.address.trim()) {
      err.textContent = "Add the delivery drop-off location.";
      err.hidden = false;
      return;
    }
    if (Number(c.guests) < 1) {
      err.textContent = "Number of guests must be at least 1.";
      err.hidden = false;
      return;
    }
    goTo(4);
  });
}

// ---------- Step 4: Review & submit ----------
function renderPaymentSummary() {
  const out = $("#rental-summary");
  const p = computePrice();
  const lines = [];
  for (const cart of CARTS) {
    const qty = state.selection[cart.id] | 0;
    if (!qty) continue;
    const lineTotal = cart.price * qty * p.days;
    lines.push(`<div class="row"><span>${cart.name} × ${qty} · ${p.days} day${p.days === 1 ? "" : "s"}</span><span>${fmtMoney(lineTotal)}</span></div>`);
  }
  lines.push(`<div class="row"><span>Subtotal</span><span>${fmtMoney(p.subtotal)}</span></div>`);
  if (state.delivery === "extended") {
    lines.push(`<div class="row muted"><span>Extended delivery (25–100 mi)</span><span>Quoted separately</span></div>`);
  }
  lines.push(`<div class="row"><span>Tax (${(TAX_RATE * 100).toFixed(2)}%)</span><span>${fmtMoney(p.tax)}</span></div>`);
  lines.push(`<div class="row total"><span>Total</span><span>${fmtMoney(p.grand)}</span></div>`);
  out.innerHTML = lines.join("");

  // Deposit note appears only when the pickup date is 3+ months out.
  const depositNote = $("#deposit-note");
  depositNote.hidden = !bookingIsFarOut();

  // Requirements text — pickup needs DL + insurance + plate photo;
  // delivery only needs the driver's license. Copy matches the owner's
  // docx: everything goes to us via text at time of payment.
  const isPickup = state.delivery === "pickup";
  const reqs = isPickup
    ? [
        "Driver's license (photo or scan) for everyone who will be driving the cart",
        "Auto insurance (photo or scan)",
        "Photo of your vehicle's license plate (the vehicle we'll be loading the cart onto)",
      ]
    : [
        "Driver's license (photo or scan) for everyone who will be driving the cart",
      ];
  $("#review-requirements").innerHTML = reqs.map(r => `<li>${r}</li>`).join("");
}

// True when the pickup date is 3+ months (~90 days) after today. Owner's
// docx: 50% deposit required to book that far out.
function bookingIsFarOut() {
  if (!state.dates.start) return false;
  const start = new Date(state.dates.start + "T00:00:00");
  const now = new Date();
  const diffDays = (start - now) / 86400000;
  return diffDays >= 90;
}

function initStep4() {
  $("#pay-now").addEventListener("click", submitBooking);
  // Kick off the Clover SDK init in the background — if configured,
  // the card fields mount and the CTA flips to "Pay $X now". If not,
  // this is a silent no-op and the CTA stays as "Submit booking
  // request" (owner takes payment offline).
  initCloverIfConfigured();
  // Inline rental-agreement pieces (fleet grid, DL upload, signature).
  initAgreementUi();
}

// ---------- Inline rental agreement (moved from /agreement/ page) ----------
// State captured from the agreement UI at submit time.
let agreementSignature = null;    // data URL of the drawn signature
let agreementDlImage = null;      // data URL of the uploaded DL photo (or null)
let sigCanvas, sigCtx, sigDrawn = false, sigDrawing = false;

function initAgreementUi() {
  renderAgreementFleet();

  // Signature canvas — same lightweight pad as /agreement/index.html.
  sigCanvas = $("#sig-canvas");
  if (!sigCanvas) return;
  sigCtx = sigCanvas.getContext("2d");
  resizeSigCanvas();
  window.addEventListener("resize", resizeSigCanvas);
  sigCanvas.addEventListener("mousedown", sigStart);
  sigCanvas.addEventListener("mousemove", sigMove);
  window.addEventListener("mouseup", sigEnd);
  sigCanvas.addEventListener("touchstart", sigStart, { passive: false });
  sigCanvas.addEventListener("touchmove", sigMove, { passive: false });
  sigCanvas.addEventListener("touchend", sigEnd);
  $("#sig-clear").addEventListener("click", () => {
    sigCtx.clearRect(0, 0, sigCanvas.width, sigCanvas.height);
    sigDrawn = false;
  });

  // DL delivery-method radios — show/hide the upload box.
  $$('input[name="dl-method"]').forEach(r => r.addEventListener("change", updateDlMethodUi));
  updateDlMethodUi();

  // DL upload — client-side resize + preview.
  $("#dl-file").addEventListener("change", handleDlFile);
}

function renderAgreementFleet() {
  const grid = $("#agreement-fleet-grid");
  if (!grid) return;
  const rented = new Set(Object.entries(state.selection || {}).filter(([, q]) => q > 0).map(([id]) => id));
  grid.innerHTML = CARTS.map(cart => `
    <div class="fleet-cart${rented.has(cart.id) ? ' rented' : ''}">
      <h5>${cart.name}</h5>
      <div class="meta">${cart.make} · ${cart.modelDetails || ''}<br>Serial <code>${cart.serial}</code></div>
    </div>
  `).join("");
}

function resizeSigCanvas() {
  const rect = sigCanvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const prev = document.createElement("canvas");
  prev.width = sigCanvas.width;
  prev.height = sigCanvas.height;
  prev.getContext("2d").drawImage(sigCanvas, 0, 0);
  sigCanvas.width = Math.floor(rect.width * dpr);
  sigCanvas.height = Math.floor(rect.height * dpr);
  sigCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  sigCtx.strokeStyle = "#1f5a68";
  sigCtx.lineWidth = 2.2;
  sigCtx.lineCap = "round";
  sigCtx.lineJoin = "round";
  if (sigDrawn) {
    sigCtx.save();
    sigCtx.setTransform(1, 0, 0, 1, 0, 0);
    sigCtx.drawImage(prev, 0, 0, sigCanvas.width, sigCanvas.height);
    sigCtx.restore();
  }
}
function sigPos(ev) {
  const rect = sigCanvas.getBoundingClientRect();
  const t = ev.touches ? ev.touches[0] : ev;
  return { x: t.clientX - rect.left, y: t.clientY - rect.top };
}
function sigStart(ev) {
  ev.preventDefault();
  sigDrawing = true;
  const p = sigPos(ev);
  sigCtx.beginPath();
  sigCtx.moveTo(p.x, p.y);
}
function sigMove(ev) {
  if (!sigDrawing) return;
  ev.preventDefault();
  const p = sigPos(ev);
  sigCtx.lineTo(p.x, p.y);
  sigCtx.stroke();
  sigDrawn = true;
}
function sigEnd() {
  if (!sigDrawing) return;
  sigDrawing = false;
  sigCtx.closePath();
}

function updateDlMethodUi() {
  const method = document.querySelector('input[name="dl-method"]:checked')?.value || "upload";
  const box = $("#dl-upload-box");
  if (!box) return;
  box.hidden = (method !== "upload");
  if (method !== "upload") {
    $("#dl-file").value = "";
    agreementDlImage = null;
    $("#dl-preview").hidden = true;
    $("#dl-preview").removeAttribute("src");
  }
}

async function handleDlFile() {
  const file = $("#dl-file").files && $("#dl-file").files[0];
  if (!file) { agreementDlImage = null; $("#dl-preview").hidden = true; return; }
  try {
    const url = await resizeImage(file, 1600, 0.72);
    agreementDlImage = url;
    $("#dl-preview").src = url;
    $("#dl-preview").hidden = false;
  } catch (_) {
    agreementDlImage = null;
    $("#dl-preview").hidden = true;
    alert("Could not process that image. Please try again or pick 'text a photo' instead.");
  }
}

function resizeImage(file, maxDim, quality) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("read"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("decode"));
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const c = document.createElement("canvas");
        c.width = w; c.height = h;
        c.getContext("2d").drawImage(img, 0, 0, w, h);
        resolve(c.toDataURL("image/jpeg", quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// Returns { ok: true, agreement } or { ok: false, msg }. Called from
// submitBooking() before we POST — surfaces inline errors on missing
// fields instead of round-tripping to the server.
function collectAgreement() {
  const dlNumber = $("#dl-number").value.trim();
  const dlState = $("#dl-state").value.trim();
  const typedName = $("#typed-name").value.trim();
  const agreed = $("#agreed").checked;
  const dlMethod = document.querySelector('input[name="dl-method"]:checked')?.value || "upload";

  if (!dlNumber || !dlState) return { ok: false, msg: "Please fill in your driver's license number and state." };
  if (!agreed) return { ok: false, msg: "Please check the box to agree to the rental agreement terms." };
  if (!sigDrawn) return { ok: false, msg: "Please draw your signature in the box." };
  if (!typedName) return { ok: false, msg: "Please type your full legal name below the signature." };
  if (dlMethod === "upload" && !agreementDlImage) {
    return { ok: false, msg: "Please attach your driver's license photo, or pick a different delivery option." };
  }
  return {
    ok: true,
    agreement: {
      typedName,
      dlNumber,
      dlState,
      dlMethod,
      dlImageDataUrl: dlMethod === "upload" ? agreementDlImage : null,
      signatureDataUrl: sigCanvas.toDataURL("image/png"),
      agreed: true,
    },
  };
}

async function submitBooking() {
  const err = $("#pay-error");
  const cardErr = $("#card-error");
  err.hidden = true;
  if (cardErr) cardErr.hidden = true;

  // Inline agreement validation runs FIRST — no point tokenizing a
  // card if the customer hasn't signed yet.
  const collected = collectAgreement();
  if (!collected.ok) {
    err.textContent = collected.msg;
    err.hidden = false;
    // Scroll the error into view — the agreement is above the CTA
    // and if the customer clicked Submit while its fields are off
    // screen they won't otherwise see the message.
    err.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }

  const btn = $("#pay-now");
  btn.disabled = true;
  const prevLabel = btn.textContent;

  // If Clover's mounted, tokenize the card BEFORE we submit. The
  // resulting source token goes into the booking POST; the Worker
  // uses it to charge and only saves the booking on charge success.
  let paymentSourceToken = null;
  if (cloverConfigured && clover) {
    btn.textContent = "Verifying card…";
    try {
      const result = await clover.createToken();
      if (result?.errors && Object.keys(result.errors).length) {
        const first = Object.values(result.errors)[0];
        if (cardErr) { cardErr.textContent = first || "Please check your card details."; cardErr.hidden = false; }
        else { err.textContent = first || "Please check your card details."; err.hidden = false; }
        btn.disabled = false;
        btn.textContent = prevLabel;
        return;
      }
      if (!result?.token) {
        err.textContent = "We couldn't verify the card. Please try again or call 936-223-1182.";
        err.hidden = false;
        btn.disabled = false;
        btn.textContent = prevLabel;
        return;
      }
      paymentSourceToken = result.token;
    } catch (e) {
      err.textContent = "Card verification failed: " + (e?.message || e);
      err.hidden = false;
      btn.disabled = false;
      btn.textContent = prevLabel;
      return;
    }
  }

  btn.textContent = paymentSourceToken ? "Charging card…" : "Submitting…";

  const booking = buildBookingRecord();
  if (paymentSourceToken) booking.paymentSourceToken = paymentSourceToken;
  // Attach the signed agreement to the booking POST so the Worker
  // stores it alongside the record. Nothing goes into KV without a
  // valid signature — the server also validates.
  booking.signedAgreement = collected.agreement;

  try {
    const res = await fetch("/api/booking", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(booking),
    });
    if (res.ok) {
      const body = await res.json();
      if (body.id) booking.id = body.id;
      // Stash the server-signed agreement URL so Step 5 can link to it.
      if (body.agreementPath) booking.agreementPath = body.agreementPath;
    } else {
      // 402 -> Clover declined the charge; the customer sees the
      // literal reason so they can try another card. Any other
      // failure is a generic retry prompt.
      let msg = "We couldn't reach our server. Please try again in a minute or call 936-223-1182.";
      try {
        const body = await res.json();
        if (res.status === 402) {
          msg = "Payment could not be completed" + (body.error ? `: ${body.error}` : "") + ". Please check your card details or try a different card. Call 936-223-1182 if you keep hitting this.";
        } else if (body.error) {
          msg = "Error: " + body.error;
        }
      } catch (_) {}
      err.textContent = msg;
      err.hidden = false;
      btn.disabled = false;
      btn.textContent = prevLabel;
      return;
    }
  } catch (_) {
    err.textContent = "Network error. Please try again or call 936-223-1182.";
    err.hidden = false;
    btn.disabled = false;
    btn.textContent = prevLabel;
    return;
  }

  state.bookingId = booking.id;
  state.bookingRecord = booking;
  saveState();
  if (window.pcgcTrack) window.pcgcTrack("booking-submitted");
  goTo(5);
}

function buildBookingRecord() {
  const p = computePrice();
  const items = CARTS
    .filter(c => state.selection[c.id])
    .map(c => ({
      id: c.id, name: c.name, qty: state.selection[c.id],
      pricePerDay: c.price,
      lineTotal: c.price * state.selection[c.id] * p.days,
    }));
  const localId = "PCGC-" + Math.random().toString(36).slice(2, 8).toUpperCase();
  return {
    id: localId,
    ts: new Date().toISOString(),
    dates: { ...state.dates, days: p.days },
    items,
    delivery: state.delivery,
    contact: { ...state.contact },
    pricing: {
      subtotal: p.subtotal,
      deliveryFee: p.deliveryFee,
      tax: p.tax,
      total: p.grand,
    },
  };
}

// ---------- Step 5: Confirmation ----------
function renderConfirmation() {
  const b = state.bookingRecord;
  if (!b) return;
  $("#booking-id").textContent = b.id;
  $("#confirm-email").textContent = b.contact.email || "your email";
  $("#confirm-phone").textContent = b.contact.phone || "your phone";
  const out = $("#confirm-summary");
  const lines = [];
  lines.push(`<div class="row"><span>Pickup</span><span>${fmtDate(b.dates.start)}</span></div>`);
  lines.push(`<div class="row"><span>Return</span><span>${fmtDate(b.dates.end)}</span></div>`);
  for (const it of b.items) {
    lines.push(`<div class="row"><span>${it.name} × ${it.qty}</span><span>${fmtMoney(it.lineTotal)}</span></div>`);
  }
  const deliveryLabel = {
    pickup: "Pickup at shop",
    local: "Free delivery (within 25 mi)",
    extended: "Extended delivery (25–100 mi)",
  }[b.delivery] || b.delivery;
  // For "extended" delivery the fee is quoted separately by PCGC; show
  // "Quoted separately" instead of $0 so the confirmation matches the
  // copy on step 3.
  const deliveryDisplay = b.delivery === "extended"
    ? "Quoted separately"
    : (b.pricing.deliveryFee ? fmtMoney(b.pricing.deliveryFee) : "Free");
  lines.push(`<div class="row"><span>${deliveryLabel}</span><span>${deliveryDisplay}</span></div>`);
  lines.push(`<div class="row total"><span>Total</span><span>${fmtMoney(b.pricing.total)}</span></div>`);
  out.innerHTML = lines.join("");

  // Per-delivery requirements. Owner's docx: everything goes to us by
  // text at time of payment. Pickup customers need DL + insurance +
  // plate photo; delivery only needs the driver's license of whoever
  // will drive.
  const isPickup = b.delivery === "pickup";
  $("#next-steps-title").textContent = "At time of payment — please text these to 936-223-1182";
  const requirements = isPickup
    ? [
        "Driver's license (photo or scan) for everyone who will be driving the cart",
        "Auto insurance (photo or scan)",
        "Photo of your vehicle's license plate (the vehicle we'll be loading the cart onto)",
      ]
    : [
        "Driver's license (photo or scan) for everyone who will be driving the cart",
      ];
  $("#requirements-list").innerHTML = requirements.map(r => `<li>${r}</li>`).join("");
  $("#docusign-email").textContent = b.contact.email || "your email";

  // Post-submit "Sign the agreement" CTA — the agreement is signed
  // inline on Step 4 now, so this becomes a "View your signed copy"
  // link instead of a call-to-action. Only surface when the Worker
  // returned an agreementPath (production only).
  const cta = document.getElementById("agreement-cta");
  const link = document.getElementById("agreement-link");
  if (b.agreementPath && cta && link) {
    link.href = b.agreementPath;
    link.textContent = "View your signed agreement →";
    const heading = cta.querySelector("h2");
    const body = cta.querySelector("p");
    if (heading) heading.textContent = "Your signed agreement";
    if (body) body.textContent = "A copy of the agreement you signed is available online — bookmark it or save it for your records.";
    cta.hidden = false;
  } else if (cta) {
    cta.hidden = true;
  }
}

// ---------- Boot ----------
document.addEventListener("DOMContentLoaded", () => {
  initStep1();         // dates (was initStep2)
  initStep2Continue(); // carts → details
  initStep3();
  initStep4();
  $("#back-to-1").addEventListener("click", () => goTo(1));
  $("#back-to-2").addEventListener("click", () => goTo(2));
  $("#back-to-3").addEventListener("click", () => goTo(3));
  // Restore previous step if user reloads mid-flow.
  goTo(state.step || 1);
});
