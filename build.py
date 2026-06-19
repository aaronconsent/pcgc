#!/usr/bin/env python3
"""
Static-site builder for Polk County Golf Carts.

One Python file generates every HTML page from shared header / footer /
contact strip fragments, so nav stays in sync across the site. Output
is plain HTML in site/ (no build chain on Cloudflare — wrangler just
uploads the directory).

Run:  python3 build.py
"""
import os
from textwrap import dedent

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "site")

BIZ = {
    "name": "Polk County Golf Carts",
    "short": "PCGC",
    "addr": "1732 FM 3277, Livingston, TX 77351",
    "phone_primary": "936-223-1182",
    "phone_secondary": "936-566-5069",
    "email": "polkcountygolfcarts@yahoo.com",
    "owner": "John",
    "founded": 2020,
    "service_area": "San Jacinto, Polk, Walker, Trinity & Angelina counties",
    "delivery_radius": 25,
    "extended_radius": 75,
    "bbb_url": "https://www.bbb.org/us/tx/livingston/profile/recreational-vehicles/polk-county-golf-carts-0825-1000223827",
    # Family-shop tagline used wherever we used to say "Family-owned since 2020".
    "tagline": "Serving our community as a family owned business since 2020",
    # Brand inventory line — repeated across hero copy and the carts page.
    "inventory_line": "We sell brand-new Breezy EV carts, refurbished carts, and used carts — electric and gas.",
}

NAV = [
    ("Home", "/"),
    ("Breezy EV Carts", "/carts/"),
    ("Service & Custom", "/services/"),
    ("About", "/about/"),
    ("Contact", "/contact/"),
]


def head(title, desc, path="/", og_slug=None):
    canonical = f"https://polkcountygolfcarts.com{path}"
    og_image = f"/assets/og/{og_slug}.png" if og_slug else "/assets/og/home.png"
    return dedent(f"""\
        <!doctype html>
        <html lang="en">
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <title>{title} | {BIZ['name']}</title>
          <meta name="description" content="{desc}">
          <link rel="canonical" href="{canonical}">
          <link rel="icon" type="image/svg+xml" href="/assets/logos/logo-color.svg">
          <link rel="icon" type="image/png" sizes="256x256" href="/assets/logos/favicon.png">
          <link rel="preconnect" href="https://fonts.cdnfonts.com">
          <link rel="stylesheet" href="https://fonts.cdnfonts.com/css/grobold">
          <link rel="stylesheet" href="/assets/site.css">
          <meta property="og:title" content="{title} | {BIZ['name']}">
          <meta property="og:description" content="{desc}">
          <meta property="og:image" content="https://polkcountygolfcarts.com{og_image}">
          <meta property="og:image:width" content="1200">
          <meta property="og:image:height" content="630">
          <meta property="og:type" content="website">
          <meta property="og:url" content="{canonical}">
          <meta name="twitter:card" content="summary_large_image">
          <meta name="twitter:title" content="{title} | {BIZ['name']}">
          <meta name="twitter:description" content="{desc}">
          <meta name="twitter:image" content="https://polkcountygolfcarts.com{og_image}">
        </head>
        <body>
        <div class="banner">FREE WARRANTIES on every cart purchased through PCGC · BBB Accredited · {BIZ['tagline']}</div>
        """)


def header(current_path):
    def link(label, href):
        cur = ' aria-current="page"' if href == current_path else ''
        return f'    <a href="{href}"{cur}>{label}</a>'
    nav_html = "\n".join(link(label, href) for label, href in NAV)
    return dedent(f"""\
        <header class="site-header">
          <div class="container">
            <a class="brand" href="/">
              <img class="brand-mark" src="/assets/logos/logo-color.svg" alt="" width="144" height="112" aria-hidden="true">
              <span class="brand-text">{BIZ['name']}<small>Livingston, Texas</small></span>
            </a>
            <nav class="primary">
        {nav_html}
              <a class="cta" href="tel:{BIZ['phone_primary'].replace('-','')}">📞 {BIZ['phone_primary']}</a>
            </nav>
          </div>
        </header>
        """)


def contact_strip():
    return dedent(f"""\
        <section class="contact-strip">
          <div class="container contact-strip-inner">
            <div>
              <h3>Call us</h3>
              <a class="big" href="tel:{BIZ['phone_primary'].replace('-','')}">{BIZ['phone_primary']}</a><br>
              <a href="tel:{BIZ['phone_secondary'].replace('-','')}">{BIZ['phone_secondary']}</a>
            </div>
            <div>
              <h3>Email</h3>
              <a href="mailto:{BIZ['email']}">{BIZ['email']}</a>
            </div>
            <div>
              <h3>Visit</h3>
              <a href="https://maps.google.com/?q={BIZ['addr'].replace(' ','+')}">{BIZ['addr']}</a>
            </div>
            <div>
              <h3>Hours</h3>
              <span>Tue–Fri · 9a–4p</span><br>
              <span>Saturday · 9a–2p</span><br>
              <span style="opacity:.75">Closed Sun–Mon &amp; holidays · emergency calls billed at additional rate</span>
            </div>
          </div>
        </section>
        """)


