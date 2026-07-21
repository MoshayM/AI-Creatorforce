const playwright = require("D:/project/creatorforce-ai/apps/e2e/node_modules/@playwright/test");
const { chromium } = playwright;
const http = require("http");
const fs = require("fs");

async function main() {
  const loginPayload = JSON.stringify({ email: "ss-live-test@cf.io", password: "TestPass123!" });
  let token = null;

  try {
    const resp = await new Promise((resolve, reject) => {
      const req = http.request({
        hostname: "localhost", port: 4007,
        path: "/api/v1/auth/login", method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(loginPayload) }
      }, (res) => {
        let data = "";
        res.on("data", chunk => data += chunk);
        res.on("end", () => resolve({ status: res.statusCode, body: data }));
      });
      req.on("error", reject);
      req.write(loginPayload);
      req.end();
    });
    console.log("Login status:", resp.status);
    const parsed = JSON.parse(resp.body);
    token = parsed.accessToken || (parsed.data && parsed.data.accessToken) || parsed.token;
    console.log("Token:", token ? token.substring(0, 40) + "..." : "none");
  } catch (e) {
    console.error("Login error:", e.message);
  }

  const shotsDir = "D:/project/creatorforce-ai/shots";
  if (!fs.existsSync(shotsDir)) fs.mkdirSync(shotsDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  await page.goto("http://localhost:3007/projects", { waitUntil: "domcontentloaded", timeout: 30000 });

  if (token) {
    await page.evaluate((t) => { localStorage.setItem("cf_token", t); }, token);
    await context.addCookies([{ name: "cf_token", value: token, domain: "localhost", path: "/", httpOnly: false, secure: false }]);
  }

  await page.goto("http://localhost:3007/projects", { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(3000);

  await page.screenshot({ path: "D:/project/creatorforce-ai/shots/verify-proj-menu.png", fullPage: false });
  console.log("Screenshot 1 saved");

  const menuBtns = await page.locator('button[aria-label="Project options"]').all();
  console.log("⋮ buttons found:", menuBtns.length);

  if (menuBtns.length > 0) {
    const isVisible = await menuBtns[0].isVisible();
    const bbox = await menuBtns[0].boundingBox();
    console.log("Visible:", isVisible, "| bbox:", JSON.stringify(bbox));

    const styles = await menuBtns[0].evaluate((el) => {
      const cs = getComputedStyle(el);
      return { opacity: cs.opacity, visibility: cs.visibility, display: cs.display };
    });
    console.log("Computed styles:", JSON.stringify(styles));

    await menuBtns[0].click();
    await page.waitForTimeout(600);
    await page.screenshot({ path: "D:/project/creatorforce-ai/shots/verify-proj-dropdown.png", fullPage: false });
    console.log("Screenshot 2 (dropdown) saved");
  } else {
    console.log("No ⋮ buttons found");
    const title = await page.title();
    const text = await page.evaluate(() => document.body.innerText.substring(0, 800));
    console.log("Title:", title);
    console.log("Body:", text);
  }

  await browser.close();
}

main().catch(e => { console.error("Fatal:", e.message); process.exit(1); });
