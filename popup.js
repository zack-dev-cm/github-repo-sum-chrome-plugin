// popup.js

/**
 * Escape special characters for use in a regular expression.
 * @param {string} string - The string to escape.
 * @returns {string} - The escaped string.
 */
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  document.getElementById('summarizeBtn').addEventListener('click', processRepo);
  document.getElementById('advancedSettingsBtn').addEventListener('click', toggleAdvancedSettings);
  document.getElementById('preScanBtn').addEventListener('click', preScanRepo);
  document.getElementById('submitFeedbackBtn').addEventListener('click', submitFeedback);
});

/**
 * Load settings from Chrome storage and populate the form fields.
 */
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

/**
 * Save current settings to Chrome storage.
 */
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

/**
 * Toggle the visibility of the Advanced Settings section.
 */
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

/**
 * Display an error message to the user.
 * @param {string} message - The error message to display.
 */
function displayError(message) {
  const errorEl = document.getElementById('error');
  const loadingEl = document.getElementById('loading');
  loadingEl.style.display = 'none';
  errorEl.textContent = message;
  errorEl.style.display = 'block';
}

/**
 * Display a status message to the user.
 * @param {string} message - The status message to display.
 */
function displayStatus(message) {
  const statusEl = document.getElementById('status');
  const loadingEl = document.getElementById('loading');
  loadingEl.style.display = 'none';
  statusEl.textContent = message;
  statusEl.style.display = 'block';
}

/**
 * Pre-scan the repository to fetch and display available file extensions.
 */
async function preScanRepo() {
  const errorEl = document.getElementById('error');
  const availableExtensionsEl = document.getElementById('availableExtensions');
  errorEl.style.display = 'none';
  availableExtensionsEl.innerHTML = 'Scanning...';

  chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
    const tab = tabs[0];
    const repoInfo = getRepoInfoFromURL(tab.url);
    if (repoInfo) {
      try {
        const files = await fetchRepoTree(repoInfo.owner, repoInfo.repo);
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
          // To prevent partial matches (e.g., '.js' matching '.jsx'), use a regex
          const regex = new RegExp(`(^|,\\s*)${escapeRegExp(ext)}(,|$)`);
          checkbox.checked = regex.test(currentExtensions);

          checkbox.addEventListener('change', updateExtensionsField);

          const label = document.createElement('label');
          label.style.display = 'block';
          label.style.fontSize = '14px';
          label.style.cursor = 'pointer';

          label.appendChild(checkbox);
          label.appendChild(document.createTextNode(' ' + ext));
          availableExtensionsEl.appendChild(label);
        });
      } catch (error) {
        console.error('Error during pre-scan:', error);
        availableExtensionsEl.innerHTML = 'Error fetching extensions.';
        displayError(error.message);
      }
    } else {
      availableExtensionsEl.innerHTML = '';
      displayError('Not on a valid GitHub repository page.');
    }
  });
}

/**
 * Update the extensions text field based on selected checkboxes.
 */
function updateExtensionsField() {
  const checkboxes = document.querySelectorAll('#availableExtensions .extension-checkbox');
  const selectedExtensions = Array.from(checkboxes)
    .filter(checkbox => checkbox.checked)
    .map(checkbox => checkbox.value);
  document.getElementById('extensions').value = selectedExtensions.join(', ');
}

