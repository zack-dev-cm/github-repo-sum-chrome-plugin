// popup.js

document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  document.getElementById('summarizeBtn').addEventListener('click', processRepo);
  document.getElementById('advancedSettingsBtn').addEventListener('click', toggleAdvancedSettings);
  document.getElementById('preScanBtn').addEventListener('click', preScanRepo);
});

function loadSettings() {
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    const tab = tabs[0];
    const repoInfo = getRepoInfoFromURL(tab.url);
    if (repoInfo) {
      const repoKey = `${repoInfo.owner}/${repoInfo.repo}`;
      chrome.storage.local.get([repoKey, 'githubToken', 'saveSettings'], (data) => {
        if (data.githubToken) {
          document.getElementById('token').value = data.githubToken;
        }
        if (data[repoKey]) {
          const settings = data[repoKey];
          document.getElementById('extensions').value = settings.extensions || '.js, .py, .java, .cpp, .md';
          document.getElementById('maxChars').value = settings.maxChars || '0';
          document.getElementById('includeContent').checked = settings.includeContent !== false;
          document.getElementById('includeTree').checked = settings.includeTree !== false;
          document.getElementById('saveSettings').checked = settings.saveSettings !== false; // Load saveSettings state
        } else {
          // If no settings saved for this repo, ensure saveSettings is checked by default
          document.getElementById('saveSettings').checked = true;
        }
      });
    }
  });
}

function saveSettings() {
  const saveSettingsChecked = document.getElementById('saveSettings').checked;
  // Save the state of the 'saveSettings' checkbox regardless
  chrome.storage.local.set({ 'saveSettings': saveSettingsChecked });
  if (!saveSettingsChecked) return;

  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    const tab = tabs[0];
    const repoInfo = getRepoInfoFromURL(tab.url);
    if (repoInfo) {
      const repoKey = `${repoInfo.owner}/${repoInfo.repo}`;
      const settings = {
        extensions: document.getElementById('extensions').value,
        maxChars: document.getElementById('maxChars').value,
        includeContent: document.getElementById('includeContent').checked,
        includeTree: document.getElementById('includeTree').checked,
        saveSettings: saveSettingsChecked // Save the state of the checkbox
      };
      chrome.storage.local.set({ [repoKey]: settings }, () => {
        console.log('Settings saved for', repoKey);
      });
    }
  });
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

function preScanRepo() {
  const errorEl = document.getElementById('error');
  errorEl.style.display = 'none';
  const availableExtensionsEl = document.getElementById('availableExtensions');
  availableExtensionsEl.innerHTML = 'Scanning...';

  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    const tab = tabs[0];
    const repoInfo = getRepoInfoFromURL(tab.url);
    if (repoInfo) {
      fetchRepoTree(repoInfo.owner, repoInfo.repo)
        .then(files => {
          const extensions = new Set();
          files.forEach(file => {
            if (file.type === 'blob') { // Only consider files, not directories
              const ext = getFileExtension(file.path);
              if (ext) extensions.add(ext);
            }
          });
          const extensionsArray = Array.from(extensions).sort();
          availableExtensionsEl.innerHTML = '';
          extensionsArray.forEach(ext => {
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.value = ext;
            checkbox.className = 'extension-checkbox';

            // Check if the extension is already in the extensions field
            const currentExtensions = document.getElementById('extensions').value;
            checkbox.checked = currentExtensions.includes(ext);

            checkbox.addEventListener('change', updateExtensionsField);

            const label = document.createElement('label');
            label.style.display = 'block';
            label.style.fontSize = '14px';
            label.style.cursor = 'pointer';

            label.appendChild(checkbox);
            label.appendChild(document.createTextNode(' ' + ext));
            availableExtensionsEl.appendChild(label);
          });
        })
        .catch(error => {
          console.error('Error during pre-scan:', error);
          availableExtensionsEl.innerHTML = 'Error fetching extensions.';
          errorEl.textContent = error.message;
          errorEl.style.display = 'block';
        });
    } else {
      availableExtensionsEl.innerHTML = '';
      errorEl.textContent = 'Not on a valid GitHub repository page.';
      errorEl.style.display = 'block';
    }
  });
}

function updateExtensionsField() {
  const checkboxes = document.querySelectorAll('#availableExtensions .extension-checkbox');
  const selectedExtensions = Array.from(checkboxes)
    .filter(checkbox => checkbox.checked)
    .map(checkbox => checkbox.value);
  document.getElementById('extensions').value = selectedExtensions.join(', ');
}

function processRepo() {
  const statusEl = document.getElementById('status');
  const errorEl = document.getElementById('error');
  const loadingEl = document.getElementById('loading');
  const downloadLinkContainer = document.getElementById('downloadLink');
  const downloadFileLink = document.getElementById('downloadFileLink');
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

  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    const tab = tabs[0];
    const repoInfo = getRepoInfoFromURL(tab.url);
    if (repoInfo) {
      // Get extensions from the text field
      let extensionsInput = document.getElementById('extensions').value;
      let extensions = extensionsInput
        .split(',')
        .map(ext => ext.trim())
        .filter(ext => ext);

      // Get max characters per file
      const maxChars = parseInt(document.getElementById('maxChars').value) || 0;

      const tokenInput = document.getElementById('token').value.trim();
      if (tokenInput) {
        saveToken(tokenInput);
      }

      // Get user selections
      const includeContent = document.getElementById('includeContent').checked;
      const includeTree = document.getElementById('includeTree').checked;

      // Save settings if checked
      saveSettings();

      let repoFiles = []; // Declare repoFiles variable in outer scope

      fetchRepoTree(repoInfo.owner, repoInfo.repo)
        .then(files => {
          repoFiles = files; // Store files for later use
          const codeFiles = filterCodeFiles(files, extensions);
          return fetchFilesContent(codeFiles, maxChars);
        })
        .then(contents => {
          let finalContent = '';
          let combinedContent = '';
          let treeStructure = '';

          if (includeContent) {
            combinedContent = buildCombinedContent(contents);
            finalContent += combinedContent;
          }

          if (includeTree) {
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

function filterCodeFiles(files, extensions) {
  if (!files || !Array.isArray(files)) {
    throw new Error('No files found in the repository.');
  }
  return files.filter(item => {
    return item.type === 'blob' && extensions.some(ext => {
      if (ext === 'Dockerfile') {
        return item.path.endsWith('Dockerfile');
      }
      return item.path.endsWith(ext);
    });
  });
}

function fetchFilesContent(files, maxChars) {
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
          let content = atob(blobData.content.replace(/\n/g, ''));
          // Truncate content if maxChars is set
          if (maxChars > 0 && content.length > maxChars * 2) {
            const startContent = content.substring(0, maxChars);
            const endContent = content.substring(content.length - maxChars);
            content = startContent + '\n\n...\n\n' + endContent;
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

function getFileExtension(filename) {
  const basename = filename.split(/[\\/]/).pop(); // Extract the file name from the path
  const dotIndex = basename.lastIndexOf('.');
  if (dotIndex === -1) {
    // No dot found, check for special files like 'Dockerfile'
    if (basename === 'Dockerfile') {
      return 'Dockerfile';
    }
    return ''; // No extension
  }
  return basename.slice(dotIndex); // Return the extension including the dot
}

function saveToken(token) {
  chrome.storage.local.set({ 'githubToken': token });
}
