// popup.js

document.addEventListener('DOMContentLoaded', () => {
  initializeExtension();
});

async function initializeExtension() {
  await loadToken();
  loadSettings();
  document.getElementById('summarizeBtn').addEventListener('click', processRepo);
  document.getElementById('advancedSettingsBtn').addEventListener('click', toggleAdvancedSettings);
  document.getElementById('saveSettingsBtn').addEventListener('click', saveSettings);

  chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
    const tab = tabs[0];
    const repoInfo = getRepoInfoFromURL(tab.url);
    if (repoInfo) {
      try {
        await fetchAndDisplayExtensions(repoInfo.owner, repoInfo.repo);
      } catch (error) {
        console.error('Error fetching extensions:', error);
        displayError(error.message);
      }
    } else {
      displayError('Not on a valid GitHub repository page.');
    }
  });
}

function loadToken() {
  return new Promise((resolve) => {
    chrome.storage.local.get('githubToken', (data) => {
      if (data.githubToken) {
        document.getElementById('token').value = data.githubToken;
      }
      resolve();
    });
  });
}

function saveToken(token) {
  chrome.storage.local.set({ 'githubToken': token });
}

function loadSettings() {
  chrome.storage.local.get('userSettings', (data) => {
    if (data.userSettings) {
      const settings = data.userSettings;

      // Load selected extensions
      if (settings.selectedExtensions) {
        settings.selectedExtensions.forEach((ext) => {
          const checkbox = document.querySelector(`.extension-checkbox[value="${ext}"]`);
          if (checkbox) {
            checkbox.checked = true;
          }
        });
      }

      // Load maxChars
      if (settings.maxChars !== undefined) {
        document.getElementById('maxChars').value = settings.maxChars;
      }

      // Load includeContent and includeTree
      document.getElementById('includeContent').checked = settings.includeContent !== false; // Default to true
      document.getElementById('includeTree').checked = settings.includeTree !== false; // Default to true
    }
  });
}