def footer():
    nav_links = "\n".join(f'      <li><a href="{href}">{label}</a></li>' for label, href in NAV)
    return dedent(f"""\
        <footer class="site-footer">
          <div class="container">
            <div class="foot-grid">
              <div>
                <img class="foot-mark" src="/assets/logos/logo-white.svg" alt="{BIZ['name']}" width="120" height="92">
                <h4 class="brand-text-foot">{BIZ['name']}</h4>
                <p>{BIZ['tagline']} in Livingston, Texas. {BIZ['inventory_line']} Free pickup &amp; delivery within {BIZ['delivery_radius']} miles, extended service up to {BIZ['extended_radius']} miles for an additional charge.</p>
                <a class="bbb-badge" href="{BIZ['bbb_url']}" target="_blank" rel="noopener">★ BBB Accredited</a>
              </div>
              <div>
                <h4>Site</h4>
                <ul>
        {nav_links}
                </ul>
              </div>
              <div>
                <h4>Reach us</h4>
                <ul>
                  <li><a href="tel:{BIZ['phone_primary'].replace('-','')}">{BIZ['phone_primary']}</a></li>
                  <li><a href="tel:{BIZ['phone_secondary'].replace('-','')}">{BIZ['phone_secondary']}</a></li>
                  <li><a href="mailto:{BIZ['email']}">Email us</a></li>
                </ul>
              </div>
              <div>
                <h4>Visit</h4>
                <p>{BIZ['addr']}</p>
              </div>
            </div>
            <div class="foot-bot">
              <span>© 2026 {BIZ['name']}. All rights reserved.</span>
              <span><a href="/privacy/">Privacy Policy</a></span>
            </div>
          </div>
        </footer>
        """) + feedback_widget() + "</body></html>\n"


def feedback_widget():
    """Floating chat-bubble feedback widget injected at the end of every
    page. Posts to /api/feedback (handled by src/worker.js). Self-contained
    HTML + script; styles live in site.css under the `.pcgc-fb-` prefix."""
    return dedent("""\
        <div id="pcgc-fb-root" class="pcgc-fb-root" data-open="false">
          <button id="pcgc-fb-toggle" class="pcgc-fb-toggle" type="button" aria-label="Send feedback" aria-expanded="false">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
            <span>Feedback</span>
          </button>
          <div id="pcgc-fb-panel" class="pcgc-fb-panel" role="dialog" aria-labelledby="pcgc-fb-title" hidden>
            <div class="pcgc-fb-head">
              <h3 id="pcgc-fb-title">Send feedback</h3>
              <button id="pcgc-fb-close" class="pcgc-fb-close" type="button" aria-label="Close">×</button>
            </div>
            <form id="pcgc-fb-form" class="pcgc-fb-form" enctype="multipart/form-data">
              <label class="pcgc-fb-field">
                <span>What's on your mind?</span>
                <textarea name="text" required minlength="2" maxlength="5000" rows="4" placeholder="Anything off, missing, or worth tweaking on this page?"></textarea>
              </label>
              <label class="pcgc-fb-field pcgc-fb-files">
                <span>Attach screenshots <em>(optional, up to 5)</em></span>
                <input type="file" name="images" accept="image/*" multiple>
              </label>
              <p class="pcgc-fb-meta">Page: <code id="pcgc-fb-url"></code></p>
              <button class="pcgc-fb-submit" type="submit">Send feedback</button>
              <p class="pcgc-fb-error" id="pcgc-fb-error" hidden></p>
            </form>
            <div class="pcgc-fb-thanks" id="pcgc-fb-thanks" hidden>
              <strong>Thanks!</strong>
              <p>Your feedback was saved. We'll review it.</p>
              <button class="pcgc-fb-submit" type="button" id="pcgc-fb-done">Close</button>
            </div>
          </div>
        </div>
        <script>
        (function(){
          var root = document.getElementById('pcgc-fb-root');
          var toggle = document.getElementById('pcgc-fb-toggle');
          var panel = document.getElementById('pcgc-fb-panel');
          var closeBtn = document.getElementById('pcgc-fb-close');
          var form = document.getElementById('pcgc-fb-form');
          var thanks = document.getElementById('pcgc-fb-thanks');
          var doneBtn = document.getElementById('pcgc-fb-done');
          var urlOut = document.getElementById('pcgc-fb-url');
          var err = document.getElementById('pcgc-fb-error');
          var submitBtn = form.querySelector('.pcgc-fb-submit');
          urlOut.textContent = location.pathname + location.search;

          function setOpen(on){
            root.dataset.open = on ? 'true' : 'false';
            toggle.setAttribute('aria-expanded', on ? 'true' : 'false');
            if (on) { panel.hidden = false; setTimeout(function(){ form.querySelector('textarea').focus(); }, 50); }
            else { panel.hidden = true; }
          }
          function reset(){
            form.hidden = false;
            thanks.hidden = true;
            err.hidden = true;
            err.textContent = '';
            form.reset();
          }

          toggle.addEventListener('click', function(){ setOpen(root.dataset.open !== 'true'); });
          closeBtn.addEventListener('click', function(){ setOpen(false); });
          doneBtn.addEventListener('click', function(){ reset(); setOpen(false); });

          form.addEventListener('submit', async function(ev){
            ev.preventDefault();
            err.hidden = true;
            submitBtn.disabled = true;
            submitBtn.textContent = 'Sending…';
            try {
              var fd = new FormData(form);
              fd.append('url', location.href);
              var res = await fetch('/api/feedback', { method: 'POST', body: fd });
              if (!res.ok) {
                var body = {};
                try { body = await res.json(); } catch(_){}
                throw new Error(body.error || ('HTTP ' + res.status));
              }
              form.hidden = true;
              thanks.hidden = false;
            } catch(e){
              err.textContent = "Couldn't send: " + (e && e.message ? e.message : 'unknown error');
              err.hidden = false;
            } finally {
              submitBtn.disabled = false;
              submitBtn.textContent = 'Send feedback';
            }
          });
        })();
        </script>
        """)


# ---------------- Pages ---------------- #

