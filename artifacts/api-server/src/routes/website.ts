import { Router } from "express";

const router = Router();
router.get("/", (_req, res) => {
  res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.type("html").send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Mabhazi — Bus journeys in Zimbabwe</title>
<meta name="description" content="Find bus journeys and share useful travel information with the Mabhazi community.">
<style>
*{box-sizing:border-box}body{margin:0;background:#f1f5f9;color:#14253d;font:18px/1.6 system-ui,sans-serif}
main{max-width:760px;margin:0 auto;padding:72px 24px}header{border-bottom:1px solid #cbd5e1;padding-bottom:32px}
.brand{font-weight:750;font-size:24px;color:#203e63}h1{font-size:clamp(32px,6vw,52px);line-height:1.15;letter-spacing:-.03em;margin:36px 0 24px}
p{max-width:620px;color:#475569}nav{display:flex;flex-wrap:wrap;gap:14px 24px;margin-top:32px}
a{color:#214e80;text-underline-offset:4px}a:focus-visible{outline:3px solid #214e80;outline-offset:5px}
footer{margin-top:48px;font-size:14px;color:#64748b}.note{font-size:16px}
</style></head><body><main><header><div class="brand">Mabhazi</div>
<h1>Find your next bus journey.</h1>
<p>Mabhazi helps you discover bus journeys in Zimbabwe and share route, timetable and travel information with the community.</p>
<p class="note">The Android app is currently in testing. Community information can change; confirm important journey details with your bus operator.</p></header>
<nav aria-label="Information and support">
<a href="/api/privacy">Privacy notice</a><a href="/api/terms">Terms of use</a>
<a href="/api/support">Support</a><a href="/api/delete-account">Delete your account</a>
</nav><footer>Place data © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>, available under the Open Database License.</footer>
</main></body></html>`);
});
for (const page of ["privacy", "terms", "support", "delete-account"]) {
  router.get("/" + page, (_req, res) => res.redirect(302, "/api/" + page));
}
export default router;