function saveSettings() {
  const extensionCheckboxes = document.querySelectorAll('.extension-checkbox');
  const selectedExtensions = Array.from(extensionCheckboxes)
    .filter((checkbox) => checkbox.checked)
    .map((checkbox) => checkbox.value);

  const maxChars = parseInt(document.getElementById('maxChars').value) || 0;
  const includeContent = document.getElementById('includeContent').checked;
  const includeTree = document.getElementById('includeTree').checked;

  const settings = {
    selectedExtensions,
    maxChars,
    includeContent,
    includeTree,
  };

  chrome.storage.local.set({ userSettings: settings }, () => {
    alert('Settings saved successfully.');
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

function displayError(message) {
  const errorEl = document.getElementById('error');
  const loadingEl = document.getElementById('loading');
  loadingEl.style.display = 'none';
  errorEl.textContent = message;
  errorEl.style.display = 'block';
}

async function fetchAndDisplayExtensions(owner, repo) {
  const loadingEl = document.getElementById('loading');
  loadingEl.style.display = 'flex';

  try {
    const files = await fetchRepoTree(owner, repo);

    // Extract extensions and counts
    const extensionCounts = {};
    files.forEach((file) => {
      if (file.type === 'blob') {
        const extMatch = file.path.match(/\.([a-zA-Z0-9]+)$/);
        let ext = '';
        if (extMatch) {
          ext = '.' + extMatch[1];
        } else if (file.path.endsWith('Dockerfile')) {
          ext = 'Dockerfile';
        } else {
          ext = 'No Extension';
        }
        extensionCounts[ext] = (extensionCounts[ext] || 0) + 1;
      }
    });

    // Sort extensions by count
    const sortedExtensions = Object.keys(extensionCounts).sort((a, b) => extensionCounts[b] - extensionCounts[a]);

    // Display checkboxes
    const extensionsContainer = document.getElementById('extensionsContainer');
    extensionsContainer.innerHTML = ''; // Clear existing checkboxes

    sortedExtensions.forEach((ext, index) => {
      const label = document.createElement('label');
      label.style.display = 'flex';
      label.style.alignItems = 'center';
      label.style.fontSize = '14px';
      label.style.marginBottom = '5px';
      label.style.cursor = 'pointer';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'extension-checkbox';
      checkbox.value = ext;
      checkbox.style.marginRight = '10px';
      checkbox.style.width = '16px';
      checkbox.style.height = '16px';

      // Pre-select the top 5 extensions
      if (index < 5) {
        checkbox.checked = true;
      }

      const textNode = document.createTextNode(`${ext} (${extensionCounts[ext]})`);

      label.appendChild(checkbox);
      label.appendChild(textNode);
      extensionsContainer.appendChild(label);
    });

    // Load saved settings after displaying extensions
    loadSettings();

    loadingEl.style.display = 'none';
  } catch (error) {
    loadingEl.style.display = 'none';
    throw error;
  }
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

  chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
    const tab = tabs[0];
    const repoInfo = getRepoInfoFromURL(tab.url);
    if (repoInfo) {
      // Get selected extensions from checkboxes
      const extensionCheckboxes = document.querySelectorAll('.extension-checkbox');
      let extensions = Array.from(extensionCheckboxes)
        .filter((checkbox) => checkbox.checked)
        .map((checkbox) => checkbox.value);

      if (extensions.length === 0) {
        displayError('Please select at least one file extension.');
        return;
      }

      // Get max characters per file
      const maxChars = parseInt(document.getElementById('maxChars').value) || 0;

      const tokenInput = document.getElementById('token').value.trim();
      if (tokenInput) {
        saveToken(tokenInput);
      }

      // Get user selections
      const includeContent = document.getElementById('includeContent').checked;
      const includeTree = document.getElementById('includeTree').checked;

      let repoFiles = []; // Declare repoFiles variable in outer scope

      try {
        const files = await fetchRepoTree(repoInfo.owner, repoInfo.repo);
        repoFiles = files; // Store files for later use

        const codeFiles = filterCodeFiles(files, extensions);
        const largeFiles = identifyLargeFiles(codeFiles);

        if (largeFiles.length > 0) {
          // Allow user to exclude large files
          const proceed = confirm(
            `There are ${largeFiles.length} large files. Do you want to proceed with these files included?`
          );
          if (!proceed) {
            // Exclude large files
            codeFiles = codeFiles.filter((file) => !largeFiles.includes(file));
          }
        }

        const contents = await fetchFilesContent(codeFiles, maxChars);

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
      } catch (error) {
        console.error('Error:', error);
        loadingEl.style.display = 'none';
        displayError(error.message);
      }
    } else {
      loadingEl.style.display = 'none';
      displayError('Not on a valid GitHub repository page.');
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
  const headers = token ? { Authorization: `token ${token}` } : {};

  return fetch(url, { headers }).then((response) => {
    if (response.status === 403) {
      return response.json().then((data) => {
        if (data && data.message && data.message.includes('API rate limit exceeded')) {
          throw new Error(
            'GitHub API rate limit exceeded. Please enter a valid GitHub token. Get one from https://github.com/settings/tokens'
          );
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
    .then((response) => response.json())
    .then((repoData) => {
      const branch = repoData.default_branch;
      return fetchWithToken(
        `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`
      );
    })
    .then((response) => response.json())
    .then((treeData) => {
      if (treeData.truncated) {
        throw new Error('Repository tree is too large to fetch.');
      }
      if (!treeData.tree || !Array.isArray(treeData.tree)) {
        throw new Error('Unexpected data format received from GitHub API.');
      }
      return treeData.tree;
    })
    .catch((error) => {
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
  return files.filter((item) => {
    return (
      item.type === 'blob' &&
      extensions.some((ext) => {
        if (ext === 'Dockerfile') {
          return item.path.endsWith('Dockerfile');
        }
        if (ext === 'No Extension') {
          return !item.path.includes('.');
        }
        return item.path.endsWith(ext);
      })
    );
  });
}

function identifyLargeFiles(files) {
  const LARGE_FILE_SIZE = 100000; // 100 KB
  return files.filter((file) => file.size && file.size > LARGE_FILE_SIZE);
}

function fetchFilesContent(files, maxChars) {
  if (!files || !Array.isArray(files) || files.length === 0) {
    return Promise.resolve([]);
  }

  const MAX_FILE_SIZE = 500000; // 500 KB
  const fetches = files.map((file) => {
    return fetchWithToken(file.url)
      .then((response) => {
        if (!response.ok) {
          console.warn(
            `Failed to fetch ${file.path}: ${response.status} ${response.statusText}`
          );
          return null;
        }
        return response.json();
      })
      .then((blobData) => {
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
      .catch((error) => {
        console.warn(`Error fetching ${file.path}: ${error.message}`);
        return null;
      });
  });
  return Promise.all(fetches).then((results) => results.filter((item) => item !== null));
}

function buildCombinedContent(filesContent) {
  if (!filesContent || !Array.isArray(filesContent)) {
    throw new Error('No file contents available.');
  }
  let combinedContent = '';
  filesContent.forEach((file) => {
    combinedContent += `\n===== ${file.path} =====\n${file.content}\n`;
  });
  return combinedContent;
}

function buildTreeStructure(files) {
  const tree = {};
  files.forEach((file) => {
    const parts = file.path.split('/');
    let currentLevel = tree;
    parts.forEach((part) => {
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