def page_home():
    return (
        head(
            "Golf Cart Sales, Service & Custom Builds in Livingston, TX",
            "Polk County Golf Carts: brand-new Breezy EV, refurbished, and used carts — electric and gas — plus full service, custom builds, and free pickup & delivery within 25 miles of Livingston, TX (extended service up to 75 miles).",
            "/",
            og_slug="home",
        )
        + header("/")
        + dedent(f"""\
        <section class="hero">
          <div class="container hero-split">
            <div>
              <h1>The cart you want, built and serviced by a neighbor you trust.</h1>
              <p class="lede">{BIZ['tagline']}. {BIZ['inventory_line']} Plus full service and custom builds from a fresh paint job to a full lift kit, with free pickup &amp; delivery within {BIZ['delivery_radius']} miles of Livingston — extended service up to {BIZ['extended_radius']} miles for an additional charge.</p>
              <div class="hero-ctas">
                <a class="btn btn-coral" href="/carts/">See the new Breezy EV →</a>
                <a class="btn btn-outline" href="tel:{BIZ['phone_primary'].replace('-','')}">📞 {BIZ['phone_primary']}</a>
              </div>
              <div class="hero-meta">
                <span><b>★★★★★</b> 5.0 reviews · BBB Accredited</span>
                <span><b>2-year</b> bumper-to-bumper warranty</span>
              </div>
            </div>
            <img src="/assets/photos/breezy-ev-lake-grass.jpg" alt="Teal 6-seater Breezy EV golf cart with lifted off-road tires beside East Texas lake" width="800" height="600" fetchpriority="high">
          </div>
        </section>

        <section class="band" style="padding:0; background:#000;">
          <img src="/assets/photos/hero-sign-corvette.jpg" alt="Polk County Golf Carts shop sign with a blue Breezy EV cart parked next to a blue Corvette with BREEZY license plate" style="width:100%; display:block; max-height:520px; object-fit:cover;" loading="lazy">
        </section>

        <section class="alt">
          <div class="container">
            <div class="section-head">
              <span class="eyebrow">What we do</span>
              <h2>One small shop. Three things we do better than anyone in East Texas.</h2>
            </div>
            <div class="cards">
              <div class="card">
                <div class="icon">1</div>
                <h3>Carts for every budget</h3>
                <p>Brand-new 2026 Breezy EV carts, refurbished carts, and used carts — electric and gas. 4- or 6-seater, eight color options, financing through Lendmark Financial or Dealer Direct.</p>
              </div>
              <div class="card alt">
                <div class="icon">2</div>
                <h3>Service &amp; maintenance</h3>
                <p>Batteries, brakes, motors, controllers, electrical, tune-ups. Full-service package starting at $165. Gas or electric, any brand.</p>
              </div>
              <div class="card">
                <div class="icon">3</div>
                <h3>Custom builds</h3>
                <p>Custom paint, lift kits, wheels &amp; tires, sound bars, seats, Navitas controllers. We turn carts into rolling personality — for your team, your hobby, your style.</p>
              </div>
            </div>
          </div>
        </section>

        <section>
          <div class="container split">
            <div>
              <span class="eyebrow">Featured</span>
              <h2>The brand-new 2026 Breezy EV.</h2>
              <p class="lede-text">Style. Comfort. Speed. Fun. The Breezy EV is the cart we built our reputation around — and the one we&rsquo;d recommend to a friend without hesitation.</p>
              <ul class="checks">
                <li>Lithium battery with 8-year warranty</li>
                <li>2-year bumper-to-bumper warranty</li>
                <li>Top speed 37 mph — or lock kids to 5 mph from your phone</li>
                <li>Bluetooth sound bar, LED lights, CarPlay touchscreen</li>
                <li>Optional full street-legal kit</li>
              </ul>
              <a class="btn btn-coral" href="/carts/">See all specs &amp; colors →</a>
            </div>
            <div class="price-box">
              <span class="eyebrow">Financing available</span>
              <h3 class="mt-0" style="color:var(--ink)">Pay over time.</h3>
              <p class="muted">Apply through <b>Lendmark Financial</b> or <b>Dealer Direct</b> — answer in minutes, pay over time.</p>
              <a class="btn btn-teal" href="/contact/">Get a quote</a>
            </div>
          </div>
        </section>

        <section class="alt">
          <div class="container">
            <div class="section-head">
              <span class="eyebrow">What customers say</span>
              <h2>Five-star service, repeat after repeat.</h2>
            </div>
            <div class="tm-grid">
              <div class="tm">
                <div class="stars">★★★★★</div>
                <p class="quote">"Our cart was completely non-functioning. We messaged this golf cart company in Livingston and the owner came out TO OUR HOUSE this morning and diagnosed the problem in 5 minutes. Fast, friendly, and so helpful!"</p>
                <p class="cite">— E. Murray</p>
              </div>
              <div class="tm">
                <div class="stars">★★★★★</div>
                <p class="quote">"If you&rsquo;re in the Livingston area and need a golf cart or any work done on yours, please don&rsquo;t hesitate to give John a call! He loves what he does and does great work. We won&rsquo;t take ours to anyone else."</p>
                <p class="cite">— Carrie</p>
              </div>
              <div class="tm">
                <div class="stars">★★★★★</div>
                <p class="quote">"What phenomenal service. He took an ugly duckling and brought back a swan. If you want superior service by an honest and reliable expert, then John&rsquo;s your man."</p>
                <p class="cite">— H&amp;M</p>
              </div>
            </div>
            <p class="center" style="margin-top:2rem"><a href="/about/">Read more reviews →</a></p>
          </div>
        </section>

        <section>
          <div class="container">
            <div class="section-head center" style="margin-left:auto; margin-right:auto; text-align:center">
              <span class="eyebrow">Service area</span>
              <h2>Free within 25 miles. Extended up to 75.</h2>
              <p class="lede-text"><b>Free pickup &amp; delivery</b> for any service within {BIZ['delivery_radius']} miles of our Livingston shop. <b>Extended service area</b> up to {BIZ['extended_radius']} miles for an additional charge — just call us for a quote. Proudly serving {BIZ['service_area']} and beyond.</p>
              <a class="btn btn-coral" href="tel:{BIZ['phone_primary'].replace('-','')}">📞 Call {BIZ['phone_primary']}</a>
            </div>
          </div>
        </section>
        """)
        + contact_strip()
        + footer()
    )


