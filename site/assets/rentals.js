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

const CARTS = [
  { id: "cart-1", name: "Cart 1", seats: 4, price: 75,  img: "/assets/photos/rentals/4-seater-a.jpg", desc: "4-seater golf cart with rear flip seat." },
  { id: "cart-2", name: "Cart 2", seats: 4, price: 75,  img: "/assets/photos/rentals/4-seater-b.jpg", desc: "4-seater golf cart with rear flip seat." },
  { id: "cart-3", name: "Cart 3", seats: 4, price: 75,  img: "/assets/photos/rentals/4-seater-a.jpg", desc: "4-seater golf cart with rear flip seat." },
  { id: "cart-4", name: "Cart 4", seats: 4, price: 75,  img: "/assets/photos/rentals/4-seater-b.jpg", desc: "4-seater golf cart with rear flip seat." },
  { id: "cart-5", name: "Cart 5 — The Limo", seats: 6, price: 125, img: "/assets/photos/rentals/limo.jpg", desc: "6-seater Limo. Three rows of seating for the whole crew." },
];

// One copy of each cart exists in the fleet — a renter can pick up to
// 1 of each. (Total fleet = 6.)
const PER_CART_MAX_QTY = 1;
const MAX_CARTS = CARTS.length;
// Extended delivery (25-100 mi) is billed separately by PCGC — we don't
// auto-charge a number that contradicts the "extra charge" label.
const DELIVERY_EXTENDED_FEE = 0;
const TAX_RATE = 0.0825;

// ---------- State ----------
// Bumped to v2 because the schema changed (cart ids + prices). v1
// sessions get a clean slate so they don't see stale selections.
const STORAGE_KEY = "pcgc.rental.v4";
const state = loadState() || {
  step: 1,
  dates: { start: "", end: "" },
  selection: {},          // { cartId: qty }
  bookedIds: [],          // cart ids unavailable for the selected dates
  availabilityOk: true,   // false if /api/availability errored
  delivery: "pickup",
  contact: { name: "", email: "", phone: "", guests: 2, address: "", notes: "" },
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
    if (daysBetween(state.dates.start, state.dates.end) < 1) {
      errEl.textContent = "Return date must be at least one day after pickup.";
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
    "contact-name":   "name",
    "contact-phone":  "phone",
    "contact-email":  "email",
    "contact-guests": "guests",
    "contact-address":"address",
    "contact-notes":  "notes",
  };
  for (const [id, key] of Object.entries(fields)) {
    const el = $("#" + id);
    if (state.contact[key]) el.value = state.contact[key];
    el.addEventListener("input", () => {
      state.contact[key] = el.value;
      saveState();
    });
  }

  $("#to-step-4").addEventListener("click", () => {
    const err = $("#details-error");
    err.hidden = true;
    const { name, email, phone, guests, address } = state.contact;
    if (!name || !email || !phone) {
      err.textContent = "Name, email, and phone are required.";
      err.hidden = false;
      return;
    }
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      err.textContent = "That email doesn't look right.";
      err.hidden = false;
      return;
    }
    if (state.delivery !== "pickup" && !address.trim()) {
      err.textContent = "Add a delivery address.";
      err.hidden = false;
      return;
    }
    if (Number(guests) < 1) {
      err.textContent = "Number of guests must be at least 1.";
      err.hidden = false;
      return;
    }
    goTo(4);
  });
}

// ---------- Step 4: Payment ----------
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
  lines.push(`<div class="row total"><span>Total today</span><span>${fmtMoney(p.grand)}</span></div>`);
  out.innerHTML = lines.join("");
  $("#pay-amount").textContent = fmtMoney(p.grand);
}

function initStep4() {
  const card = $("#pay-card");
  card.addEventListener("input", () => {
    let v = card.value.replace(/\D/g, "").slice(0, 19);
    v = v.replace(/(.{4})/g, "$1 ").trim();
    card.value = v;
  });
  const exp = $("#pay-exp");
  exp.addEventListener("input", () => {
    let v = exp.value.replace(/\D/g, "").slice(0, 4);
    if (v.length >= 3) v = v.slice(0, 2) + "/" + v.slice(2);
    exp.value = v;
  });
  const cvc = $("#pay-cvc");
  cvc.addEventListener("input", () => {
    cvc.value = cvc.value.replace(/\D/g, "").slice(0, 4);
  });

  $("#pay-now").addEventListener("click", payNow);
}

async function payNow() {
  const err = $("#pay-error");
  err.hidden = true;
  const card = $("#pay-card").value.replace(/\s/g, "");
  const exp = $("#pay-exp").value;
  const cvc = $("#pay-cvc").value;
  const name = $("#pay-name").value.trim();
  const zip = $("#pay-zip").value.trim();
  if (card.length < 13 || !/^\d{2}\/\d{2}$/.test(exp) || cvc.length < 3 || !name || !zip) {
    err.textContent = "Please complete all card fields.";
    err.hidden = false;
    return;
  }

  const btn = $("#pay-now");
  btn.disabled = true;
  btn.textContent = "Processing…";

  const booking = buildBookingRecord();

  try {
    const res = await fetch("/api/booking", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(booking),
    });
    if (res.ok) {
      const body = await res.json();
      if (body.id) booking.id = body.id;
    }
  } catch (_) {}

  state.bookingId = booking.id;
  state.bookingRecord = booking;
  saveState();
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
  lines.push(`<div class="row total"><span>Total paid</span><span>${fmtMoney(b.pricing.total)}</span></div>`);
  out.innerHTML = lines.join("");

  // Per-delivery requirements list. Pickup customers need driver's
  // license, insurance, license plate photo + email for DocuSign.
  // Delivery customers only need the driver's license + email.
  const isPickup = b.delivery === "pickup";
  $("#next-steps-title").textContent = isPickup
    ? "Before pickup — what we'll need from you"
    : "Before delivery — what we'll need from you";
  const requirements = isPickup
    ? [
        "A photo or scan of your driver's license",
        "A photo or scan of your auto insurance",
        "A photo of your vehicle's license plate (the vehicle we'll be loading the cart onto)",
      ]
    : [
        "A photo or scan of the driver's license of whoever will be driving the cart",
      ];
  $("#requirements-list").innerHTML = requirements.map(r => `<li>${r}</li>`).join("");
  $("#docusign-email").textContent = b.contact.email || "your email";
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
