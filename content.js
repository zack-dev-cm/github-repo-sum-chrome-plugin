// popup.js

document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  document.getElementById('loadExtensionsBtn').addEventListener('click', loadExtensions);
  document.getElementById('summarizeBtn').addEventListener('click', processRepo);
  document.getElementById('advancedSettingsBtn').addEventListener('click', toggleAdvancedSettings);
});

function loadSettings() {
  chrome.storage.local.get(['githubToken', 'userSettings'], (data) => {
    if (data.githubToken) {
      document.getElementById('token').value = data.githubToken;
    }
    if (data.userSettings) {
      const settings = data.userSettings;
      document.getElementById('maxFileSize').value = settings.maxFileSize || 0;
      document.getElementById('maxChars').value = settings.maxChars || 0;
      document.getElementById('lengthyFilesAction').value = settings.lengthyFilesAction || 'include';
      document.getElementById('includeContent').checked = settings.includeContent !== false;
      document.getElementById('includeTree').checked = settings.includeTree !== false;
    }
  });
}

function saveSettings() {
  const settings = {
    maxFileSize: parseInt(document.getElementById('maxFileSize').value) || 0,
    maxChars: parseInt(document.getElementById('maxChars').value) || 0,
    lengthyFilesAction: document.getElementById('lengthyFilesAction').value,
    includeContent: document.getElementById('includeContent').checked,
    includeTree: document.getElementById('includeTree').checked,
    selectedExtensions: Array.from(document.querySelectorAll('.extension-checkbox'))
      .filter(checkbox => checkbox.checked)
      .map(checkbox => checkbox.value)
  };
  chrome.storage.local.set({ 'userSettings': settings });
}

function toggleAdvancedSettings() {
  const advancedSettings = document.getElementById('advancedSettings');
  if (advancedSettings.style.display === 'none' || advancedSettings.style.display === '') {
    advancedSettings.style.display = 'block';
    document.getElementById('advancedSettingsBtn').textContent = 'Hide Advanced Settings';
  } else {
    advancedSettings.style.display = 'none';
    document.getElementById('advancedSettingsBtn').textContent = 'Advanced Settings';
  }
}