def page_carts():
    return (
        head(
            "Brand-New, Refurbished & Used Golf Carts",
            "We sell brand-new Breezy EV carts, refurbished carts, and used carts — electric and gas — out of Livingston, TX. Lithium battery, 2-year warranty, app speed lock, CarPlay, street-legal option.",
            "/carts/",
            og_slug="carts",
        )
        + header("/carts/")
        + dedent(f"""\
        <section class="hero" style="padding-bottom:3rem">
          <div class="container hero-split">
            <div>
              <h1>Brand-new. Refurbished. Used.</h1>
              <p class="lede">{BIZ['inventory_line']} Below: the cart we built our reputation around — the 2026 Breezy EV.</p>
              <div class="hero-ctas">
                <a class="btn btn-coral" href="tel:{BIZ['phone_primary'].replace('-','')}">Call {BIZ['phone_primary']}</a>
                <a class="btn btn-outline" href="/contact/">Get a quote</a>
              </div>
            </div>
            <img src="/assets/photos/breezy-ev-lake-grass.jpg" alt="Teal 6-seater Breezy EV golf cart with off-road tires" width="800" height="752" fetchpriority="high">
          </div>
        </section>

        <section class="alt">
          <div class="container">
            <div class="cards">
              <div class="card">
                <div class="icon">⚡</div>
                <h3>Lithium battery</h3>
                <p><b>8-year warranty</b> on the battery alone. Charges fast, lasts long, no acid topping.</p>
              </div>
              <div class="card alt">
                <div class="icon">📱</div>
                <h3>App speed control</h3>
                <p>Lock the cart to 5 mph for the kids. Open it up to 37 mph for the parents. Lock the whole cart from your phone when you walk away.</p>
              </div>
              <div class="card">
                <div class="icon">🎵</div>
                <h3>Sound bar + CarPlay</h3>
                <p>LED-lit Bluetooth sound bar plus a touchscreen with Apple &amp; Android CarPlay. Music, GPS, the works.</p>
              </div>
              <div class="card alt">
                <div class="icon">🛡️</div>
                <h3>2-year warranty</h3>
                <p>Full bumper-to-bumper warranty on the cart, eight years on the battery. Backed locally — call us, we pick up.</p>
              </div>
              <div class="card">
                <div class="icon">🛣️</div>
                <h3>Street-legal kit</h3>
                <p>Optional full street-legal package. Headlights, turn signals, mirrors — everything Texas DMV needs.</p>
              </div>
              <div class="card alt">
                <div class="icon">👥</div>
                <h3>4 or 6 seats</h3>
                <p>Four-seater or six-seater, all seats facing forward. Pick your family layout.</p>
              </div>
            </div>
          </div>
        </section>

        <section>
          <div class="container">
            <div class="split">
              <div>
                <span class="eyebrow">Eight colors</span>
                <h2>Pick your finish.</h2>
                <p class="lede-text">Every Breezy EV ships in one of eight colors. Want something else? We can custom-paint any cart in our shop.</p>
                <div class="swatches">
                  <span class="swatch"><span class="dot" style="background:#ff7d28"></span>Vibrant Orange</span>
                  <span class="swatch"><span class="dot" style="background:#c8102e"></span>Candy Apple Red</span>
                  <span class="swatch"><span class="dot" style="background:#0a4d8c"></span>Ocean Blue</span>
                  <span class="swatch"><span class="dot" style="background:#00a3d9"></span>Electric Blue</span>
                  <span class="swatch"><span class="dot" style="background:#5fa830"></span>Green Apple</span>
                  <span class="swatch"><span class="dot" style="background:#f7f5ec; border-color:#cdcdc0"></span>Pearl White</span>
                  <span class="swatch"><span class="dot" style="background:#1d1d1d"></span>Matte Black</span>
                  <span class="swatch"><span class="dot" style="background:#4a4d52"></span>Gun Metal Grey</span>
                </div>
              </div>
              <div class="price-box">
                <span class="eyebrow">Financing</span>
                <h3 class="mt-0" style="color:var(--ink)">Pay over time.</h3>
                <p class="muted">We work with <b>Lendmark Financial</b> and <b>Dealer Direct</b>. Apply in minutes, answer same-day.</p>
                <a class="btn btn-teal" href="tel:{BIZ['phone_primary'].replace('-','')}">Apply by phone</a>
              </div>
            </div>
          </div>
        </section>

        <section>
          <div class="container split">
            <div class="photo-block">
              <img src="/assets/photos/breezy-ev-colors-grid.jpg" alt="Four Breezy EV golf carts in green, red, light blue, and dark blue showing color and seating options" width="800" height="640" loading="lazy">
            </div>
            <div>
              <span class="eyebrow">Built for the whole family</span>
              <h2>Room for six. Comfort for all of them.</h2>
              <p class="lede-text">The six-seater configuration adds a rear flip seat with the same quilted upholstery as the front. Pick a 4-seater for everyday cruising, a 6-seater for the whole family.</p>
              <ul class="checks">
                <li>Independent rear suspension for a smoother ride</li>
                <li>Quilted vinyl seats — easy to clean, hot-weather friendly</li>
                <li>Brake lights, turn signals, license-plate mount</li>
                <li>Trailer hitch receiver standard</li>
              </ul>
            </div>
          </div>
        </section>

        <section class="alt">
          <div class="container">
            <div class="section-head center" style="margin-left:auto; margin-right:auto; text-align:center">
              <span class="eyebrow">Gallery</span>
              <h2>Real carts. Real customers.</h2>
              <p class="lede-text">A few that have rolled out of our Livingston shop.</p>
            </div>
            <div class="photo-grid">
              <img src="/assets/photos/sunset-carts-sign.jpg" alt="Two lifted Breezy EV carts photographed at sunset with the PCGC sign between them" loading="lazy">
              <img src="/assets/photos/texas-cart-alamo.jpg" alt="Yamaha golf cart with a Texas-flag wrap parked in front of the Alamo" loading="lazy">
              <img src="/assets/photos/breezy-ev-lakeside.jpg" alt="Teal Breezy EV golf cart with quilted leather seats by a lake" loading="lazy">
              <img src="/assets/photos/cart-red-lifted.jpg" alt="Red lifted EZGO golf cart with off-road tires" loading="lazy">
              <img src="/assets/photos/cart-blue-tempo.jpg" alt="Blue Club Car Tempo with chrome wheels" loading="lazy">
              <img src="/assets/photos/cart-white-chrome.jpg" alt="White Club Car Tempo with chrome wheels and grey upholstery" loading="lazy">
            </div>
          </div>
        </section>

        <section>
          <div class="container center">
            <h2>Ready to see one in person?</h2>
            <p class="lede-text">We're in Livingston, just off FM 3277. Stop by, take one for a spin, ask anything.</p>
            <a class="btn btn-coral" href="tel:{BIZ['phone_primary'].replace('-','')}">📞 Call {BIZ['phone_primary']}</a>
            &nbsp;
            <a class="btn btn-ghost" href="/contact/">Directions</a>
          </div>
        </section>
        """)
        + contact_strip()
        + footer()
    )


