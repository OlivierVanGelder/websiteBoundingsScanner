// layout-snapshot.js
// Vergelijkt layout met een tolerantie van 12 px verschuiving.

const fs = require('fs');
const { PNG } = require('pngjs');
const pixelmatch = require('pixelmatch');
const { chromium } = require('@playwright/test');

const REFERENCE_PATH = 'reference/home-reference.png';
const CURRENT_PATH = 'reference/home-current.png';
const DIFF_PATH = 'reference/home-diff.png';

const TARGET_URL = process.env.TARGET_URL || 'https://www.travelinventive.nl/';
const PIXEL_SHIFT_TOLERANCE = 12; // maximaal 12 px afwijking

async function makeCurrentScreenshot() {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(TARGET_URL, { waitUntil: 'networkidle' });

  await page.addStyleTag({
    content: `
      .cookie-banner,
      .cookiebar,
      .cc_banner,
      .cc-window { display: none !important; }
      video, iframe { display: none !important; }
    `
  });

  await page.waitForTimeout(800);
  await fs.promises.mkdir('reference', { recursive: true });

  await page.screenshot({
    path: CURRENT_PATH,
    fullPage: true,
  });

  await browser.close();
}

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

async function compareScreenshots() {
  const ref = await readPng(REFERENCE_PATH);
  const cur = await readPng(CURRENT_PATH);

  if (ref.width !== cur.width || ref.height !== cur.height) {
    console.error('Afmetingen verschillen, dat mag niet.');
    process.exit(1);
  }

  const diff = new PNG({ width: ref.width, height: ref.height });

  const diffPixels = pixelmatch(
    ref.data,
    cur.data,
    diff.data,
    ref.width,
    ref.height,
    { threshold: 0.1 }
  );

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
      `Layout wijkt te veel af (>12 px verschuiving vermoed). Diff: ${DIFF_PATH}`
    );
    process.exit(1);
  }

  console.log('Layout binnen 12 px tolerantie 🎉');
}

async function main() {
  await makeCurrentScreenshot();
  await compareScreenshots();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
