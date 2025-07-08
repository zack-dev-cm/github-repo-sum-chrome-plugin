// background.js (service worker)

/**
 * Listen for messages requesting a GitHub OAuth token.
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'getGithubToken') {
    fetchGithubToken().then(token => {
      sendResponse({ token });
    }).catch(err => {
      sendResponse({ error: err.toString() });
    });
    return true; // Indicates async response
  }
});

/**
 * Launches the GitHub OAuth flow using chrome.identity.
 * This example expects the user to authenticate via Google on GitHub's sign-in page.
 */
function fetchGithubToken() {
  return new Promise((resolve, reject) => {
    const clientId = 'YOUR_GITHUB_CLIENT_ID';
    const redirectUri = chrome.identity.getRedirectURL('github');
    const authUrl =
      `https://github.com/login/oauth/authorize?client_id=${clientId}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&scope=repo&response_type=token`;

    chrome.identity.launchWebAuthFlow(
      { url: authUrl, interactive: true },
      responseUrl => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
          return;
        }
        if (responseUrl) {
          const params = new URL(responseUrl).hash.substring(1);
          const token = new URLSearchParams(params).get('access_token');
          if (token) {
            resolve(token);
          } else {
            reject('No access token found');
          }
        } else {
          reject('No response from OAuth');
        }
      }
    );
  });
}
