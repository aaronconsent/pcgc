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
  if (step === 4) {
    renderPaymentSummary();
    renderAgreementFleet();
    // Init or resize the signature pad now that Step 4 is visible.
    // signature_pad handles the DPI + pointer-event details; we just
    // need to make sure the canvas has real dimensions.
    initSignaturePad();
    resizeSigCanvas();
  }
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
  // Only surface the invalid-range warning on Step 1. Pricing math
  // used to live here too, but on Step 1 no carts are picked yet
  // (that happens Step 2) so it always read "$0/day = $0.00" —
  // pulled per owner request. Real pricing appears on Steps 2 + 4.
  if (start && end && d < 1) {
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

  // flatpickr gives us a consistent picker across desktop / tablet /
  // mobile. `disableMobile: true` forces flatpickr's own UI on mobile
  // too (default would fall back to native, which then looks different
  // from desktop). altInput swaps the visible field to a friendly
  // "Sat, Aug 15, 2026" string while keeping the underlying ISO
  // value the rest of the code reads via .value.
  function mountFlatpickr() {
    if (typeof flatpickr === "undefined") { setTimeout(mountFlatpickr, 100); return; }
    const startPicker = flatpickr(start, {
      minDate: "today",
      dateFormat: "Y-m-d",
      altInput: true,
      altFormat: "l, F j, Y",
      disableMobile: true,
      defaultDate: state.dates.start || null,
      onChange: (dates) => {
        const iso = dates[0] ? formatIso(dates[0]) : "";
        start.value = iso;
        // Keep the end picker's min in sync so nothing before the
        // new start is selectable.
        if (endPicker) endPicker.set("minDate", iso || "today");
        // Clear a stale end that's now before the new start.
        if (iso && end.value && end.value < iso) {
          if (endPicker) endPicker.clear();
          end.value = "";
        }
        updateDurationLine();
      },
    });
    const endPicker = flatpickr(end, {
      minDate: state.dates.start || "today",
      dateFormat: "Y-m-d",
      altInput: true,
      altFormat: "l, F j, Y",
      disableMobile: true,
      defaultDate: state.dates.end || null,
      onChange: (dates) => {
        end.value = dates[0] ? formatIso(dates[0]) : "";
        updateDurationLine();
      },
    });
  }
  mountFlatpickr();

  function formatIso(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${dd}`;
  }

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

  // "Same as billing" — when checked, drop-off input auto-fills
  // from billing (street + city, state zip) and the field hides.
  // Uncheck reveals + clears the field.
  const sameChk = $("#dropoff-same-as-billing");
  const dropoffWrap = $("#dropoff-field-wrap");
  const dropoffInput = $("#contact-address");
  function billingFormatted() {
    const c = state.contact;
    const line2 = [c.city, c.state].filter(Boolean).join(", ");
    return [c.street, [line2, c.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  }
  function applySameAsBilling() {
    if (!sameChk?.checked) {
      dropoffWrap.hidden = false;
      return;
    }
    const filled = billingFormatted();
    if (!filled) {
      // Nothing to copy yet — show a hint below the checkbox.
      dropoffWrap.hidden = false;
      dropoffInput.value = "";
      state.contact.address = "";
      saveState();
      return;
    }
    dropoffInput.value = filled;
    state.contact.address = filled;
    dropoffWrap.hidden = true;
    saveState();
  }
  sameChk?.addEventListener("change", applySameAsBilling);
  // Re-copy the billing address whenever any billing field changes,
  // so a customer who ticks the box THEN edits their address doesn't
  // end up with a stale drop-off value.
  ["contact-street", "contact-city", "contact-state", "contact-zip"].forEach(id => {
    $("#" + id)?.addEventListener("input", () => { if (sameChk?.checked) applySameAsBilling(); });
  });
  // Re-apply on radio flips too — the wrapper's visibility is
  // controlled by both delivery choice AND the checkbox.
  $$('input[name="delivery"]').forEach(r => r.addEventListener("change", () => {
    if (state.delivery !== "pickup" && sameChk?.checked) applySameAsBilling();
  }));

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
  if (depositNote) depositNote.hidden = !bookingIsFarOut();
  // #review-requirements used to live in a dedicated info box on
  // Step 4; that box was removed (the DL delivery chooser inside the
  // rental agreement covers the same information). Leaving no code
  // that references it here.
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
  // Inline rental-agreement pieces (fleet grid, DL upload, signature).
  // Payment happens offline — PCGC calls the customer after the
  // booking lands. No inline card fields to wire.
  initAgreementUi();
}

// ---------- Inline rental agreement (moved from /agreement/ page) ----------
// State captured from the agreement UI at submit time.
let agreementDlImage = null;      // data URL of the uploaded DL photo (or null)
let sigCanvas = null;             // <canvas> element
let sigPad = null;                // SignaturePad instance (from CDN)
let sigTypedRendered = false;     // canvas holds a typed-name auto-render

function initAgreementUi() {
  renderAgreementFleet();

  // Read-through gate for the "I agree" checkbox — it stays locked
  // until the customer scrolls to the bottom of the terms box. The
  // hint above the checkbox flips from amber ("Scroll…") to green
  // once fulfilled.
  const termsBox = $("#agreement-terms-box");
  const agreedCheck = $("#agreed");
  const agreedWrap = agreedCheck?.closest(".agree-check");
  const scrollHint = $("#agreement-scroll-hint");
  function markAgreementRead() {
    if (!agreedCheck || !agreedWrap) return;
    agreedCheck.disabled = false;
    agreedWrap.classList.remove("locked");
    if (scrollHint) {
      scrollHint.classList.add("scroll-complete");
      scrollHint.textContent = "You've read the agreement — check the box to confirm.";
    }
  }
  if (termsBox && agreedCheck) {
    agreedWrap?.classList.add("locked");
    termsBox.addEventListener("scroll", () => {
      // Within 12px of the bottom counts as "read". Handles rounding
      // when devicePixelRatio doesn't divide the content height cleanly.
      const remaining = termsBox.scrollHeight - termsBox.scrollTop - termsBox.clientHeight;
      if (remaining < 12) markAgreementRead();
    });
    // Short-circuit for viewports where the terms don't overflow the
    // scroll box (unlikely at current copy length, but future-proof).
    if (termsBox.scrollHeight <= termsBox.clientHeight + 4) markAgreementRead();
  }
  if (agreedCheck) {
    agreedCheck.addEventListener("change", () => {
      agreedWrap?.classList.toggle("checked", agreedCheck.checked);
      clearFieldError(agreedWrap);
    });
  }

  sigCanvas = $("#sig-canvas");
  if (!sigCanvas) return;
  // signature_pad may not be loaded yet (defer'd on the <script>). If
  // so, wait one tick and try again — it's usually fine by the time
  // the customer navigates from step 1 to step 4.
  initSignaturePad();

  $("#sig-clear").addEventListener("click", () => {
    if (sigPad) sigPad.clear();
    sigTypedRendered = false;
  });

  // Auto-render the typed name into the canvas as a signature-style
  // preview whenever the customer types. If they draw over it, their
  // strokes replace the typed version; clearing + retyping renders again.
  const typed = $("#typed-name");
  if (typed) {
    typed.addEventListener("input", () => {
      // Only redraw if the canvas is empty OR currently shows a typed
      // render (never clobber a manually-drawn signature).
      if (!sigPad) return;
      if (sigPad.isEmpty() || sigTypedRendered) {
        renderTypedSignature(typed.value.trim());
      }
    });
  }

  window.addEventListener("resize", resizeSigCanvas);

  // DL delivery-method radios — show/hide the upload box.
  $$('input[name="dl-method"]').forEach(r => r.addEventListener("change", updateDlMethodUi));
  updateDlMethodUi();

  // DL upload — client-side resize + preview.
  $("#dl-file").addEventListener("change", handleDlFile);
}

function initSignaturePad() {
  if (sigPad || !sigCanvas) return;
  if (typeof SignaturePad === "undefined") {
    // Script hasn't loaded yet — retry shortly.
    setTimeout(initSignaturePad, 200);
    return;
  }
  resizeSigCanvas();
  sigPad = new SignaturePad(sigCanvas, {
    backgroundColor: "rgba(255,255,255,0)",
    penColor: "#1f5a68",
    minWidth: 1.2,
    maxWidth: 3.0,
    velocityFilterWeight: 0.7,
  });
  // If the canvas currently shows a typed-name auto-render, wipe the
  // painted glyphs (not signature_pad's stroke data) so the user's
  // freehand drawing lands on a clean surface instead of overlapping.
  sigPad.addEventListener("beginStroke", () => {
    if (sigTypedRendered) {
      const ctx = sigCanvas.getContext("2d");
      const ratio = window.devicePixelRatio || 1;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, sigCanvas.width, sigCanvas.height);
      ctx.restore();
      sigTypedRendered = false;
    }
  });
}

// Resize the canvas to its CSS size scaled to the device pixel ratio.
// Uses signature_pad's own fromData()/toData() to preserve strokes
// across resize — no fragile drawImage() dance like the previous
// hand-rolled pad.
function resizeSigCanvas() {
  if (!sigCanvas) return;
  const rect = sigCanvas.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return;
  const ratio = window.devicePixelRatio || 1;
  const savedData = sigPad ? sigPad.toData() : null;
  const wasTyped = sigTypedRendered;
  const typed = $("#typed-name")?.value?.trim() || "";
  sigCanvas.width = Math.floor(rect.width * ratio);
  sigCanvas.height = Math.floor(rect.height * ratio);
  const ctx = sigCanvas.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  if (sigPad && savedData && savedData.length) sigPad.fromData(savedData);
  else if (wasTyped && typed) renderTypedSignature(typed);
}

function renderTypedSignature(name) {
  if (!sigPad || !sigCanvas) return;
  const ctx = sigCanvas.getContext("2d");
  const ratio = window.devicePixelRatio || 1;
  const cssW = sigCanvas.width / ratio;
  const cssH = sigCanvas.height / ratio;
  sigPad.clear();
  if (!name) { sigTypedRendered = false; return; }
  ctx.save();
  const size = Math.max(30, Math.min(72, Math.floor(cssH * 0.6)));
  ctx.font = `${size}px "Cedarville Cursive", "Snell Roundhand", "Segoe Script", cursive`;
  ctx.fillStyle = "#1f5a68";
  ctx.textAlign = "left";
  // True optical centering: measure the actual glyph bounding box
  // (Cedarville Cursive has heavy descenders under the baseline —
  // textBaseline:"middle" alone leaves the visible mass too high).
  ctx.textBaseline = "alphabetic";
  const m = ctx.measureText(name);
  const ascent = m.actualBoundingBoxAscent  || size * 0.75;
  const descent = m.actualBoundingBoxDescent || size * 0.25;
  const glyphH = ascent + descent;
  // baseline Y so that (baseline - ascent) + glyphH/2 lands at cssH/2
  const baselineY = (cssH / 2) + (glyphH / 2) - descent;
  ctx.fillText(name, 24, baselineY);
  ctx.restore();
  // Tell signature_pad this counts as "not empty" for isEmpty().
  // signature_pad uses internal stroke data, so we mark our flag
  // instead and check both when we validate at submit time.
  sigTypedRendered = true;
}

function renderAgreementFleet() {
  const grid = $("#agreement-fleet-grid");
  if (!grid) return;
  const rented = new Set(Object.entries(state.selection || {}).filter(([, q]) => q > 0).map(([id]) => id));
  // Owner request: agreement should only show the cart(s) the
  // customer is actually renting, WITH the cart photo.
  const rentedCarts = CARTS.filter(c => rented.has(c.id));
  if (!rentedCarts.length) {
    grid.innerHTML = '<div class="fleet-cart" style="opacity:.7">No carts selected — go back and pick at least one.</div>';
    return;
  }
  grid.innerHTML = rentedCarts.map(cart => `
    <div class="fleet-cart rented">
      <img src="${cart.img}" alt="${cart.name}" loading="lazy" style="width:100%; aspect-ratio:4/3; object-fit:cover; border-radius:6px; margin-bottom:.4rem;">
      <h5>${cart.name}</h5>
      <div class="meta">${cart.make} · ${cart.modelDetails || ''}<br>Serial <code>${cart.serial}</code></div>
    </div>
  `).join("");
}

// Custom pointer handlers replaced by signature_pad — see
// initSignaturePad() above. sigStart/sigMove/sigEnd/sigPos removed.

function updateDlMethodUi() {
  const method = document.querySelector('input[name="dl-method"]:checked')?.value || "upload";
  const box = $("#dl-upload-box");
  if (!box) return;
  box.hidden = (method !== "upload");
  if (method !== "upload") {
    $("#dl-file").value = "";
    agreementDlImage = null;
    resetDlDropUi();
  }
}

function resetDlDropUi() {
  const dropEmpty = document.querySelector(".dl-drop-empty");
  const dropPreview = document.querySelector(".dl-drop-preview");
  const img = $("#dl-preview");
  if (dropEmpty) dropEmpty.hidden = false;
  if (dropPreview) dropPreview.hidden = true;
  if (img) img.removeAttribute("src"); // clearing src avoids the broken-image icon
}
function showDlDropPreview(dataUrl) {
  const dropEmpty = document.querySelector(".dl-drop-empty");
  const dropPreview = document.querySelector(".dl-drop-preview");
  const img = $("#dl-preview");
  if (img) img.src = dataUrl;
  if (dropEmpty) dropEmpty.hidden = true;
  if (dropPreview) dropPreview.hidden = false;
}

async function handleDlFile() {
  const file = $("#dl-file").files && $("#dl-file").files[0];
  if (!file) { agreementDlImage = null; resetDlDropUi(); return; }
  try {
    const url = await resizeImage(file, 1600, 0.72);
    if (!url || !url.startsWith("data:image/")) throw new Error("bad url");
    agreementDlImage = url;
    showDlDropPreview(url);
  } catch (_) {
    agreementDlImage = null;
    resetDlDropUi();
    alert("Could not process that image. iPhone HEIC photos sometimes fail — try picking a JPG/PNG from your photo library, or select 'text a photo to 936-223-1182' below.");
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

  // Collect ALL missing fields so we can red-highlight them at once
  // and let the customer fix everything in one pass, then jump to
  // the first one.
  const errors = []; // { field: <selector>, msg: string }
  if (!dlNumber) errors.push({ field: "#dl-number", msg: "Driver's license number" });
  if (!dlState) errors.push({ field: "#dl-state", msg: "State" });
  if (!agreed) errors.push({ field: ".agree-check", msg: "Read the agreement above and check the box to confirm" });
  const hasSignature = (sigPad && !sigPad.isEmpty()) || sigTypedRendered;
  if (!hasSignature) errors.push({ field: ".sig-box", msg: "Draw your signature — or type your name below to auto-generate one" });
  if (!typedName) errors.push({ field: "#typed-name", msg: "Type your full legal name" });
  if (dlMethod === "upload" && !agreementDlImage) {
    errors.push({ field: ".dl-drop", msg: "Attach your driver's license photo, or pick a different delivery option" });
  }

  if (errors.length) {
    // Build a friendly summary for the error banner too.
    const msg = errors.length === 1
      ? errors[0].msg + "."
      : `Please complete the highlighted field${errors.length > 1 ? "s" : ""}: ${errors.map(e => e.msg).join("; ")}.`;
    return { ok: false, msg, errors };
  }

  return {
    ok: true,
    agreement: {
      typedName,
      dlNumber,
      dlState,
      dlMethod,
      dlImageDataUrl: dlMethod === "upload" ? agreementDlImage : null,
      // signature_pad's toDataURL() is a thin wrapper around
      // canvas.toDataURL and captures both drawn strokes and any
      // typed-name auto-render we painted on top of the canvas.
      signatureDataUrl: (sigPad ? sigPad.toDataURL("image/png") : sigCanvas.toDataURL("image/png")),
      agreed: true,
    },
  };
}

// Red-highlight a field/element and set up a one-shot listener that
// clears the highlight as soon as the customer starts fixing it.
function markFieldError(selector) {
  const el = document.querySelector(selector);
  if (!el) return;
  // Prefer to highlight the enclosing .rental-field wrapper (so the
  // whole labeled row lights up); fall back to the element itself.
  const target = el.closest(".rental-field") || el;
  target.classList.add("field-error");
  const clearer = () => {
    target.classList.remove("field-error");
    el.removeEventListener("input", clearer);
    el.removeEventListener("change", clearer);
    el.removeEventListener("click", clearer);
  };
  el.addEventListener("input", clearer);
  el.addEventListener("change", clearer);
  el.addEventListener("click", clearer);
}
function clearFieldError(el) {
  if (!el) return;
  const target = el.closest ? (el.closest(".rental-field") || el) : el;
  target.classList?.remove?.("field-error");
}
function clearAllFieldErrors() {
  document.querySelectorAll(".field-error").forEach(el => el.classList.remove("field-error"));
}

async function submitBooking() {
  const err = $("#pay-error");
  err.hidden = true;
  clearAllFieldErrors();

  // Inline agreement validation runs first — nothing gets POSTed
  // until the customer has filled the license fields, drawn a
  // signature, and checked the "I agree" box. Any missed field
  // gets a red-border highlight that clears when they start
  // editing it.
  const collected = collectAgreement();
  if (!collected.ok) {
    err.textContent = collected.msg;
    err.hidden = false;
    (collected.errors || []).forEach(e => markFieldError(e.field));
    // Scroll the FIRST failed field into view so the customer sees
    // exactly where to start.
    const first = collected.errors?.[0]?.field
      ? document.querySelector(collected.errors[0].field)
      : err;
    (first || err).scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }

  const btn = $("#pay-now");
  btn.disabled = true;
  const prevLabel = btn.textContent;
  btn.textContent = "Submitting…";

  const booking = buildBookingRecord();
  // Attach the signed agreement to the booking POST so the Worker
  // stores it alongside the record. Server also validates.
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

  // Kick off the shareable-image generation — canvas draw is quick
  // (~200ms) but async because we wait on an <img> to load. The
  // share card unhides once the preview blob is ready.
  initShareCard(b);
}

// ---------- Shareable social image (Step 5) ---------- //
//
// Everything here is zero-dependency: a Canvas 2D draw for the image,
// navigator.share (Web Share API Level 2) for the native share sheet
// when the browser + platform support it (Safari iOS, Chrome Android,
// Edge, Chrome Windows 15.90+). Falls back to download + copy-caption
// on unsupported browsers.

const SHARE_CAPTION = () => (
  `Just booked a golf cart rental at Polk County Golf Carts for our Lake Livingston trip! 🚗⛳ Family-owned since 2020, best carts in East Texas.\n\nRent yours at https://polkcountygolfcarts.com/rentals/ · 936-223-1182`
);

let _shareBlob = null;   // cached PNG blob so re-clicking Share doesn't regenerate
let _shareBooking = null;

async function initShareCard(booking) {
  _shareBooking = booking;
  const card = $("#share-card");
  const previewImg = $("#share-preview-img");
  const previewLoading = $("#share-preview-loading");
  const shareBtn = $("#share-btn");
  const downloadBtn = $("#share-download-btn");
  const copyBtn = $("#share-copy-btn");
  const toast = $("#share-toast");
  if (!card) return;

  card.hidden = false;
  previewImg.hidden = true;
  previewLoading.hidden = false;

  try {
    _shareBlob = await generateShareImage(booking);
    previewImg.src = URL.createObjectURL(_shareBlob);
    previewImg.hidden = false;
    previewLoading.hidden = true;
  } catch (e) {
    previewLoading.textContent = "Couldn't generate share image — try refreshing.";
    return;
  }

  // Wire the three buttons (idempotent — safe if renderConfirmation
  // runs more than once).
  const flashToast = (msg, ms = 3000) => {
    toast.textContent = msg;
    toast.hidden = false;
    clearTimeout(flashToast._t);
    flashToast._t = setTimeout(() => { toast.hidden = true; }, ms);
  };

  shareBtn.onclick = async () => {
    if (!_shareBlob) return;
    const file = new File([_shareBlob], "pcgc-rental.png", { type: "image/png" });
    const shareData = {
      files: [file],
      title: "Polk County Golf Carts",
      text: SHARE_CAPTION(),
    };
    // canShare with files is Web Share Level 2 — Safari iOS 15+,
    // Chrome Android, Edge, some desktop Chromes. Fall back
    // gracefully otherwise.
    if (navigator.canShare && navigator.canShare(shareData)) {
      try {
        await navigator.share(shareData);
        if (window.pcgcTrack) window.pcgcTrack("booking-shared");
        return;
      } catch (e) {
        // AbortError = user cancelled the share sheet — silent no-op.
        if (e && e.name !== "AbortError") flashToast("Share cancelled or failed. Try Download instead.");
        return;
      }
    }
    // Fallback for desktops without Web Share API — copy caption +
    // hint the user to save the image below.
    try { await navigator.clipboard.writeText(SHARE_CAPTION()); } catch (_) {}
    flashToast("Caption copied ✓ — save the image below and paste both wherever you're posting.", 5000);
  };

  downloadBtn.onclick = () => {
    if (!_shareBlob) return;
    const url = URL.createObjectURL(_shareBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pcgc-rental-${booking.id || "share"}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    flashToast("Downloaded ✓");
    if (window.pcgcTrack) window.pcgcTrack("booking-shared");
  };

  copyBtn.onclick = async () => {
    try {
      await navigator.clipboard.writeText(SHARE_CAPTION());
      flashToast("Caption copied ✓");
    } catch (_) {
      flashToast("Copy failed — long-press the caption to copy manually.");
    }
  };
}

// Draws a 1080x1080 branded share card on an offscreen canvas.
// Layout:
//   background: coral -> teal diagonal gradient
//   cream card in the middle (90% inset)
//   cart photo top of card (16:9-ish)
//   "Just booked at PCGC!" headline
//   customer first name + dates
//   URL + phone footer
// Returns a PNG blob.
async function generateShareImage(booking) {
  const W = 1080, H = 1080;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d");

  // Background: brand gradient
  const grad = ctx.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, "#e85a4f");
  grad.addColorStop(1, "#1f5a68");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // Interior card
  const pad = 48;
  roundRect(ctx, pad, pad, W - pad * 2, H - pad * 2, 32, "#fbf8f3");

  // Cart photo (of the first cart they rented, if any)
  const cart = (booking.items && booking.items[0]) || null;
  const cartMeta = cart ? CARTS.find(x => x.id === cart.id) : null;
  const imgSrc = (cartMeta && cartMeta.img) || "/assets/photos/rentals/limo.jpg";

  const cartImg = await loadImage(imgSrc).catch(() => null);
  const photoX = pad + 48, photoY = pad + 48;
  const photoW = W - pad * 2 - 96, photoH = 520;
  ctx.save();
  roundRect(ctx, photoX, photoY, photoW, photoH, 20, null);
  ctx.clip();
  if (cartImg) drawCover(ctx, cartImg, photoX, photoY, photoW, photoH);
  else { ctx.fillStyle = "#e6f1f3"; ctx.fillRect(photoX, photoY, photoW, photoH); }
  ctx.restore();

  // Headline
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#1f5a68";
  ctx.font = "700 68px Georgia, 'Times New Roman', serif";
  ctx.fillText("Just booked at PCGC!", W / 2, photoY + photoH + 90);

  // First name + dates
  const c1 = booking.contact || {};
  const firstName = (c1.name || "").split(/\s+/)[0] || "";
  const start = fmtShort(booking.dates?.start);
  const end = fmtShort(booking.dates?.end);
  ctx.fillStyle = "#555";
  ctx.font = "500 32px system-ui, -apple-system, Segoe UI, sans-serif";
  const sub = firstName ? `${firstName} · ${start} → ${end}` : `${start} → ${end}`;
  ctx.fillText(sub, W / 2, photoY + photoH + 140);

  // Cart-name line (e.g. "Cart #2 — The Limo")
  if (cartMeta) {
    ctx.fillStyle = "#e85a4f";
    ctx.font = "700 28px system-ui, -apple-system, Segoe UI, sans-serif";
    ctx.fillText(cartMeta.name, W / 2, photoY + photoH + 185);
  }

  // Footer strip
  const footerY = H - pad - 100;
  ctx.fillStyle = "#e85a4f";
  ctx.fillRect(pad, footerY, W - pad * 2, 4);
  ctx.fillStyle = "#1f5a68";
  ctx.font = "700 36px Georgia, serif";
  ctx.fillText("polkcountygolfcarts.com", W / 2, footerY + 55);
  ctx.fillStyle = "#666";
  ctx.font = "400 26px system-ui, sans-serif";
  ctx.fillText("Livingston, TX · 936-223-1182", W / 2, footerY + 92);

  return new Promise((resolve) => c.toBlob(resolve, "image/png"));
}

// Canvas draw helpers.
function roundRect(ctx, x, y, w, h, r, fill) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
}
// Object-fit: cover for canvas images.
function drawCover(ctx, img, dx, dy, dw, dh) {
  const sr = img.width / img.height;
  const dr = dw / dh;
  let sx = 0, sy = 0, sw = img.width, sh = img.height;
  if (sr > dr) {
    // source wider than destination — crop sides
    sw = img.height * dr;
    sx = (img.width - sw) / 2;
  } else {
    sh = img.width / dr;
    sy = (img.height - sh) / 2;
  }
  ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
}
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
function fmtShort(iso) {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
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
