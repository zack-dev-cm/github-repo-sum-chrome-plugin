import http from 'node:http';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = new URL('../../', import.meta.url);
const locales = ['en', 'ar', 'he', 'zh_CN'];
const catalogs = Object.fromEntries(await Promise.all(locales.map(async locale => [
  locale, JSON.parse(await fs.readFile(new URL(`_locales/${locale}/messages.json`, root), 'utf8')),
])));
const html = await fs.readFile(new URL('popup.html', root), 'utf8');
const sourceHash = createHash('sha256').update(await fs.readFile(new URL('popup.js', root))).digest('hex');
const files = new Map([
  ['/popup.js', ['popup.js', 'text/javascript']],
  ['/popup-i18n.js', ['popup-i18n.js', 'text/javascript']],
  ['/popup-environment.js', ['tests/fixtures/popup-environment.js', 'text/javascript']],
  ['/spinner.gif', ['spinner.gif', 'image/gif']],
]);
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/') {
      const locale = locales.includes(url.searchParams.get('locale')) ? url.searchParams.get('locale') : 'en';
      const scenarios = ['success', 'clipboard-error', 'api-error', 'no-repo', 'empty'];
      const scenario = scenarios.includes(url.searchParams.get('scenario')) ? url.searchParams.get('scenario') : 'success';
      const banner = `<aside dir="ltr" style="border:2px solid #a45b00;padding:8px;margin-bottom:12px;font:12px sans-serif;overflow-wrap:anywhere">
        <strong>POPUP SOURCE FIXTURE</strong><p>Simulated Chrome APIs, GitHub, storage, and clipboard. Installed extension acceptance is unrun.</p>
        <p>Locale: ${locale}. Source SHA256: ${sourceHash}</p>
        <label for="fixture-scenario">Fixture scenario</label><select id="fixture-scenario">${scenarios.map(value => `<option value="${value}" ${scenario === value ? 'selected' : ''}>${value}</option>`).join('')}</select>
        <p id="fixture-scenario-result">Fixture scenario applied: ${scenario}</p><p id="fixture-boundary-result">Checking fixture clipboard adapter</p>
        <p id="fixture-copy-result">No fixture copy yet</p><p id="fixture-alert-result"></p>
      </aside>`;
      const setup = `<script src="popup-environment.js"></script><script src="fixture-bootstrap.js?locale=${locale}&scenario=${scenario}"></script>`;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(html.replace('<body>', `<body>${banner}`).replace('<script src="popup-i18n.js">', `${setup}<script src="popup-i18n.js">`));
    } else if (url.pathname === '/fixture-bootstrap.js') {
      const locale = locales.includes(url.searchParams.get('locale')) ? url.searchParams.get('locale') : 'en';
      const allowed = ['success', 'clipboard-error', 'api-error', 'no-repo', 'empty'];
      const scenario = allowed.includes(url.searchParams.get('scenario')) ? url.searchParams.get('scenario') : 'success';
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(`const fixtureState = installPopupFixture(window, ${JSON.stringify({ locale, scenario, catalogs })});
        document.getElementById('fixture-scenario').addEventListener('change', event => {
          fixtureState.scenario = event.target.value;
          document.getElementById('fixture-scenario-result').textContent = 'Fixture scenario applied: ' + fixtureState.scenario;
        });
        window.alert = text => { document.getElementById('fixture-alert-result').textContent = text; };
        document.getElementById('submitFeedbackBtn').disabled = true;
        document.getElementById('starRepoBtn').disabled = true;
        document.querySelector('#feedbackSection a').removeAttribute('href');`);
    } else if (files.has(url.pathname)) {
      const [path, type] = files.get(url.pathname);
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
      res.end(await fs.readFile(new URL(path, root)));
    } else {
      res.writeHead(404); res.end('Not found');
    }
  } catch (error) {
    res.writeHead(500); res.end('Fixture failed');
    console.error(error);
  }
});
server.listen(Number(process.env.POPUP_FIXTURE_PORT || 8774), '127.0.0.1', () => {
  console.log(`Popup source fixture at http://127.0.0.1:${server.address().port}/`);
  console.log(`Source root: ${fileURLToPath(root)}; popup.js SHA256: ${sourceHash}`);
});