/**
 * Process the repository: fetch files, summarize, and prepare the download.
 */
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
      // Get extensions from the text field
      let extensionsInput = document.getElementById('extensions').value;
      let extensions = extensionsInput
        .split(',')
        .map(ext => ext.trim())
        .filter(ext => ext);
      
      if (extensions.length === 0) {
        loadingEl.style.display = 'none';
        displayError('Please specify at least one file extension.');
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

      // Save settings if checked
      saveSettings();

      let repoFiles = []; // Declare repoFiles variable in outer scope

      try {
        const files = await fetchRepoTree(repoInfo.owner, repoInfo.repo);
        repoFiles = files; // Store files for later use

        let codeFiles = filterCodeFiles(files, extensions);
        const largeFiles = identifyLargeFiles(codeFiles);

        if (largeFiles.length > 0) {
          // Allow user to exclude large files
          const proceed = confirm(
            `There are ${largeFiles.length} large files. Do you want to proceed with these files included?`
          );
          if (!proceed) {
            // Exclude large files
            codeFiles = codeFiles.filter(file => !largeFiles.includes(file));
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
        displayStatus('File ready for download.');
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

        // Autoscroll to the bottom of the popup to show the summary
        window.scrollTo(0, document.body.scrollHeight);
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

/**
 * Extract repository owner and name from the current URL.
 * @param {string} url - The URL to extract information from.
 * @returns {Object|null} - An object with owner and repo or null if not a valid repo URL.
 */
function getRepoInfoFromURL(url) {
  const regex = /^https:\/\/github\.com\/([^\/]+)\/([^\/]+)(\/|$)/;
  const match = url.match(regex);
  if (match) {
    return { owner: match[1], repo: match[2] };
  }
  return null;
}

/**
 * Fetch data from a given URL with optional GitHub token for authentication.
 * @param {string} url - The URL to fetch data from.
 * @returns {Promise<Response>} - The fetch response.
 */
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

/**
 * Fetch the repository tree from GitHub API.
 * @param {string} owner - Repository owner.
 * @param {string} repo - Repository name.
 * @returns {Promise<Array>} - The repository tree.
 */
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

/**
 * Filter files based on selected extensions.
 * @param {Array} files - The repository files.
 * @param {Array} extensions - The selected file extensions.
 * @returns {Array} - Filtered files.
 */
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

/**
 * Identify large files to prompt the user.
 * @param {Array} files - The filtered repository files.
 * @returns {Array} - Large files exceeding the size threshold.
 */
function identifyLargeFiles(files) {
  const LARGE_FILE_SIZE = 100000; // 100 KB
  return files.filter(file => file.size && file.size > LARGE_FILE_SIZE);
}

/**
 * Fetch content of selected files.
 * @param {Array} files - The filtered repository files.
 * @param {number} maxChars - Maximum characters per file.
 * @returns {Promise<Array>} - Array of file contents.
 */
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

/**
 * Build combined content from all files.
 * @param {Array} filesContent - Array of file contents.
 * @returns {string} - Combined content string.
 */
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

/**
 * Build a directory tree structure from repository files.
 * @param {Array} files - The repository files.
 * @returns {string} - Directory tree as a string.
 */
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

/**
 * Create a downloadable file link.
 * @param {string} content - The combined content.
 * @param {string} repoName - The repository name.
 */
function createDownloadableFile(content, repoName) {
  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const downloadFileLink = document.getElementById('downloadFileLink');
  downloadFileLink.href = url;
  downloadFileLink.download = `${repoName}-code-summary.txt`;
  downloadFileLink.textContent = `Download ${repoName} Code Summary`;
}

/**
 * Estimate the token count for Large Language Models (LLMs).
 * @param {string} text - The text to estimate tokens for.
 * @returns {number} - Estimated token count.
 */
function estimateTokenCount(text) {
  // Estimate token count for LLMs (approximate)
  // Assuming average of 4 characters per token
  const tokens = Math.ceil(text.length / 4);
  return tokens;
}

/**
 * Extract file extension from a filename.
 * @param {string} filename - The filename to extract extension from.
 * @returns {string} - The file extension, including the dot, or special name like 'Dockerfile'.
 */
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

/**
 * Save GitHub token to Chrome storage.
 * @param {string} token - The GitHub Personal Access Token.
 */
function saveToken(token) {
  chrome.storage.local.set({ 'githubToken': token });
}

/**
 * Submit user feedback via a mailto link.
 */
async function submitFeedback() {
  const feedbackText = document.getElementById('feedback').value.trim();
  if (!feedbackText) {
    alert('Please enter your feedback before submitting.');
    return;
  }

  // Replace with your actual email address
  const yourEmail = 'kaisenaiko@gmail.com';
  
  // Validate email format (basic validation)
  if (!validateEmail(yourEmail)) {
    alert('Feedback submission failed: Invalid email address configured.');
    return;
  }

  // Encode feedback for URL
  const encodedFeedback = encodeURIComponent(feedbackText);
  
  // Create mailto link
  const mailtoLink = `mailto:${yourEmail}?subject=GitHub%20Repo%20Summarizer%20Feedback&body=${encodedFeedback}`;
  
  // Open mail client
  window.location.href = mailtoLink;

  // Clear the feedback field after submission
  document.getElementById('feedback').value = '';

  alert('Thank you for your feedback!');
}

/**
 * Basic email format validation.
 * @param {string} email - The email address to validate.
 * @returns {boolean} - True if valid, false otherwise.
 */
function validateEmail(email) {
  const re = /\S+@\S+\.\S+/;
  return re.test(email);
}
