import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const html = await fs.readFile(new URL('../popup.html', import.meta.url), 'utf8');
const source = await fs.readFile(new URL('../popup.js', import.meta.url), 'utf8');
let localization = '';
try { localization = await fs.readFile(new URL('../popup-i18n.js', import.meta.url), 'utf8'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const environment = await fs.readFile(new URL('./fixtures/popup-environment.js', import.meta.url), 'utf8');
const locales = ['en', 'ar', 'he', 'zh_CN'];
const catalogs = Object.fromEntries(await Promise.all(locales.map(async locale => [
  locale, JSON.parse(await fs.readFile(new URL(`../_locales/${locale}/messages.json`, import.meta.url), 'utf8')),
])));
const captions = {
  en: ['GitHub Repo Summarizer', 'Advanced Settings', 'Hide Advanced Settings', 'Selected: 0'],
  ar: ['ملخص مستودعات GitHub', 'الإعدادات المتقدمة', 'إخفاء الإعدادات المتقدمة', 'المحدد: 0'],
  he: ['מסכם מאגרי GitHub', 'הגדרות מתקדמות', 'הסתרת הגדרות מתקדמות', 'נבחרו: 0'],
  zh_CN: ['GitHub 仓库摘要工具', '高级设置', '隐藏高级设置', '已选择：0'],
};

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return;
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.fail('Fixture state did not settle.');
}

async function popup(locale, scenario = 'success') {
  const dom = new JSDOM(html, { url: 'https://popup-fixture.invalid/', runScripts: 'outside-only' });
  dom.window.eval(environment);
  const state = dom.window.installPopupFixture(dom.window, { locale, scenario, catalogs });
  if (localization) dom.window.eval(localization);
  dom.window.eval(source);
  await new Promise(resolve => dom.window.document.addEventListener('DOMContentLoaded', resolve, { once: true }));
  await waitFor(() => dom.window.document.getElementById('appVersion').textContent.includes('1.4.3'));
  if (scenario === 'success') await waitFor(() => dom.window.document.querySelectorAll('.directory-checkbox').length === 2);
  return { dom, win: dom.window, doc: dom.window.document, state };
}

for (const locale of locales) {
  test(`${locale}: captions and direction are localized without replacing controls`, async t => {
    const { dom, win, doc } = await popup(locale);
    t.after(() => dom.window.close());
    assert.equal(doc.querySelector('h2').textContent, captions[locale][0]);
    assert.equal(doc.documentElement.lang, locale.replace('_', '-'));
    assert.equal(doc.documentElement.dir, ['ar', 'he'].includes(locale) ? 'rtl' : 'ltr');
    const input = doc.getElementById('extensions');
    const checkbox = doc.getElementById('includeContent');
    input.value = '.sentinel';
    checkbox.checked = false;
    let events = 0;
    input.addEventListener('input', () => events++);
    win.localizePopup();
    assert.equal(doc.getElementById('extensions'), input);
    assert.equal(doc.getElementById('includeContent'), checkbox);
    assert.equal(input.value, '.sentinel');
    assert.equal(checkbox.checked, false);
    input.dispatchEvent(new win.Event('input'));
    assert.equal(events, 1);
    assert.ok(!doc.documentElement.textContent.includes('__MSG_'));
  });

  test(`${locale}: toggles and directory counts stay localized`, async t => {
    const { dom, win, doc } = await popup(locale);
    t.after(() => dom.window.close());
    const button = doc.getElementById('advancedSettingsBtn');
    assert.equal(button.textContent, captions[locale][1]);
    button.click();
    assert.equal(button.textContent, captions[locale][2]);
    win.localizePopup();
    assert.equal(button.textContent, captions[locale][2]);
    assert.equal(doc.getElementById('advancedSettings').style.display, 'block');
    doc.getElementById('clearSelectionBtn').click();
    assert.equal(doc.getElementById('selectedCount').textContent, captions[locale][3]);
    assert.ok([...doc.querySelectorAll('.directory-checkbox')].every(input => !input.checked));
    button.click();
    assert.equal(button.textContent, captions[locale][1]);
  });

  test(`${locale}: actual popup source builds a summary and localized result labels`, async t => {
    const { dom, win, doc, state } = await popup(locale);
    t.after(() => dom.window.close());
    doc.getElementById('summarizeBtn').click();
    await waitFor(() => doc.getElementById('summaryPreview').style.display === 'block');
    assert.ok(doc.getElementById('summaryPreview').textContent.includes('Fixture repository'));
    assert.equal(doc.getElementById('status').textContent, win.chrome.i18n.getMessage('fileReady'));
    assert.equal(doc.getElementById('downloadFileLink').download, 'tiny-repository-code-summary.txt');
    assert.equal(doc.getElementById('downloadFileLink').textContent,
      win.chrome.i18n.getMessage('downloadNamedSummary', ['tiny-repository']));
    assert.ok(doc.getElementById('fileSize').textContent.includes('KB'));
    doc.getElementById('copySummaryBtn').click();
    await waitFor(() => state.copied.length === 1);
    assert.ok(state.copied[0].includes('console.log("fixture")'));
    assert.equal(doc.getElementById('status').textContent, win.chrome.i18n.getMessage('summaryCopied'));
  });
}

test('catalog values are text, and missing or unavailable messages keep readable defaults', async t => {
  const { dom, win, doc } = await popup('en');
  t.after(() => dom.window.close());
  const button = doc.getElementById('advancedSettingsBtn');
  const input = doc.getElementById('token');
  const getter = win.chrome.i18n.getMessage;
  win.chrome.i18n.getMessage = key => key === 'advancedSettings' ? '<img id="catalog-injection" src="x">' : getter(key);
  win.localizePopup();
  assert.equal(button.textContent, '<img id="catalog-injection" src="x">');
  assert.equal(doc.getElementById('catalog-injection'), null);
  assert.equal(doc.getElementById('token'), input);
  win.chrome.i18n.getMessage = () => '';
  assert.equal(win.popupMessage('missing', 'Fallback $1', ['<b>literal</b>']), 'Fallback <b>literal</b>');
  win.chrome.i18n.getMessage = () => { throw new Error('Unavailable fixture API'); };
  assert.equal(win.popupMessage('missing', 'Readable default'), 'Readable default');
  delete win.chrome.i18n;
  assert.equal(win.popupMessage('missing', 'Readable default'), 'Readable default');
});

test('localized validation errors and clipboard failure remain usable', async t => {
  const { dom, win, doc, state } = await popup('ar');
  t.after(() => dom.window.close());
  doc.getElementById('clearSelectionBtn').click();
  doc.getElementById('summarizeBtn').click();
  await waitFor(() => doc.getElementById('error').style.display === 'block');
  assert.equal(doc.getElementById('error').textContent, win.chrome.i18n.getMessage('selectDirectoryError'));
  doc.getElementById('selectAllDirectories').click();
  doc.getElementById('summarizeBtn').click();
  await waitFor(() => doc.getElementById('summaryPreview').style.display === 'block');
  state.scenario = 'clipboard-error';
  doc.getElementById('copySummaryBtn').click();
  await waitFor(() => doc.getElementById('error').style.display === 'block');
  assert.equal(doc.getElementById('error').textContent, win.chrome.i18n.getMessage('copyFailed'));
});

test('every referenced catalog key and substitution exists in all four locales', () => {
  const keys = new Set([
    ...[...html.matchAll(/data-i18n(?:-(?:placeholder|title|alt))?="(\w+)"/g)].map(match => match[1]),
    ...[...source.matchAll(/popupMessage\('([^']+)'/g)].map(match => match[1]),
  ]);
  assert.ok(keys.size >= 60, `Only ${keys.size} localized keys were found.`);
  for (const key of keys) {
    for (const locale of locales) {
      const entry = catalogs[locale][key];
      assert.ok(entry?.message, `${locale}: missing ${key}`);
      for (const [, placeholder] of entry.message.matchAll(/\$([a-z][a-z0-9_]*)\$/gi)) {
        assert.match(entry.placeholders?.[placeholder.toLowerCase()]?.content || '', /^\$[1-9]$/);
      }
      const englishTokens = catalogs.en[key].message.match(/\$[^$]+\$/g) || [];
      assert.deepEqual((entry.message.match(/\$[^$]+\$/g) || []).sort(), englishTokens.slice().sort());
    }
  }
  for (const locale of locales.filter(value => value !== 'en')) {
    assert.notEqual(catalogs[locale].summarizeRepo.message, catalogs.en.summarizeRepo.message);
  }
});

test('Hebrew API failures and commit errors use localized text', async t => {
  const { dom, win, doc } = await popup('he', 'api-error');
  t.after(() => dom.window.close());
  await waitFor(() => doc.getElementById('commitDropdown').textContent === win.chrome.i18n.getMessage('loadingCommitsError'));
  assert.equal(doc.getElementById('availableExtensions').textContent, win.chrome.i18n.getMessage('extensionsError'));
  assert.equal(doc.getElementById('directoriesContainer').textContent, win.chrome.i18n.getMessage('directoriesError'));
  doc.getElementById('summarizeBtn').click();
  await waitFor(() => doc.getElementById('error').textContent === win.chrome.i18n.getMessage('apiError', ['403', 'Forbidden']));
});

test('Chinese invalid-page and empty-repository errors remain readable', async t => {
  const invalid = await popup('zh_CN', 'no-repo');
  t.after(() => invalid.dom.window.close());
  await waitFor(() => invalid.doc.getElementById('commitDropdown').textContent === invalid.win.chrome.i18n.getMessage('noRepoDetected'));
  invalid.doc.getElementById('summarizeBtn').click();
  await waitFor(() => invalid.doc.getElementById('error').textContent === invalid.win.chrome.i18n.getMessage('invalidRepoPage'));
  const empty = await popup('zh_CN', 'empty');
  t.after(() => empty.dom.window.close());
  await waitFor(() => empty.doc.getElementById('directoriesContainer').textContent === empty.win.chrome.i18n.getMessage('noDirectories'));
  empty.doc.getElementById('summarizeBtn').click();
  await waitFor(() => empty.doc.getElementById('error').textContent === empty.win.chrome.i18n.getMessage('selectExtensionError'));
});
