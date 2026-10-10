// Controlled test boundary. This file is never loaded by the extension package.
globalThis.installPopupFixture = function (win, { locale = 'en', catalogs, scenario = 'success' }) {
  const state = { locale, scenario, storage: {}, copied: [], alerts: [], requests: [], blobs: [] };
  const message = (key, substitutions = []) => {
    if (key === '@@ui_locale') return locale;
    if (key === '@@bidi_dir') return /^(ar|he)(-|_|$)/.test(locale) ? 'rtl' : 'ltr';
    const entry = catalogs[locale]?.[key] || catalogs.en[key];
    if (!entry) return '';
    const values = Array.isArray(substitutions) ? substitutions : [substitutions];
    return entry.message.replace(/\$([a-z][a-z0-9_]*)\$/gi, (_, name) => {
      const content = entry.placeholders?.[name.toLowerCase()]?.content || '';
      return content.replace(/\$(\d+)/g, (_, index) => values[Number(index) - 1] ?? '');
    }).replace(/\$(\d+)/g, (_, index) => values[Number(index) - 1] ?? '');
  };
  const activeUrl = () => state.scenario === 'no-repo'
    ? 'https://example.invalid/' : 'https://github.com/fixture/tiny-repository';
  win.chrome = {
    i18n: { getMessage: message, getUILanguage: () => locale.replace('_', '-') },
    runtime: {
      getManifest: () => ({ version: '1.4.3' }),
      sendMessage: (_, callback) => callback({ error: 'Fixture OAuth is disabled' }),
    },
    tabs: {
      query: (_, callback) => callback([{ url: activeUrl() }]),
      create: () => { throw new Error('Opening external tabs is disabled in this fixture.'); },
    },
    storage: { local: {
      get: (keys, callback) => callback(Object.fromEntries(
        (Array.isArray(keys) ? keys : [keys]).map(key => [key, state.storage[key]])
      )),
      set: (items, callback = () => {}) => { Object.assign(state.storage, items); callback(); },
      remove: (key, callback = () => {}) => { delete state.storage[key]; callback(); },
    } },
  };
  const contents = { 'readme-sha': '# Fixture repository\n', 'app-sha': 'console.log("fixture");\n' };
  win.fetch = async url => {
    state.requests.push(String(url));
    if (state.scenario === 'api-error') {
      return { ok: false, status: 403, statusText: 'Forbidden', json: async () => ({}) };
    }
    let payload;
    if (/\/commits\?/.test(url)) {
      payload = [{ sha: 'fixture-commit', commit: { message: 'Fixture commit' } }];
    } else if (/\/git\/trees\//.test(url)) {
      payload = { tree: state.scenario === 'empty' ? [] : [
        { path: 'README.md', type: 'blob', size: 21, url: 'https://api.github.com/repos/fixture/tiny-repository/git/blobs/readme-sha' },
        { path: 'src', type: 'tree' },
        { path: 'src/app.js', type: 'blob', size: 24, url: 'https://api.github.com/repos/fixture/tiny-repository/git/blobs/app-sha' },
      ] };
    } else if (/\/git\/blobs\//.test(url)) {
      const content = contents[String(url).split('/').pop()];
      if (content === undefined) throw new Error('Unexpected fixture blob URL.');
      payload = { size: content.length, content: win.btoa(content) };
    } else if (String(url) === 'https://api.github.com/repos/fixture/tiny-repository') {
      payload = { size: 1024, default_branch: 'main' };
    } else {
      throw new Error('Network request outside the fixture contract.');
    }
    return { ok: true, status: 200, statusText: 'OK', json: async () => payload };
  };
  const fixtureClipboard = {
    writeText: async text => {
      if (state.scenario === 'clipboard-error') throw new Error('Fixture clipboard denied');
      state.copied.push(text);
      const result = win.document.getElementById('fixture-copy-result');
      if (result) result.textContent = `Fixture copied ${text.length} characters`;
    },
  };
  Object.defineProperty(win.navigator, 'clipboard', { configurable: true, value: fixtureClipboard });
  win.document.addEventListener('DOMContentLoaded', () => {
    const boundary = win.document.getElementById('fixture-boundary-result');
    if (boundary) boundary.textContent = `Fixture clipboard adapter installed: ${win.navigator.clipboard === fixtureClipboard}`;
  }, { once: true });
  win.alert = text => state.alerts.push(text);
  win.confirm = () => true;
  if (!win.URL.createObjectURL) {
    win.URL.createObjectURL = blob => { state.blobs.push(blob); return 'blob:fixture-summary'; };
  }
  if (!win.HTMLElement.prototype.scrollIntoView) win.HTMLElement.prototype.scrollIntoView = function () {};
  win.Math.random = () => 1;
  return state;
};
