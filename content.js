// content.js

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'getRepoInfo') {
      const repoInfo = getRepoInfoFromURL(window.location.href);
      sendResponse(repoInfo);
    }
  });
  
  function getRepoInfoFromURL(url) {
    const regex = /^https:\/\/github\.com\/([^\/]+)\/([^\/]+)(\/|$)/;
    const match = url.match(regex);
    if (match) {
      return { owner: match[1], repo: match[2] };
    }
    return null;
  }
  