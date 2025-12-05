// layout-snapshot.js
// Script om layout informatie van een pagina te halen met Puppeteer.
// Verwacht omgevingsvariabelen:
// - TARGET_URL (verplicht)
// - SELECTORS_JSON (verplicht) JSON array van:
//   [{ "selector": "h1.hero-title", "name": "Header titel" }, ... ]

const puppeteer = require('puppeteer');

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const url = process.env.TARGET_URL;
  const selectorsJson = process.env.SELECTORS_JSON;

  if (!url) {
    console.error('ERROR: TARGET_URL environment variable is required.');
    process.exitCode = 1;
    return;
  }

  if (!selectorsJson) {
    console.error('ERROR: SELECTORS_JSON environment variable is required.');
    console.error('Example: SELECTORS_JSON=[{"selector":"h1","name":"Header titel"}]');
    process.exitCode = 1;
    return;
  }

  let selectorDefs;
  try {
    selectorDefs = JSON.parse(selectorsJson);
  } catch (err) {
    console.error('ERROR: SELECTORS_JSON is not valid JSON.');
    console.error(err.message);
    process.exitCode = 1;
    return;
  }

  if (!Array.isArray(selectorDefs) || selectorDefs.length === 0) {
    console.error('ERROR: SELECTORS_JSON must be a non empty JSON array.');
    process.exitCode = 1;
    return;
  }

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();

    // Eventueel viewport instellen
    await page.setViewport({ width: 1440, height: 900 });

    // Gebruik domcontentloaded in plaats van networkidle0
    try {
      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 120000,
      });
    } catch (navErr) {
      console.error('WARNING: navigation did not reach domcontentloaded in time:');
      console.error(navErr.message);
      // We proberen toch door te gaan, vaak is de pagina wel bruikbaar geladen
    }

    // Kleine extra wachttijd zonder page.waitForTimeout
    await sleep(5000);

    const layout = await page.evaluate((items) => {
      function boxFor(def) {
        const selector = def.selector;
        const nameOverride = def.name;

        if (!selector) {
          return null;
        }

        const el = document.querySelector(selector);
        if (!el) {
          return {
            name: nameOverride || selector,
            selector,
            found: false,
          };
        }

        const rect = el.getBoundingClientRect();
        const styles = window.getComputedStyle(el);

        return {
          name: nameOverride || selector,
          selector,
          found: true,
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
          right: rect.left + rect.width,
          bottom: rect.top + rect.height,
          centerX: rect.left + rect.width / 2,
          centerY: rect.top + rect.height / 2,
          fontSize: styles.fontSize,
          fontFamily: styles.fontFamily,
          fontWeight: styles.fontWeight,
          display: styles.display,
        };
      }

      return items
        .map((def) => boxFor(def))
        .filter((entry) => entry !== null);
    }, selectorDefs);

    const result = {
      url,
      timestamp: new Date().toISOString(),
      selectorsCount: selectorDefs.length,
      layoutCount: layout.length,
      layout,
    };

    // Output als JSON naar stdout
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error('ERROR while capturing layout:');
    console.error(err);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error('UNHANDLED ERROR:');
  console.error(err);
  process.exitCode = 1;
});