def page_services():
    return (
        head(
            "Golf Cart Service, Custom Builds & Repairs",
            "Full-service golf cart maintenance and custom builds in Livingston, TX. Batteries, brakes, motors, controllers, lift kits, custom paint, wheels & tires. Service package from $165.",
            "/services/",
            og_slug="services",
        )
        + header("/services/")
        + dedent(f"""\
        <section class="hero" style="padding-bottom:3rem">
          <div class="container">
            <h1>Service. Custom. Anything cart.</h1>
            <p class="lede">Tune-ups, batteries, motors, paint, lift kits — gas or electric, any brand. We service what we sell, plus everyone else's too.</p>
          </div>
        </section>

        <section>
          <div class="container split">
            <div>
              <span class="eyebrow">Full Service Package · 20-Point Inspection</span>
              <h2>Get your cart road-ready.</h2>
              <p class="lede-text">Our 20-point service package covers every system on your cart, top to bottom. Drop it off — or let us pick it up <b>free within {BIZ['delivery_radius']} miles</b> (extended up to {BIZ['extended_radius']} miles for an additional charge).</p>
              <ul class="checks">
                <li>Check &amp; refill rear-end gear oil</li>
                <li>Clean &amp; adjust brake shoes</li>
                <li>Check &amp; adjust front-end alignment</li>
                <li>Grease the front end</li>
                <li>Test all accessories</li>
                <li>Clean &amp; coat battery terminals</li>
                <li>Check &amp; adjust battery H₂O level</li>
                <li>Air &amp; rotate tires (if needed)</li>
                <li>Full battery charge</li>
                <li>Cart cleaned and returned</li>
              </ul>
              <p><b>10% off Parts &amp; Labor</b> — valid for 1 year from the date of your initial service.</p>
            </div>
            <div class="price-box">
              <span class="eyebrow">Starting at</span>
              <span class="price">$165<small> + tax</small></span>
              <p class="muted">Full Service Package · 20-Point Inspection</p>
              <a class="btn btn-coral" href="tel:{BIZ['phone_primary'].replace('-','')}">Schedule today</a>
            </div>
          </div>
        </section>

        <section class="alt">
          <div class="container">
            <div class="section-head">
              <span class="eyebrow">Repairs we do every day</span>
              <h2>Common service work.</h2>
            </div>
            <div class="cards">
              <div class="card">
                <h3>New batteries</h3>
                <p>Lead-acid or Lithium, including <b>Bolt Energy</b> and <b>White Lightening</b>'s new line of Lithium batteries. We size, install, and dispose of the old set.</p>
              </div>
              <div class="card">
                <h3>Battery problems</h3>
                <p>Won't hold a charge? Won't take one? We diagnose chargers, cables, and terminals in one visit.</p>
              </div>
              <div class="card">
                <h3>Electrical shorts</h3>
                <p>Burnt fuses, flaky wiring, dead controllers — we trace it and fix it. (Yes, including the one your neighbor &ldquo;already looked at.&rdquo;)</p>
              </div>
              <div class="card">
                <h3>Engine tune-ups</h3>
                <p>Gas-powered carts get spark, fuel, filters, and timing dialed in for fresh-from-the-factory feel.</p>
              </div>
            </div>
          </div>
        </section>

        <section>
          <div class="container">
            <div class="split">
              <div>
                <span class="eyebrow">Custom builds</span>
                <h2>You are not ordinary. So why should your cart be?</h2>
                <p class="lede-text">Whether you want a rear flip seat added or a full ground-up build with custom paint and a Navitas controller, we'll work to your budget and your taste.</p>
                <p>Lifts. Sound systems. Wheels. Paint. Controllers. Seats. We've done it. Look through real builds we've delivered to East Texas customers — yours could be next.</p>
                <a class="btn btn-coral" href="tel:{BIZ['phone_primary'].replace('-','')}">Book a free consultation</a>
              </div>
              <div class="photo-block">
                <img src="/assets/photos/texas-cart-alamo.jpg" alt="Yamaha golf cart with a Texas-flag wrap parked in front of the Alamo" width="800" height="1200" loading="lazy">
              </div>
            </div>
            <div class="cards" style="margin-top:3rem">
              <div class="card">
                <div class="icon">🎨</div>
                <h3>Custom paint</h3>
                <p>Favorite team, hobby, cartoon, patriotic theme — paint it however you picture it. Full prep, multi-stage finish.</p>
              </div>
              <div class="card alt">
                <div class="icon">⬆️</div>
                <h3>Lift kits</h3>
                <p>Get the stance and ground clearance for off-road use. Paired with the right tires &amp; wheels for the look you want.</p>
              </div>
              <div class="card">
                <div class="icon">🛞</div>
                <h3>Wheels &amp; tires</h3>
                <p>Off-road, street, low-pro — the right tire-and-wheel combo turns heads. We carry options for every budget.</p>
              </div>
              <div class="card alt">
                <div class="icon">⚙️</div>
                <h3>Controllers &amp; motors</h3>
                <p>Full <b>Navitas</b> DC &amp; AC controller line plus <b>White Lightening</b> motor upgrades. More torque, smoother throttle, higher top speed.</p>
              </div>
              <div class="card">
                <div class="icon">🔋</div>
                <h3>Lithium battery upgrades</h3>
                <p>Premium Lithium packs from <b>Bolt Energy</b> and <b>White Lightening</b>'s new line — drop-in replacements, longer range, no acid topping.</p>
              </div>
              <div class="card alt">
                <div class="icon">🔊</div>
                <h3>Sound systems</h3>
                <p>Bluetooth sound bars with LEDs, marine-grade speakers, sub-amp combos. Built to last in the elements.</p>
              </div>
              <div class="card">
                <div class="icon">💺</div>
                <h3>Seats &amp; rear flip seats</h3>
                <p>Re-upholster, swap, or add. Rear flip seats, color-matched quilted vinyl in any color you want.</p>
              </div>
            </div>
          </div>
        </section>

        <section class="alt">
          <div class="container split">
            <div>
              <span class="eyebrow">Pickup &amp; delivery</span>
              <h2>Free within 25 miles. Extended up to 75.</h2>
              <p class="lede-text">Our branded rig and trailer is on the road every week serving {BIZ['service_area']}. Free pickup &amp; delivery for any service within {BIZ['delivery_radius']} miles of Livingston, with an <b>extended service area up to {BIZ['extended_radius']} miles</b> for an additional charge.</p>
              <ul class="checks">
                <li><b>Free</b> roundtrip pickup &amp; delivery within {BIZ['delivery_radius']} miles of our shop</li>
                <li><b>Extended service</b> up to {BIZ['extended_radius']} miles for an additional charge — call us for a flat-rate quote</li>
                <li>Event &amp; resort fleet delivery available across the entire service area</li>
              </ul>
              <a class="btn btn-coral" href="tel:{BIZ['phone_primary'].replace('-','')}">📞 Call {BIZ['phone_primary']}</a>
            </div>
            <div class="photo-block">
              <img src="/assets/photos/truck-towing-carts.jpg" alt="PCGC branded GMC truck towing a trailer with two golf carts" width="1200" height="600" loading="lazy">
            </div>
          </div>
        </section>

        <section>
          <div class="container split reverse">
            <div class="photo-block">
              <img src="/assets/photos/rental-fleet-resort.jpg" alt="Fleet of Yamaha golf carts at Two Creeks Crossing Resort" width="1200" height="675" loading="lazy">
            </div>
            <div>
              <span class="eyebrow">Resort &amp; event service</span>
              <h2>Fleet maintenance for the people who need it most.</h2>
              <p class="lede-text">Resorts, RV parks, events — wherever golf carts run all day, every day. We service whole fleets on regular schedules, plus emergency calls.</p>
              <p>If you run a property in East Texas with carts, let's talk about a maintenance contract that keeps your fleet on the path instead of in the shop.</p>
              <a class="btn btn-ghost" href="/contact/">Get a fleet quote</a>
            </div>
          </div>
        </section>
        """)
        + contact_strip()
        + footer()
    )


