// Site-wide behaviour: theme toggle, mobile menu, email assembly and code copy buttons.
// No third-party code, no network requests.
(function () {
  const root = document.documentElement;

  // Theme ------------------------------------------------------------------------------
  const toggle = document.querySelector(".theme-toggle");
  const label = document.querySelector(".theme-toggle__label");
  const current = () => root.dataset.theme === "light" ? "light" : "dark";
  function syncToggle() {
    if (!toggle) return;
    const dark = current() === "dark";
    toggle.setAttribute("aria-checked", String(dark));
    if (label) label.textContent = dark ? "Dark" : "Light";
  }
  function setTheme(theme, persist) {
    root.dataset.theme = theme;
    if (persist) {
      try { localStorage.setItem("theme", theme); } catch (e) { /* storage blocked */ }
    }
    const meta = document.querySelector('meta[name="theme-color"]:not([media])');
    if (meta) meta.setAttribute("content", theme === "light" ? "#f4f1e8" : "#07090b");
    syncToggle();
    window.dispatchEvent(new CustomEvent("themechange", { detail: theme }));
  }
  syncToggle();
  if (toggle) toggle.addEventListener("click", () => setTheme(current() === "dark" ? "light" : "dark", true));
  // Follow the system until the visitor makes an explicit choice.
  matchMedia("(prefers-color-scheme: light)").addEventListener("change", (e) => {
    let saved = null;
    try { saved = localStorage.getItem("theme"); } catch (err) { /* ignore */ }
    if (!saved) setTheme(e.matches ? "light" : "dark", false);
  });

  // Mobile menu ---------------------------------------------------------------------------
  const rail = document.getElementById("rail");
  const button = rail && rail.querySelector(".menu-button");
  const panel = document.getElementById("site-nav");
  if (rail && button && panel) {
    const small = matchMedia("(max-width: 56rem)");
    const focusables = () => [button, ...panel.querySelectorAll("a, button")];
    function setOpen(open) {
      rail.classList.toggle("is-open", open);
      button.setAttribute("aria-expanded", String(open));
      button.querySelector(".menu-button__label").textContent = open ? "Close" : "Menu";
      document.body.style.overflow = open ? "hidden" : "";
      if (open) panel.querySelector("a").focus();
    }
    // Hidden panels must not be tabbable on small screens.
    function syncInert() {
      const hidden = small.matches && !rail.classList.contains("is-open");
      panel.toggleAttribute("inert", hidden);
    }
    button.addEventListener("click", () => { setOpen(!rail.classList.contains("is-open")); syncInert(); });
    small.addEventListener("change", () => { setOpen(false); syncInert(); });
    syncInert();
    document.addEventListener("keydown", (event) => {
      if (!rail.classList.contains("is-open")) return;
      if (event.key === "Escape") { setOpen(false); syncInert(); button.focus(); }
      if (event.key === "Tab") {
        const items = focusables();
        const first = items[0];
        const last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    });
    panel.addEventListener("click", (event) => {
      if (event.target.closest("a")) { setOpen(false); syncInert(); }
    });
  }

  // Email: assembled from a reversed string so it never sits in the HTML as an address -------------
  document.querySelectorAll("[data-email]").forEach((link) => {
    const address = link.dataset.email.split("").reverse().join("");
    link.setAttribute("href", "mailto:" + address);
    const text = link.hasAttribute("data-email-text") ? link : link.querySelector("[data-email-text]");
    if (text) text.textContent = address;
  });

  // Phone: same idea, reversed string assembled client-side ------------------------------------------
  document.querySelectorAll("[data-phone]").forEach((link) => {
    const number = link.dataset.phone.split("").reverse().join("");
    link.setAttribute("href", "tel:+" + number.replace(/\D/g, ""));
    const text = link.hasAttribute("data-phone-text") ? link : link.querySelector("[data-phone-text]");
    if (text) text.textContent = number;
  });

  // Copy buttons on code blocks --------------------------------------------------------------------
  document.querySelectorAll(".codehilite").forEach((block) => {
    if (!navigator.clipboard) return;
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "copy-btn";
    copy.textContent = "Copy";
    copy.setAttribute("aria-label", "Copy code to clipboard");
    copy.addEventListener("click", () => {
      const code = block.querySelector("pre");
      navigator.clipboard.writeText(code ? code.innerText : "").then(() => {
        copy.textContent = "Copied";
        setTimeout(() => { copy.textContent = "Copy"; }, 1500);
      });
    });
    block.appendChild(copy);
  });
})();
