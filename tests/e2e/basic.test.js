import puppeteer from 'puppeteer';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

(async () => {
  const extensionPath = path.resolve(__dirname, '../../');

  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--ignore-certificate-errors',
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });

  const repoPage = await browser.newPage();
  await repoPage.goto('https://github.com/octocat/Hello-World');

  const extensionTarget = await browser.waitForTarget(t => t.type() === 'service_worker');
  const extensionUrl = extensionTarget.url();
  const [, , extensionId] = extensionUrl.split('/');

  const popupPage = await browser.newPage();
  await popupPage.goto(`chrome-extension://${extensionId}/popup.html`);

  // Activate repo page so chrome.tabs.query returns it as the active tab
  await repoPage.bringToFront();

  // Set default options
  await popupPage.evaluate(() => {
    document.getElementById('extensions').value = '.md';
  });

  await popupPage.evaluate(() => {
    document.getElementById('summarizeBtn').click();
  });

  await popupPage.waitForSelector('#summaryPreview', { visible: true, timeout: 60000 });
  const summaryText = await popupPage.$eval('#summaryPreview', el => el.textContent.trim());

  if (!summaryText.length) {
    console.error('Summary is empty');
    process.exit(1);
  }

  await browser.close();
})();