def page_about():
    return (
        head(
            "About Polk County Golf Carts",
            "Serving our community as a family owned business since 2020. Read our story, see what customers say, and meet John — owner and lead mechanic.",
            "/about/",
            og_slug="about",
        )
        + header("/about/")
        + dedent(f"""\
        <section class="hero" style="padding-bottom:3rem">
          <div class="container">
            <h1>A family shop that started with one custom cart.</h1>
            <p class="lede">Polk County Golf Carts opened in {BIZ['founded']} when we built our own custom cart and friends started asking if they could buy it. {BIZ['tagline']}.</p>
          </div>
        </section>

        <section>
          <div class="container split">
            <div>
              <span class="eyebrow">Our story</span>
              <h2>Built one cart. Then another. Then a business.</h2>
              <p>We're a family-owned shop in Polk County, Texas — serving our community as a family owned business since {BIZ['founded']}. The business began when we built our own custom golf cart. Before long, friends and neighbors started asking if they could buy our cart — or if we'd build one for them.</p>
              <p>What started as a hobby quickly turned into a thriving business. But our goal hasn't changed: <b>make sure you, our customer, are satisfied</b>. We do that by providing honest and quick service at a reasonable price, with options for every budget.</p>
              <p>You have a lot of choices when it comes to customizing or servicing your golf cart. We're grateful you'd consider us for yours.</p>
              <a class="btn btn-coral" href="tel:{BIZ['phone_primary'].replace('-','')}">📞 Talk to Us today</a>
            </div>
            <div class="photo-block">
              <img src="/assets/photos/owner-john.jpg" alt="John, owner of Polk County Golf Carts, in front of the shop" width="1024" height="768" loading="lazy">
              <div class="caption">John — owner and lead mechanic at Polk County Golf Carts.</div>
            </div>
          </div>
        </section>

        <section class="band" style="padding:0; background:#000;">
          <img src="/assets/photos/shop-exterior.jpg" alt="The Polk County Golf Carts shop building with a teal cart parked out front" style="width:100%; display:block; max-height:480px; object-fit:cover;" loading="lazy">
        </section>

        <section class="alt">
          <div class="container split">
            <div>
              <span class="eyebrow">Why us</span>
              <h2>Family-shop attitude. Dealer-grade work.</h2>
              <p class="lede-text">We're not a chain. We're not a franchise. We're the people next door who happen to be very good at golf carts — and who'll still answer when you call back two years later.</p>
            </div>
            <div>
              <div class="price-box" style="text-align:left">
                <h3 class="mt-0">Why choose PCGC</h3>
                <ul class="checks">
                  <li>BBB Accredited business</li>
                  <li>5.0-star customer reviews</li>
                  <li>Serving our community as a family owned business since {BIZ['founded']}</li>
                  <li>Free pickup &amp; delivery within {BIZ['delivery_radius']} miles; extended up to {BIZ['extended_radius']} miles</li>
                  <li>Service for any make of cart</li>
                  <li>2-year warranty on new Breezy EV carts</li>
                </ul>
                <a class="bbb-badge" href="{BIZ['bbb_url']}" target="_blank" rel="noopener">★ Visit our BBB page</a>
              </div>
            </div>
          </div>
        </section>

        <section class="alt">
          <div class="container">
            <div class="section-head">
              <span class="eyebrow">In their own words</span>
              <h2>What our customers say.</h2>
            </div>
            <div class="tm-grid">
              <div class="tm">
                <div class="stars">★★★★★</div>
                <p class="quote">"We got home from hill country and our golf cart was completely non-functioning. We messaged this golf cart company (located here in Livingston) and the owner came out TO OUR HOUSE this morning and diagnosed our problem within 5 minutes — burnt fuse box. Fast, friendly, and so helpful!"</p>
                <p class="cite">— E. Murray</p>
              </div>
              <div class="tm">
                <div class="stars">★★★★★</div>
                <p class="quote">"Super friendly and knowledgeable — would recommend to anyone. Great experience buying a golf cart."</p>
                <p class="cite">— J. Waite</p>
              </div>
              <div class="tm">
                <div class="stars">★★★★★</div>
                <p class="quote">"If you are ever near or around the Livingston area and are looking for a golf cart or need ANY work done on yours, please don't hesitate to give John a call! He loves what he does and does great work. We won't take ours to anyone else. Such a great family and good friends!"</p>
                <p class="cite">— Carrie</p>
              </div>
              <div class="tm">
                <div class="stars">★★★★★</div>
                <p class="quote">"John is amazing. You can truly see how much he knows about carts — he got my old EZGO going and we couldn't be happier with the outcome. If you need one fixed, John is your man!"</p>
                <p class="cite">— The Bakers</p>
              </div>
              <div class="tm">
                <div class="stars">★★★★★</div>
                <p class="quote">"What phenomenal service! He took an ugly duckling and brought back a swan. If you want superior service by an honest and reliable expert, then John's your man. I called him late on a Friday afternoon and he arrived first thing Saturday morning. He could have easily taken advantage of my circumstances, but never tried to."</p>
                <p class="cite">— Reggie &amp; Marilynn</p>
              </div>
              <div class="tm">
                <div class="stars">★★★★★</div>
                <p class="quote">"Awesome people, awesome carts — thanks for delivery! Ole long John offers top notch service."</p>
                <p class="cite">— B. Bentley</p>
              </div>
              <div class="tm">
                <div class="stars">★★★★★</div>
                <p class="quote">"John with Polk County Golf Carts is awesome — he did a great job painting, lifting, installing wheels and a sound bar on our cart. The before and after is 😳🤩"</p>
                <p class="cite">— L. Brown</p>
              </div>
            </div>
          </div>
        </section>
        """)
        + contact_strip()
        + footer()
    )