function loadExtensions() {
  const tokenInput = document.getElementById('token').value.trim();
  if (tokenInput) {
    saveToken(tokenInput);
  }
  const loadingEl = document.getElementById('loading');
  const errorEl = document.getElementById('error');
  const extensionsContainer = document.getElementById('extensionsContainer');

  errorEl.style.display = 'none';
  loadingEl.style.display = 'flex';

  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    const tab = tabs[0];
    const repoInfo = getRepoInfoFromURL(tab.url);
    if (repoInfo) {
      fetchRepoTree(repoInfo.owner, repoInfo.repo)
        .then(files => {
          loadingEl.style.display = 'none';
          extensionsContainer.style.display = 'block';
          const extensions = getFileExtensions(files);
          displayExtensions(extensions);
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

function displayExtensions(extensions) {
  const extensionsGroup = document.getElementById('extensionsGroup');
  extensionsGroup.innerHTML = '<label>File Extensions to Include:</label>';

  chrome.storage.local.get('userSettings', (data) => {
    const selectedExtensions = data.userSettings ? data.userSettings.selectedExtensions : [];
    extensions.forEach(ext => {
      const label = document.createElement('label');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'extension-checkbox';
      checkbox.value = ext.extension;
      checkbox.checked = selectedExtensions.length ? selectedExtensions.includes(ext.extension) : true;

      const extText = document.createTextNode(` ${ext.extension} (${ext.count})`);

      label.appendChild(checkbox);
      label.appendChild(extText);
      extensionsGroup.appendChild(label);
    });
  });
}

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
  const summaryPreviewEl = document.getElementById('summaryPreview');
  const fileSizeEl = document.getElementById('fileSize');
  const tokenCountEl = document.getElementById('tokenCount');

  // Reset UI elements
  statusEl.style.display = 'none';
  errorEl.style.display = 'none';
  loadingEl.style.display = 'flex';
  downloadLinkContainer.style.display = 'none';
  summaryPreviewEl.style.display = 'none';
  summaryPreviewEl.textContent = '';
  fileSizeEl.style.display = 'none';
  tokenCountEl.style.display = 'none';

  saveSettings();

  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    const tab = tabs[0];
    const repoInfo = getRepoInfoFromURL(tab.url);
    if (repoInfo) {
      const tokenInput = document.getElementById('token').value.trim();
      if (tokenInput) {
        saveToken(tokenInput);
      }

      const settings = {
        maxFileSize: parseInt(document.getElementById('maxFileSize').value) || 0,
        maxChars: parseInt(document.getElementById('maxChars').value) || 0,
        lengthyFilesAction: document.getElementById('lengthyFilesAction').value,
        includeContent: document.getElementById('includeContent').checked,
        includeTree: document.getElementById('includeTree').checked,
        selectedExtensions: Array.from(document.querySelectorAll('.extension-checkbox'))
          .filter(checkbox => checkbox.checked)
          .map(checkbox => checkbox.value)
      };

      let repoFiles = []; // Declare repoFiles variable in outer scope

      fetchRepoTree(repoInfo.owner, repoInfo.repo)
        .then(files => {
          repoFiles = files; // Store files for later use
          const codeFiles = filterCodeFiles(files, settings.selectedExtensions);
          return fetchFilesContent(codeFiles, settings);
        })
        .then(contents => {
          let finalContent = '';
          let combinedContent = '';
          let treeStructure = '';

          if (settings.includeContent) {
            combinedContent = buildCombinedContent(contents);
            finalContent += combinedContent;
          }

          if (settings.includeTree) {
            treeStructure = buildTreeStructure(repoFiles); // Use repoFiles instead of files
            finalContent += '\n\n===== File Tree =====\n' + treeStructure;
          }

          if (!finalContent) {
            finalContent = 'No content selected to include in the summary.';
          }

          createDownloadableFile(finalContent, repoInfo.repo);
          loadingEl.style.display = 'none';
          statusEl.textContent = 'File ready for download.';
          statusEl.style.display = 'block';
          downloadLinkContainer.style.display = 'block';

          // Display file size
          const fileSizeInKB = (new Blob([finalContent]).size / 1024).toFixed(2);
          fileSizeEl.textContent = `File Size: ${fileSizeInKB} KB`;
          fileSizeEl.style.display = 'block';

          // Calculate and display token count
          const estimatedTokens = estimateTokenCount(finalContent);
          tokenCountEl.textContent = `Estimated Token Count: ${estimatedTokens}`;
          tokenCountEl.style.display = 'block';

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

function getFileExtensions(files) {
  const extensionCounts = {};
  files.forEach(file => {
    if (file.type === 'blob') {
      const extMatch = file.path.match(/\.([a-zA-Z0-9]+)$/);
      let extension = '';
      if (extMatch) {
        extension = '.' + extMatch[1];
      } else if (file.path.endsWith('Dockerfile')) {
        extension = 'Dockerfile';
      } else {
        extension = 'No Extension';
      }
      extensionCounts[extension] = (extensionCounts[extension] || 0) + 1;
    }
  });

  const extensions = Object.keys(extensionCounts).map(ext => {
    return { extension: ext, count: extensionCounts[ext] };
  });

  // Sort extensions by count descending
  extensions.sort((a, b) => b.count - a.count);

  return extensions;
}

function filterCodeFiles(files, extensions) {
  if (!files || !Array.isArray(files)) {
    throw new Error('No files found in the repository.');
  }
  return files.filter(item => {
    return item.type === 'blob' && extensions.some(ext => {
      if (ext === 'Dockerfile') {
        return item.path.endsWith('Dockerfile');
      }
      if (ext === 'No Extension') {
        return !item.path.includes('.');
      }
      return item.path.endsWith(ext);
    });
  });
}

function fetchFilesContent(files, settings) {
  if (!files || !Array.isArray(files) || files.length === 0) {
    return Promise.resolve([]);
  }

  const maxFileSizeBytes = settings.maxFileSize > 0 ? settings.maxFileSize * 1024 : Infinity;
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
        if (blobData && blobData.size <= maxFileSizeBytes && blobData.content) {
          let content = atob(blobData.content.replace(/\n/g, ''));
          // Handle lengthy files based on user settings
          if (settings.lengthyFilesAction === 'truncate' && settings.maxChars > 0 && content.length > settings.maxChars * 2) {
            const startContent = content.substring(0, settings.maxChars);
            const endContent = content.substring(content.length - settings.maxChars);
            content = startContent + '\n\n...\n\n' + endContent;
          } else if (settings.lengthyFilesAction === 'exclude' && settings.maxChars > 0 && content.length > settings.maxChars * 2) {
            console.warn(`Excluded ${file.path} due to length.`);
            return null;
          }
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

function buildTreeStructure(files) {
  const tree = {};
  files.forEach(file => {
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
  downloadFileLink.download = `${repoName}-code-summary.txt`;
  downloadFileLink.textContent = `Download ${repoName} Code Summary`;
}

function estimateTokenCount(text) {
  // Estimate token count for LLMs (approximate)
  // Assuming average of 4 characters per token
  const tokens = Math.ceil(text.length / 4);
  return tokens;
}
