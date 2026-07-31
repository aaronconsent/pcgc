/* PCGC event tracker — Tier 2 conversion analytics.
 *
 * Fires POST /api/track when a customer clicks a [data-cta] button
 * (finance-apply-*) or an a[href^="tel:"] link (phone-tap). Also
 * exposes window.pcgcTrack(event) for explicit calls — rentals.js
 * uses that to log "booking-submitted" once /api/booking returns ok.
 *
 * Uses navigator.sendBeacon so events survive page unload (the click
 * usually navigates away from the page immediately after firing).
 * Falls back to keepalive: true fetch on browsers without sendBeacon.
 *
 * Failures are silent — an event drop must never break the customer
 * flow. The Worker allow-lists valid event names and 400s on the
 * rest, so URL-crafters can't fill KV with junk.
 */
(function () {
  function track(event) {
    if (!event) return;
    try {
      const body = JSON.stringify({ event: event });
      if (typeof navigator.sendBeacon === "function") {
        const blob = new Blob([body], { type: "application/json" });
        navigator.sendBeacon("/api/track", blob);
      } else {
        fetch("/api/track", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: body,
          keepalive: true,
        }).catch(function () {});
      }
    } catch (_) { /* swallow */ }
  }

  // Exposed so rentals.js (and any other page-specific script) can
  // fire explicit events on non-click moments (form submits, etc.).
  window.pcgcTrack = track;

  // Delegated click handler in the capture phase so navigations
  // don't beat sendBeacon to the punch.
  document.addEventListener("click", function (ev) {
    var el = ev.target && ev.target.closest
      ? ev.target.closest("[data-cta], a[href^='tel:']")
      : null;
    if (!el) return;
    var evtName = el.dataset && el.dataset.cta
      ? el.dataset.cta
      : "phone-tap";
    track(evtName);
  }, { capture: true, passive: true });
})();
