// layout-snapshot.js
// Maakt een screenshot op basis van de Figma referentie
// of gebruikt een handmatig geüploade current-afbeelding bij TARGET_URL=manual
// en splitst zowel referentie als huidige pagina in slices.

const fs = require('fs');
const { PNG } = require('pngjs');
const { chromium } = require('@playwright/test');

const REFERENCE_PATH = 'reference/home-reference.png';
const CURRENT_PATH = 'reference/home-current.png';

const TARGET_URL = process.env.TARGET_URL || 'https://www.travelinventive.nl/';
const SLICE_COUNT = parseInt(process.env.SLICE_COUNT || '10', 10);
const MANUAL_MODE = TARGET_URL === 'manual';

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

  const context = await browser.newContext();

  // Blokkeer CookieCode script en templates
  await context.route('**://cdn.cookiecode.nl/**', route => {
    console.log('Blocking CookieCode request:', route.request().url());
    route.abort();
  });

  const page = await context.newPage();

  await page.setViewportSize({ width: refWidth, height: refHeight });

  await page.goto(TARGET_URL, { waitUntil: 'networkidle' });

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

  await page.waitForTimeout(800);
  await fs.promises.mkdir('reference', { recursive: true });

  await page.screenshot({
    path: CURRENT_PATH,
    fullPage: false,
  });

  await browser.close();
}

function sliceImage(sourcePath, outputPrefix, parts) {
  return new Promise((resolve, reject) => {
    fs.createReadStream(sourcePath)
      .pipe(new PNG())
      .on('parsed', function () {
        const { width, height, data } = this;
        const sliceHeight = Math.ceil(height / parts);

        console.log(
          `Slicing ${sourcePath} (${width}x${height}) in ${parts} delen van ongeveer ${sliceHeight} px hoog`
        );

        let pending = 0;
        let hadSlices = false;

        for (let i = 0; i < parts; i++) {
          const yStart = i * sliceHeight;
          const yEnd = Math.min(yStart + sliceHeight, height);
          const currentSliceHeight = yEnd - yStart;

          if (currentSliceHeight <= 0) {
            continue;
          }

          hadSlices = true;
          pending += 1;

          const png = new PNG({ width, height: currentSliceHeight });

          for (let y = yStart; y < yEnd; y++) {
            const srcStart = (width * y) << 2;
            const srcEnd = srcStart + (width << 2);
            const dstStart = ((y - yStart) * width) << 2;
            data.copy(png.data, dstStart, srcStart, srcEnd);
          }

          const index = i + 1;
          const filename = `${outputPrefix}-${index}.png`;

          const stream = png
            .pack()
            .pipe(fs.createWriteStream(filename));

          stream.on('finish', () => {
            console.log(`Slice opgeslagen: ${filename}`);
            pending -= 1;
            if (pending === 0) {
              resolve();
            }
          });

          stream.on('error', reject);
        }

        if (!hadSlices) {
          resolve();
        }
      })
      .on('error', reject);
  });
}

async function main() {
  if (!fs.existsSync(REFERENCE_PATH)) {
    console.error(`Referentiebestand niet gevonden op ${REFERENCE_PATH}.`);
    process.exit(1);
  }

  const refMeta = await readPng(REFERENCE_PATH);
  console.log(
    `Referentie afmetingen: ${refMeta.width} x ${refMeta.height}`
  );

  if (MANUAL_MODE) {
    console.log('Manual mode actief, gebruik bestaande current afbeelding in reference map.');

    if (!fs.existsSync(CURRENT_PATH)) {
      console.error(
        `Manual mode vereist een bestaand live screenshot op ${CURRENT_PATH}, maar dat bestand is niet gevonden.`
      );
      process.exit(1);
    }
  } else {
    console.log(`Maak live screenshot van ${TARGET_URL}.`);
    await makeCurrentScreenshot(refMeta.width, refMeta.height);
  }

  await sliceImage(REFERENCE_PATH, 'reference/reference_slice', SLICE_COUNT);
  await sliceImage(CURRENT_PATH, 'reference/current_slice', SLICE_COUNT);

  console.log(`Klaar. ${SLICE_COUNT} slices gemaakt voor referentie en current.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
