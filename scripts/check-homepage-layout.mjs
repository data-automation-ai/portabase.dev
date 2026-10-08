import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('..', import.meta.url)));

const base = process.argv[2] || 'http://127.0.0.1:4173';
const out = resolve('portabase-evidence/homepage-20261003');
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const width of [1440, 1280, 768, 390, 320]) {
    const page = await browser.newPage({ viewport: { width, height: width < 600 ? 844 : 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.locator('.recovery-hero h1').waitFor();
    const result = await page.evaluate(() => {
      const hero = document.querySelector('.recovery-hero');
      const heading = hero.querySelector('h1');
      const cta = hero.querySelector('.button');
      const cases = [...document.querySelectorAll('.story-row-source')].map(el => el.textContent);
      const firstOlder = cases.findIndex(text => !text.includes('2026'));
      return {
        width: innerWidth, overflow: document.documentElement.scrollWidth > innerWidth,
        headline: heading.textContent, italic: getComputedStyle(heading).fontStyle,
        arrowCount: hero.querySelectorAll('.lockout-arrow').length,
        ctaBottom: cta.getBoundingClientRect().bottom,
        firstSectionAfterHero: hero.nextElementSibling.id,
        caseCount: cases.length,
        yearsOrdered: firstOlder < 0 || cases.slice(firstOlder).every(text => !text.includes('2026')),
        firstCase: cases[0],
      };
    });
    await page.screenshot({ path: resolve(out, `homepage-${width}.png`) });
    await page.getByLabel('Sort cases').selectOption('impact');
    const impactFirst = await page.locator('.story-row-source').first().innerText();
    if (result.overflow || result.italic !== 'normal' || result.arrowCount || !result.yearsOrdered || result.firstSectionAfterHero !== 'recovery-overview' || errors.length) {
      throw new Error(JSON.stringify({ ...result, errors }));
    }
    results.push({ ...result, impactFirst, errors });
    await page.close();
  }
  await writeFile(resolve(out, 'layout-results.json'), JSON.stringify({ base, results }, null, 2));
  console.log(JSON.stringify(results, null, 2));
} finally { await browser.close(); }