def page_contact():
    return (
        head(
            "Contact Polk County Golf Carts",
            f"Reach Polk County Golf Carts in Livingston, TX. Call {BIZ['phone_primary']}, email {BIZ['email']}, or visit us at {BIZ['addr']}.",
            "/contact/",
            og_slug="contact",
        )
        + header("/contact/")
        + dedent(f"""\
        <section class="hero" style="padding-bottom:3rem">
          <div class="container hero-split">
            <div>
              <h1>Let's talk carts.</h1>
              <p class="lede">Call, text, or email. We answer fast — and offer free pickup &amp; delivery within {BIZ['delivery_radius']} miles of Livingston, plus an extended service area up to {BIZ['extended_radius']} miles for an additional charge.</p>
              <div class="hero-ctas">
                <a class="btn btn-coral" href="tel:{BIZ['phone_primary'].replace('-','')}">📞 {BIZ['phone_primary']}</a>
                <a class="btn btn-outline" href="mailto:{BIZ['email']}">Email us</a>
              </div>
            </div>
            <img src="/assets/photos/shop-exterior.jpg" alt="The Polk County Golf Carts shop in Livingston, TX" width="1024" height="500" fetchpriority="high">
          </div>
        </section>

        <section>
          <div class="container">
            <div class="cards">
              <div class="card">
                <div class="icon">📞</div>
                <h3>Call us</h3>
                <p><a href="tel:{BIZ['phone_primary'].replace('-','')}" style="font-weight:600">{BIZ['phone_primary']}</a><br>
                <a href="tel:{BIZ['phone_secondary'].replace('-','')}">{BIZ['phone_secondary']}</a></p>
              </div>
              <div class="card alt">
                <div class="icon">✉️</div>
                <h3>Email</h3>
                <p><a href="mailto:{BIZ['email']}">{BIZ['email']}</a></p>
              </div>
              <div class="card">
                <div class="icon">📍</div>
                <h3>Visit</h3>
                <p><a href="https://maps.google.com/?q={BIZ['addr'].replace(' ','+').replace(',','')}">{BIZ['addr']}</a></p>
              </div>
              <div class="card alt">
                <div class="icon">🕘</div>
                <h3>Hours</h3>
                <p>
                  Tue–Fri · 9a–4p<br>
                  Saturday · 9a–2p<br>
                  <span class="muted">Closed Sun–Mon &amp; holidays. Emergency calls billed at additional rate.</span>
                </p>
              </div>
            </div>
          </div>
        </section>

        <section class="alt">
          <div class="container split">
            <div>
              <span class="eyebrow">Service area</span>
              <h2>Free within 25 miles. Extended up to 75.</h2>
              <p class="lede-text"><b>Free</b> pickup &amp; delivery for any service within {BIZ['delivery_radius']} miles of our Livingston shop. <b>Extended service area</b> up to {BIZ['extended_radius']} miles for an additional charge — give us a call for a flat-rate quote. We proudly serve {BIZ['service_area']} and beyond.</p>
              <ul class="checks">
                <li>Polk County</li>
                <li>San Jacinto County</li>
                <li>Walker County</li>
                <li>Trinity County</li>
                <li>Angelina County</li>
              </ul>
            </div>
            <div>
              <iframe
                src="https://www.google.com/maps?q=1732+FM+3277+Livingston+TX+77351&output=embed"
                width="100%" height="380" style="border:0; border-radius:var(--radius); box-shadow:var(--shadow-lg);"
                loading="lazy" referrerpolicy="no-referrer-when-downgrade"
                title="PCGC location"></iframe>
            </div>
          </div>
        </section>
        """)
        + contact_strip()
        + footer()
    )


