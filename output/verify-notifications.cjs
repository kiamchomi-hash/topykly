const { chromium } = require("playwright");
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  await page.goto("http://127.0.0.1:4173/?fakeSocial=1", { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  await page.click("#notificationsButton");
  await page.waitForTimeout(300);
  const result = await page.evaluate(() => {
    const button = document.querySelector("#notificationsButton");
    const panel = document.querySelector("#notificationToasts");
    const rect = panel?.getBoundingClientRect();
    return {
      expanded: button?.getAttribute("aria-expanded"),
      hidden: panel?.hidden,
      ariaHidden: panel?.getAttribute("aria-hidden"),
      text: panel?.innerText?.slice(0, 200),
      rect: rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : null
    };
  });
  console.log(JSON.stringify(result));
  await browser.close();
})();