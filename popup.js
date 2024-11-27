// popup.js

document.addEventListener('DOMContentLoaded', () => {
  loadToken();
  document.getElementById('summarizeBtn').addEventListener('click', processRepo);
});

function loadToken() {
  chrome.storage.local.get('githubToken', (data) => {
    if (data.githubToken) {
      document.getElementById('token').value = data.githubToken;
    }
  });
}

function saveToken(token) {
  chrome.storage.local.set({ 'githubToken': token });
}

function processRepo() {
  const statusEl = document.getElementById('status');
  const errorEl = document.getElementById('error');
  const loadingEl = document.getElementById('loading');
  const downloadLinkContainer = document.getElementById('downloadLink');
  const downloadFileLink = document.getElementById('downloadFileLink');
  const summaryPreviewEl = document.getElementById('summaryPreview');

  // Reset UI elements
  statusEl.style.display = 'none';
  errorEl.style.display = 'none';
  loadingEl.style.display = 'flex';
  downloadLinkContainer.style.display = 'none';
  summaryPreviewEl.style.display = 'none';
  summaryPreviewEl.textContent = '';

  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    const tab = tabs[0];
    const repoInfo = getRepoInfoFromURL(tab.url);
    if (repoInfo) {
      const extensionsInput = document.getElementById('extensions').value;
      const extensions = extensionsInput.split(',').map(ext => ext.trim()).filter(ext => ext);
      const tokenInput = document.getElementById('token').value.trim();
      if (tokenInput) {
        saveToken(tokenInput);
      }

      fetchRepoTree(repoInfo.owner, repoInfo.repo)
        .then(files => {
          const codeFiles = filterCodeFiles(files, extensions);
          return fetchFilesContent(codeFiles);
        })
        .then(contents => {
          const combinedContent = buildCombinedContent(contents);
          const treeStructure = buildTreeStructure(contents);
          const finalContent = combinedContent + '\n\n===== File Tree =====\n' + treeStructure;
          createDownloadableFile(finalContent, repoInfo.repo);
          loadingEl.style.display = 'none';
          statusEl.textContent = 'File ready for download.';
          statusEl.style.display = 'block';
          downloadLinkContainer.style.display = 'block';

          // Show summary preview (first 100 chars and last 100 chars)
          let previewLength = 100;
          let contentLength = finalContent.length;

          let previewStart = finalContent.substring(0, Math.min(previewLength, contentLength));
          let previewEnd = '';

          if (contentLength > previewLength * 2) {
            previewEnd = finalContent.substring(contentLength - previewLength);
            summaryPreviewEl.textContent = previewStart + '\n\n...\n\n' + previewEnd;
          } else if (contentLength > previewLength) {
            // If content is between 100 and 200 characters, show the entire content
            previewEnd = finalContent.substring(previewLength);
            summaryPreviewEl.textContent = previewStart + previewEnd;
          } else {
            // Content is less than or equal to 100 characters
            summaryPreviewEl.textContent = finalContent;
          }

          summaryPreviewEl.style.display = 'block';
        })
        .catch(error => {
          console.error('Error:', error);
          loadingEl.style.display = 'none';
          errorEl.textContent = error.message;
          errorEl.style.display = 'block';
        });
    } else {
      loadingEl.style.display = 'none';
      errorEl.textContent = 'Not on a valid GitHub repository page.';
      errorEl.style.display = 'block';
    }
  });
}

function getRepoInfoFromURL(url) {
  const regex = /^https:\/\/github\.com\/([^\/]+)\/([^\/]+)(\/|$)/;
  const match = url.match(regex);
  if (match) {
    return { owner: match[1], repo: match[2] };
  }
  return null;
}

function fetchWithToken(url) {
  const token = document.getElementById('token').value.trim();
  const headers = token ? { 'Authorization': `token ${token}` } : {};

  return fetch(url, { headers })
    .then(response => {
      if (response.status === 403) {
        return response.json().then(data => {
          if (data && data.message && data.message.includes('API rate limit exceeded')) {
            throw new Error('GitHub API rate limit exceeded. Please enter a valid GitHub token. Get one from https://github.com/settings/tokens');
          } else {
            throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
          }
        });
      } else if (response.status === 401) {
        throw new Error('Invalid GitHub token provided.');
      } else if (!response.ok) {
        throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
      }
      return response;
    });
}

function fetchRepoTree(owner, repo) {
  // Fetch the default branch
  return fetchWithToken(`https://api.github.com/repos/${owner}/${repo}`)
    .then(response => response.json())
    .then(repoData => {
      const branch = repoData.default_branch;
      return fetchWithToken(`https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`);
    })
    .then(response => response.json())
    .then(treeData => {
      if (treeData.truncated) {
        throw new Error('Repository tree is too large to fetch.');
      }
      if (!treeData.tree || !Array.isArray(treeData.tree)) {
        throw new Error('Unexpected data format received from GitHub API.');
      }
      return treeData.tree;
    })
    .catch(error => {
      if (error.message.includes('404')) {
        throw new Error('Repository not found or is private.');
      } else {
        throw error;
      }
    });
}

function filterCodeFiles(files, extensions) {
  if (!files || !Array.isArray(files)) {
    throw new Error('No files found in the repository.');
  }
  return files.filter(item => {
    return item.type === 'blob' && extensions.some(ext => item.path.endsWith(ext));
  });
}

function fetchFilesContent(files) {
  if (!files || !Array.isArray(files) || files.length === 0) {
    return Promise.resolve([]);
  }

  const MAX_FILE_SIZE = 500000; // 500 KB
  const fetches = files.map(file => {
    return fetchWithToken(file.url)
      .then(response => {
        if (!response.ok) {
          console.warn(`Failed to fetch ${file.path}: ${response.status} ${response.statusText}`);
          return null;
        }
        return response.json();
      })
      .then(blobData => {
        if (blobData && blobData.size <= MAX_FILE_SIZE && blobData.content) {
          const content = atob(blobData.content.replace(/\n/g, ''));
          return { path: file.path, content };
        } else {
          console.warn(`Skipped ${file.path}: File is too large or couldn't be fetched.`);
          return null;
        }
      })
      .catch(error => {
        console.warn(`Error fetching ${file.path}: ${error.message}`);
        return null;
      });
  });
  return Promise.all(fetches).then(results => results.filter(item => item !== null));
}

function buildCombinedContent(filesContent) {
  if (!filesContent || !Array.isArray(filesContent)) {
    throw new Error('No file contents available.');
  }
  let combinedContent = '';
  filesContent.forEach(file => {
    combinedContent += `\n===== ${file.path} =====\n${file.content}\n`;
  });
  return combinedContent;
}

function buildTreeStructure(filesContent) {
  const tree = {};
  filesContent.forEach(file => {
    const parts = file.path.split('/');
    let currentLevel = tree;
    parts.forEach(part => {
      if (!currentLevel[part]) {
        currentLevel[part] = {};
      }
      currentLevel = currentLevel[part];
    });
  });

  function traverse(node, depth = 0) {
    let treeStr = '';
    for (const key in node) {
      treeStr += '  '.repeat(depth) + key + '\n';
      treeStr += traverse(node[key], depth + 1);
    }
    return treeStr;
  }

  return traverse(tree);
}

function createDownloadableFile(content, repoName) {
  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const downloadFileLink = document.getElementById('downloadFileLink');
  downloadFileLink.href = url;
  downloadFileLink.download = `${repoName} code summary.txt`;
  downloadFileLink.textContent = `Download ${repoName} Code Summary`;
}