def page_privacy():
    return (
        head(
            "Privacy Policy",
            "Privacy policy for Polk County Golf Carts.",
            "/privacy/",
            og_slug="privacy",
        )
        + header("/privacy/")
        + dedent(f"""\
        <section style="padding-top:3rem">
          <div class="container" style="max-width:780px">
            <h1>Privacy Policy</h1>
            <p class="muted">Last updated: June 2026</p>
            <p>Polk County Golf Carts (&ldquo;we,&rdquo; &ldquo;us&rdquo;) respects your privacy. This policy explains what we collect when you use our website and how we use it.</p>

            <h2>Information we collect</h2>
            <p>When you contact us by phone, email, or our contact forms, we collect the information you choose to share — typically your name, phone number, email, and a description of what you need help with.</p>
            <p>Our website may set basic cookies to remember your preferences and measure traffic. We do not sell or rent your information.</p>

            <h2>How we use it</h2>
            <p>We use your information to respond to your inquiry, schedule service or delivery, process financing applications through our partners (Lendmark Financial and Dealer Direct), and follow up on your purchase.</p>

            <h2>Sharing</h2>
            <p>We share information only with the financing partner you choose to apply with, and only with your consent.</p>

            <h2>Contact us</h2>
            <p>Questions about this policy? Email <a href="mailto:{BIZ['email']}">{BIZ['email']}</a> or call <a href="tel:{BIZ['phone_primary'].replace('-','')}">{BIZ['phone_primary']}</a>.</p>
          </div>
        </section>
        """)
        + contact_strip()
        + footer()
    )


# ---------------- Build ---------------- #

PAGES = {
    "index.html":         page_home,
    "carts/index.html":   page_carts,
    "services/index.html":page_services,
    "about/index.html":   page_about,
    "contact/index.html": page_contact,
    "privacy/index.html": page_privacy,
}


def main():
    for rel, fn in PAGES.items():
        out = os.path.join(ROOT, rel)
        os.makedirs(os.path.dirname(out), exist_ok=True)
        with open(out, "w", encoding="utf-8") as f:
            f.write(fn())
        print(f"  wrote {rel}")
    # robots + sitemap
    with open(os.path.join(ROOT, "robots.txt"), "w") as f:
        f.write(
            "User-agent: *\n"
            "Allow: /\n"
            "Disallow: /admin/\n"
            "Disallow: /api/\n"
            "Disallow: /rentals/\n"
            "Sitemap: https://polkcountygolfcarts.com/sitemap.xml\n"
        )
    urls = ["/", "/carts/", "/services/", "/about/", "/contact/", "/privacy/"]
    sm = ['<?xml version="1.0" encoding="UTF-8"?>',
          '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    for u in urls:
        sm.append(f"  <url><loc>https://polkcountygolfcarts.com{u}</loc></url>")
    sm.append("</urlset>")
    with open(os.path.join(ROOT, "sitemap.xml"), "w") as f:
        f.write("\n".join(sm))
    print(f"\nDone. Built {len(PAGES)} pages + robots + sitemap.")


if __name__ == "__main__":
    main()
