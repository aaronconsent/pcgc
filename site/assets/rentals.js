/* Polk County Golf Carts — rental flow controller.
 *
 * Single-page, four-step wizard backed by sessionStorage. Carts FIRST
 * (AirBnB-style browse), then dates, contact, payment. Posts the
 * final booking to /api/booking (handled by src/worker.js). All
 * pricing math lives in computePrice(); change the rules there.
 *
 * Inventory is the real PCGC rental fleet: 5 × 4-seater @ $75/day +
 * 1 × 6-seater Limo @ $125/day. Free pickup & delivery within 25
 * miles of Livingston; extended delivery (25–75 mi) flat $75.
 */

const CARTS = [
  { id: "yamaha-1", name: "Yamaha #1 — Charcoal",      seats: 4, price: 75,  img: "/assets/photos/rentals/cart-1-yamaha-dark.jpg",  desc: "Yamaha 4-seater with rear flip seat. Lakeside-ready." },
  { id: "yamaha-2", name: "Yamaha #2 — Sandstone",     seats: 4, price: 75,  img: "/assets/photos/rentals/cart-2-yamaha-tan.jpg",   desc: "Yamaha 4-seater, soft tan, classic cruise comfort." },
  { id: "club-car-3", name: "Club Car #3 — White",    seats: 4, price: 75,  img: "/assets/photos/rentals/cart-3-club-car-white.jpg", desc: "White Club Car 4-seater with rear flip seat. Off-road tires." },
  { id: "yamaha-4", name: "Yamaha #4",                 seats: 4, price: 75,  img: "/assets/photos/rentals/cart-4-placeholder.jpg",  desc: "Yamaha 4-seater. Photo coming — call to view." },
  { id: "yamaha-5", name: "Yamaha #5",                 seats: 4, price: 75,  img: "/assets/photos/rentals/cart-5-placeholder.jpg",  desc: "Yamaha 4-seater. Photo coming — call to view." },
  { id: "limo-6",   name: "The Limo — 6-Seater",       seats: 6, price: 125, img: "/assets/photos/rentals/limo-6-seater.jpg",       desc: "Club Car Limo. Six seats, the whole crew fits." },
];

// One copy of each cart exists in the fleet — a renter can pick up to
// 1 of each. (Total fleet = 6.)
const PER_CART_MAX_QTY = 1;
const MAX_CARTS = CARTS.length;
const DELIVERY_EXTENDED_FEE = 75;
const TAX_RATE = 0.0825;

// ---------- State ----------
// Bumped to v2 because the schema changed (cart ids + prices). v1
// sessions get a clean slate so they don't see stale selections.
const STORAGE_KEY = "pcgc.rental.v2";
const state = loadState() || {
  step: 1,
  dates: { start: "", end: "" },
  selection: {},          // { cartId: qty }
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

  if (step === 1) renderCartGrid();
  if (step === 2) syncDatesStep();
  if (step === 4) renderPaymentSummary();
  if (step === 5) renderConfirmation();
}

// ---------- Step 1: Carts (the new landing) ----------
function renderCartGrid() {
  const grid = $("#cart-grid");
  grid.innerHTML = "";
  for (const cart of CARTS) {
    const qty = state.selection[cart.id] | 0;
    const tile = document.createElement("article");
    tile.className = "cart-tile" + (qty > 0 ? " selected" : "");
    tile.innerHTML = `
      <img src="${cart.img}" alt="${cart.name}" loading="lazy">
      <div class="cart-tile-body">
        <h3>${cart.name}</h3>
        <div class="badges">
          <span class="badge">${cart.seats}-seater</span>
        </div>
        <p class="desc">${cart.desc}</p>
        <div class="footer">
          <span class="price">${fmtMoneyShort(cart.price)}<small> / day</small></span>
          <div class="stepper" data-id="${cart.id}">
            <button type="button" data-act="dec" aria-label="Remove" ${qty === 0 ? "disabled" : ""}>−</button>
            <b>${qty}</b>
            <button type="button" data-act="inc" aria-label="Add" ${qty >= PER_CART_MAX_QTY ? "disabled" : ""}>+</button>
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
  if (!btn) return;
  const stepperEl = btn.closest(".stepper");
  if (!stepperEl) return;
  const id = stepperEl.dataset.id;
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
  const perDay = perDayCarts();
  $("#total-count").textContent = total;
  $("#total-count-s").textContent = total === 1 ? "" : "s";
  // Step 1 shows per-day total ("$75 / day") until dates are picked
  // (which happens in step 2). Final total is shown in step 4 summary.
  $("#total-amount").textContent = fmtMoneyShort(perDay) + " / day";
  $("#to-step-2").disabled = total === 0;
}

function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

// ---------- Step 2: Dates ----------
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

function initStep2() {
  const start = $("#date-start");
  const end = $("#date-end");
  const today = new Date().toISOString().slice(0, 10);
  start.addEventListener("input", () => {
    end.min = start.value || today;
    if (end.value && end.value < start.value) end.value = "";
    updateDurationLine();
  });
  end.addEventListener("input", updateDurationLine);

  $("#to-step-3").addEventListener("click", () => {
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
  if (p.deliveryFee > 0) {
    lines.push(`<div class="row"><span>Extended delivery (25–75 mi)</span><span>${fmtMoney(p.deliveryFee)}</span></div>`);
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
    extended: "Extended delivery (25–75 mi)",
  }[b.delivery] || b.delivery;
  lines.push(`<div class="row"><span>${deliveryLabel}</span><span>${b.pricing.deliveryFee ? fmtMoney(b.pricing.deliveryFee) : "Free"}</span></div>`);
  lines.push(`<div class="row total"><span>Total paid</span><span>${fmtMoney(b.pricing.total)}</span></div>`);
  out.innerHTML = lines.join("");
}

// ---------- Boot ----------
document.addEventListener("DOMContentLoaded", () => {
  initStep2();
  initStep3();
  initStep4();
  $("#back-to-1").addEventListener("click", () => goTo(1));
  $("#back-to-2").addEventListener("click", () => goTo(2));
  $("#back-to-3").addEventListener("click", () => goTo(3));
  $("#to-step-2").addEventListener("click", () => {
    if (totalCarts() === 0) return;
    goTo(2);
  });
  // Restore previous step if user reloads mid-flow.
  goTo(state.step || 1);
});
