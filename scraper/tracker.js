const { chromium } = require("playwright");

/**
 * Fetches CS2 tracker stats from skinflow.gg for a given Steam ID.
 * Returns: { cheating, timeToDamage, winRate } or throws on failure.
 *
 * Usage:
 *   node tracker.js <steamId>
 *   node tracker.js 76561198092358190
 */

async function getTrackerStats(steamId) {
  const url = `https://skinflow.gg/cs2-tracker/${steamId}`;
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded" });

    // Wait for the cheating widget to have a real percentage value
    await page.waitForFunction(
      () => {
        const cards = document.querySelectorAll(".card.p-4");
        for (const card of cards) {
          const title = card.querySelector(".metric-title");
          if (title && /cheating/i.test(title.innerText)) {
            return /\d+%/.test(card.innerText);
          }
        }
        return false;
      },
      { timeout: 180000, polling: 3000 }
    );

    // Extract data from the three widget cards
    const stats = await page.evaluate(() => {
      const result = {};
      const cards = document.querySelectorAll(".card.p-4");

      for (const card of cards) {
        const title = card.querySelector(".metric-title")?.innerText?.trim();
        if (!title) continue;

        const label = card.querySelector(".metric-label")?.innerText?.trim();
        const sub = card.querySelector(".metric-sub")?.innerText?.trim();

        // Extract the main numeric value (e.g. "3%", "990ms", "49%")
        const center = card.querySelector(".mt-3.flex.flex-col");
        const valueText = center?.childNodes?.[0]?.textContent?.trim();

        if (/cheating/i.test(title)) {
          result.cheating = {
            percentage: valueText || null,
            risk: label || null,
            detail: sub || null,
          };
        } else if (/time to damage/i.test(title)) {
          result.timeToDamage = {
            value: valueText || null,
            speed: label || null,
            detail: sub || null,
          };
        } else if (/win rate/i.test(title)) {
          result.winRate = {
            percentage: valueText || null,
            rating: label || null,
            detail: sub || null,
          };
        }
      }

      return result;
    });

    return stats;
  } finally {
    await browser.close();
  }
}

// CLI entry point
if (require.main === module) {
  const steamId = process.argv[2];
  if (!steamId) {
    console.error("Usage: node tracker.js <steamId>");
    process.exit(1);
  }

  console.error(`Fetching stats for ${steamId}...`);
  const start = Date.now();

  getTrackerStats(steamId)
    .then((stats) => {
      console.error(`Done in ${((Date.now() - start) / 1000).toFixed(0)}s`);
      console.log(JSON.stringify(stats, null, 2));
    })
    .catch((err) => {
      console.error("Error:", err.message);
      process.exit(1);
    });
}

module.exports = { getTrackerStats };
