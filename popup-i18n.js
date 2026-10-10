/* Localize text in place so controls, values, and event listeners survive. */
function popupMessage(key, fallback, substitutions = []) {
  const values = Array.isArray(substitutions) ? substitutions : [substitutions];
  try {
    const translated = globalThis.chrome?.i18n?.getMessage(key, values.map(String));
    if (typeof translated === 'string' && translated) return translated;
  } catch {
    // The readable source text also works when the i18n API is unavailable.
  }
  return fallback.replace(/\$([1-9])/g, (match, index) => values[Number(index) - 1] ?? match);
}

function localizePopup() {
  let locale = 'en';
  let direction = 'ltr';
  try {
    locale = chrome.i18n.getUILanguage() || chrome.i18n.getMessage('@@ui_locale') || locale;
    direction = chrome.i18n.getMessage('@@bidi_dir');
  } catch {
    // Use the document's English defaults outside an extension runtime.
  }
  document.documentElement.lang = locale.replace(/_/g, '-');
  document.documentElement.dir = ['ltr', 'rtl'].includes(direction)
    ? direction : (/^(ar|he)(-|_|$)/i.test(locale) ? 'rtl' : 'ltr');

  document.querySelectorAll('[data-i18n]').forEach(element => {
    element.textContent = popupMessage(element.dataset.i18n, element.textContent);
  });
  for (const attribute of ['placeholder', 'title', 'alt']) {
    document.querySelectorAll(`[data-i18n-${attribute}]`).forEach(element => {
      element.setAttribute(attribute, popupMessage(
        element.getAttribute(`data-i18n-${attribute}`), element.getAttribute(attribute) || ''
      ));
    });
  }
}
