chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'oauth') {
    const clientId = 'YOUR_GITHUB_CLIENT_ID';
    const clientSecret = 'YOUR_GITHUB_CLIENT_SECRET';
    const redirectUri = chrome.identity.getRedirectURL();
    const authUrl = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=repo`;
    chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true }, (redirect) => {
      if (chrome.runtime.lastError || !redirect) {
        sendResponse({ error: chrome.runtime.lastError?.message || 'OAuth failed' });
        return;
      }
      const url = new URL(redirect);
      const code = url.searchParams.get('code');
      if (!code) {
        sendResponse({ error: 'No code returned' });
        return;
      }
      fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code })
      })
        .then(res => res.json())
        .then(data => {
          if (data.access_token) {
            sendResponse({ token: data.access_token });
          } else {
            sendResponse({ error: 'No access token' });
          }
        })
        .catch(err => sendResponse({ error: err.toString() }));
    });
    return true;
  }
});
