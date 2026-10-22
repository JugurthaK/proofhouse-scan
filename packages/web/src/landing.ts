// Entry for landing.html: fonts, styles and a few progressive enhancements.
// The page is complete without JavaScript; this only adds polish.
import "@fontsource-variable/inter";
import "@fontsource-variable/manrope";
import "./landing.css";

// Decorative wall of scanner findings behind "The problem" headline.
const FINDINGS: [sev: "c" | "h" | "m" | "l", rule: string, where: string][] = [
  ["c", "aws-access-token", "config/credentials.txt"],
  ["h", "tainted-sql-string", "src/server.js:9"],
  ["h", "CVE-2021-23337", "lodash@4.17.15"],
  ["m", "express-xss", "src/server.js:16"],
  ["h", "dockerfile-user-root", "Dockerfile:1"],
  ["c", "s3-bucket-public-read", "main.tf:12"],
  ["l", "missing-helmet", "src/app.js:3"],
  ["m", "CVE-2024-29041", "express@4.17.1"],
  ["h", "generic-api-key", "test/fixtures.js:8"],
  ["m", "insecure-cookie", "src/session.js:21"],
  ["l", "no-https-redirect", "nginx.conf:14"],
  ["h", "path-traversal", "src/files.js:33"],
  ["c", "jwt-hardcoded-secret", "src/auth.js:5"],
  ["m", "weak-hash-md5", "src/utils.js:48"],
  ["h", "CVE-2022-24999", "qs@6.5.2"],
  ["l", "console-log-secret", "src/debug.js:2"],
  ["m", "open-redirect", "src/login.js:61"],
  ["h", "eval-usage", "scripts/build.js:12"],
];
const LABEL = { c: "CRITICAL", h: "HIGH", m: "MEDIUM", l: "LOW" };

const wall = document.querySelector<HTMLElement>("[data-wall]");
if (wall) {
  for (let row = 0; row < 7; row++) {
    // Rotate each row so the same chips don't line up vertically.
    const items = FINDINGS.map((_, i) => FINDINGS[(i + row * 5) % FINDINGS.length]!);
    const chips = items
      .map(([sev, rule, where]) => `<span class="chip"><b class="${sev}">${LABEL[sev]}</b>${rule} · ${where}</span>`)
      .join("");
    // Two copies so translateX(-50%) loops seamlessly.
    wall.insertAdjacentHTML("beforeend", `<div class="wall-row">${chips}${chips}</div>`);
  }
}

// Copy buttons: `data-copy` holds the text, or `data-copy-from` names an element id.
for (const button of document.querySelectorAll<HTMLButtonElement>("button.copy")) {
  button.addEventListener("click", async () => {
    const from = button.dataset.copyFrom;
    const text = from ? document.getElementById(from)?.textContent : button.dataset.copy;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      return; // Clipboard blocked (insecure origin, permissions): leave the label as is.
    }
    button.textContent = "Copied";
    button.dataset.copied = "";
    setTimeout(() => {
      button.textContent = "Copy";
      delete button.dataset.copied;
    }, 1600);
  });
}

// Sticky header gets a hairline once content scrolls under it.
const header = document.querySelector<HTMLElement>("[data-header]");
if (header) {
  const update = () => header.toggleAttribute("data-scrolled", window.scrollY > 4);
  update();
  window.addEventListener("scroll", update, { passive: true });
}
