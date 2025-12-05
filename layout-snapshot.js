// layout-snapshot.js
// Maakt een screenshot op basis van de Figma referentie.
// Optioneel: vergelijkt de layout lokaal met pixelmatch (zonder webhook).

const fs = require('fs');
const { PNG } = require('pngjs');
const pixelmatchModule = require('pixelmatch');
const pixelmatch = pixelmatchModule.default || pixelmatchModule;
const { chromium } = require('@playwright/test');

const REFERENCE_PATH = 'reference/home-reference.png';
const CURRENT_PATH = 'reference/home-current.png';
const DIFF_PATH = 'reference/home-diff.png';

const TARGET_URL = process.env.TARGET_URL || 'https://www.travelinventive.nl/';
const PIXEL_SHIFT_TOLERANCE = 12; // maximaal 12 px afwijking, alleen gebruikt in lokale compare

// Flag: als --no-compare is meegegeven, alleen screenshot maken
const onlyScreenshot = process.argv.includes('--no-compare');

function readPng(path) {
  return new Promise((resolve, reject) => {
    fs.createReadStream(path)
      .pipe(new PNG())
      .on('parsed', function () {
        resolve(this);
      })
      .on('error', reject);
  });
}

async function makeCurrentScreenshot(refWidth, refHeight) {
  const browser = await chromium.launch();

  // Context zodat we routes kunnen instellen
  const context = await browser.newContext();

  // Blokkeer CookieCode script en templates (voorkomt de cookiebanner volledig)
  await context.route('**://cdn.cookiecode.nl/**', route => {
    console.log('Blocking CookieCode request:', route.request().url());
    route.abort();
  });

  const page = await context.newPage();

  // Viewport gelijk aan Figma afbeelding
  await page.setViewportSize({ width: refWidth, height: refHeight });

  await page.goto(TARGET_URL, { waitUntil: 'networkidle' });

  // Extra safeguard: verberg eventuele banners die al in de DOM staan
  await page.addStyleTag({
    content: `
      .cookie-banner,
      .cookiebar,
      .cc_banner,
      .cc-window,
      [id*="cookie"],
      [class*="cookie"] {
        display: none !important;
        visibility: hidden !important;
        opacity: 0 !important;
      }
      video, iframe { display: none !important; }
      * {
        animation: none !important;
        transition: none !important;
      }
    `
  });

  // Even wachten tot layout stabiel is
  await page.waitForTimeout(800);
  await fs.promises.mkdir('reference', { recursive: true });

  // Geen fullPage zodat de screenshot precies viewport formaat heeft
  await page.screenshot({
    path: CURRENT_PATH,
    fullPage: false,
  });

  await browser.close();
}

async function compareScreenshots() {
  const ref = await readPng(REFERENCE_PATH);
  const cur = await readPng(CURRENT_PATH);

  if (ref.width !== cur.width || ref.height !== cur.height) {
    console.error(
      `Afmetingen verschillen. Referentie ${ref.width}x${ref.height}, huidige ${cur.width}x${cur.height}.`
    );
    process.exit(1);
  }

  const diff = new PNG({ width: ref.width, height: ref.height });

  // Standaard pixelmatch compare
  const diffPixels = pixelmatch(
    ref.data,
    cur.data,
    diff.data,
    ref.width,
    ref.height,
    {
      threshold: 0.1,
      includeAA: true,
    }
  );

  // Eenvoudige tolerantie op basis van aantal pixels
  const maxAllowedPixels = Math.round(ref.width * PIXEL_SHIFT_TOLERANCE);

  console.log(`Toegestane afwijking: ${maxAllowedPixels} pixels`);
  console.log(`Werkelijke afwijking: ${diffPixels} pixels`);

  await new Promise((resolve, reject) => {
    diff
      .pack()
      .pipe(fs.createWriteStream(DIFF_PATH))
      .on('finish', resolve)
      .on('error', reject);
  });

  if (diffPixels > maxAllowedPixels) {
    console.error(
      `Layout wijkt te veel af. Diff staat in ${DIFF_PATH}.`
    );
    process.exit(1);
  }

  console.log('Layout binnen tolerantie.');
}

async function main() {
  // Eerst referentie inlezen om breedte en hoogte te weten
  if (!fs.existsSync(REFERENCE_PATH)) {
    console.error(`Referentiebestand niet gevonden op ${REFERENCE_PATH}.`);
    process.exit(1);
  }

  const refMeta = await readPng(REFERENCE_PATH);
  console.log(
    `Referentie afmetingen: ${refMeta.width} x ${refMeta.height}`
  );

  // Altijd screenshot maken
  await makeCurrentScreenshot(refMeta.width, refMeta.height);

  // Alleen lokaal vergelijken als --no-compare niet is meegegeven
  if (!onlyScreenshot) {
    await compareScreenshots();
  } else {
    console.log('Alleen screenshot gemaakt, geen lokale vergelijking uitgevoerd.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
