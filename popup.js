// popup.js

/**
 * Escape special characters for use in a regular expression.
 * @param {string} string - The string to escape.
 * @returns {string} - The escaped string.
 */
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

let latestSummary = '';

function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const msg = chrome.i18n.getMessage(el.dataset.i18n);
    if (msg) el.textContent = msg;
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const msg = chrome.i18n.getMessage(el.dataset.i18nPlaceholder);
    if (msg) el.placeholder = msg;
  });
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    const msg = chrome.i18n.getMessage(el.dataset.i18nTitle);
    if (msg) el.title = msg;
  });
  document.querySelectorAll('[data-i18n-alt]').forEach(el => {
    const msg = chrome.i18n.getMessage(el.dataset.i18nAlt);
    if (msg) el.alt = msg;
  });
}

document.addEventListener('DOMContentLoaded', () => {
  applyI18n();
  initializeExtension();
  document.getElementById('summarizeBtn').addEventListener('click', processRepo);
  document.getElementById('advancedSettingsBtn').addEventListener('click', toggleAdvancedSettings);
  document.getElementById('preScanBtn').addEventListener('click', preScanRepo);
  document.getElementById('submitFeedbackBtn').addEventListener('click', submitFeedback);
  document.getElementById('copySummaryBtn').addEventListener('click', copySummaryToClipboard);
  const starBtn = document.getElementById('starRepoBtn');
  if (starBtn) starBtn.addEventListener('click', starRepo);
  const dismissBtn = document.getElementById('dismissStarPromptBtn');
  if (dismissBtn) dismissBtn.addEventListener('click', dismissStarPrompt);
  displayAppVersion(); // Display app version on load

  // Directory Controls
  document.getElementById('directorySearch').addEventListener('input', filterDirectories);
  document.getElementById('selectAllDirectories').addEventListener('change', toggleSelectAllDirectories);
  document.getElementById('clearSelectionBtn').addEventListener('click', clearAllDirectories);

  // Attach listener to token input to save token on change
  document.getElementById('token').addEventListener('input', (e) => {
    saveToken(e.target.value.trim());
  });

  document.getElementById('authMethod').addEventListener('change', toggleAuthMethod);
  const googleBtn = document.getElementById('googleSignInBtn');
  if (googleBtn) googleBtn.addEventListener('click', signInWithGoogle);
  toggleAuthMethod();
});

/**
 * Initialize the extension by loading token and settings, and automatically pre-scan the repository.
 */
async function initializeExtension() {
  await loadToken();
  await preScanRepo(); // Pre-scan populates checkboxes
  await loadSettings(); // Then load previously saved settings
  await displayRepoSize(); // Fetch and display the repository size
  await populateCommitDropdown(); // Load commits into dropdown
}

/**
 * Load GitHub token from Chrome storage.
 */
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

/**
 * Save GitHub token to Chrome storage.
 * @param {string} token - The GitHub Personal Access Token.
 */
function saveToken(token) {
  chrome.storage.local.set({ 'githubToken': token }, () => {
    console.log('GitHub token saved.');
  });
}

/**
 * Load user settings from Chrome storage and apply to the UI.
 */
function loadSettings() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      const tab = tabs[0];
      const repoInfo = getRepoInfoFromURL(tab.url);
      if (repoInfo) {
        const repoKey = `${repoInfo.owner}/${repoInfo.repo}`;
        chrome.storage.local.get([repoKey, 'githubToken'], (data) => {
          if (data.githubToken) {
            document.getElementById('token').value = data.githubToken;
          }
          if (data[repoKey] && data[repoKey].saveSettings) { // Check if saveSettings is true
            const settings = data[repoKey];
            document.getElementById('extensions').value = settings.extensions || '.js, .py, .java, .cpp, .md';
            document.getElementById('maxChars').value = settings.maxChars || '0';
            document.getElementById('includeContent').checked = settings.includeContent !== false;
            document.getElementById('includeTree').checked = settings.includeTree !== false;
            document.getElementById('saveSettings').checked = settings.saveSettings !== false; // Load saveSettings state
            loadSelectedDirectories(settings.selectedDirectories || []);
            
            // After loading settings, update the main extensions field based on saved extensions
            const savedExtensionsArray = settings.extensions
              .split(',')
              .map(ext => ext.trim().toLowerCase())
              .filter(ext => ext);
            
            loadSavedExtensionCheckboxes(savedExtensionsArray);
          } else {
            // If no settings saved for this repo, ensure saveSettings is checked by default
            document.getElementById('saveSettings').checked = true;
          }
          resolve();
        });
      } else {
        resolve();
      }
    });
  });
}

/**
 * Load saved extension checkboxes based on saved extensions array.
 * @param {Array} savedExtensionsArray - Array of saved extensions.
 */
function loadSavedExtensionCheckboxes(savedExtensionsArray) {
  const extensionCheckboxes = document.querySelectorAll('.extension-checkbox');
  extensionCheckboxes.forEach(checkbox => {
    // Check if the extension is in saved list
    if (savedExtensionsArray.includes(checkbox.value)) {
      checkbox.checked = true;
    } else {
      checkbox.checked = false;
    }
  });

  // Update the main extensions input field to reflect the saved checkboxes
  updateMainExtensionsField();
}

/**
 * Save current settings to Chrome storage.
 */
function saveSettings() {
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    const tab = tabs[0];
    const repoInfo = getRepoInfoFromURL(tab.url);
    if (repoInfo) {
      const repoKey = `${repoInfo.owner}/${repoInfo.repo}`;
      const saveSettingsChecked = document.getElementById('saveSettings').checked;
      if (!saveSettingsChecked) return; // Do not save if the checkbox is not checked

      const selectedDirectories = getSelectedDirectories();
      const settings = {
        extensions: document.getElementById('extensions').value,
        maxChars: document.getElementById('maxChars').value,
        includeContent: document.getElementById('includeContent').checked,
        includeTree: document.getElementById('includeTree').checked,
        saveSettings: saveSettingsChecked, // Save the state of the checkbox
        selectedDirectories: selectedDirectories // Save selected directories
      };
      chrome.storage.local.set({ [repoKey]: settings }, () => {
        console.log('Settings saved for', repoKey);
        // Optionally, provide visual feedback instead of alert
        // alert('Settings saved successfully.');
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
    document.getElementById('advancedSettingsBtn').textContent = chrome.i18n.getMessage('advancedSettingsHide');
  } else {
    advancedSettings.style.display = 'none';
    document.getElementById('advancedSettingsBtn').textContent = chrome.i18n.getMessage('advancedSettingsShow');
  }
}

/**
 * Display an error message to the user.
 * @param {string} message - The error message to display.
 */
function displayError(message) {
  const errorEl = document.getElementById('error');
  const loadingEl = document.getElementById('loading');
  const statusEl = document.getElementById('status');
  statusEl.style.display = 'none';
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
  const errorEl = document.getElementById('error');
  loadingEl.style.display = 'none';
  errorEl.style.display = 'none';
  statusEl.textContent = message;
  statusEl.style.display = 'block';
}

/**
 * Randomly show the GitHub star prompt if not previously dismissed.
 */
function maybeShowStarPrompt() {
  const promptEl = document.getElementById('starPrompt');
  if (!promptEl) return;
  const dismissed = localStorage.getItem('starPromptDismissed');
  if (dismissed) return;
  if (Math.random() < 0.3) {
    promptEl.style.display = 'block';
  }
}

/**
 * Attempt to star the repository on GitHub or open the repo page.
 */
function starRepo() {
  const repoUrl = 'https://github.com/zack-dev-cm/github-repo-sum-chrome-plugin';
  const token = document.getElementById('token').value.trim();
  if (!token) {
    chrome.tabs.create({ url: repoUrl });
    return;
  }
  fetch('https://api.github.com/user/starred/zack-dev-cm/github-repo-sum-chrome-plugin', {
    method: 'PUT',
    headers: {
      'Authorization': `token ${token}`,
      'Accept': 'application/vnd.github.v3+json'
    }
  }).then(resp => {
    if (resp.status === 204) {
      alert('Repository starred! Thank you.');
    } else {
      chrome.tabs.create({ url: repoUrl });
    }
  }).catch(() => {
    chrome.tabs.create({ url: repoUrl });
  });
}

/**
 * Dismiss the GitHub star prompt.
 */
function dismissStarPrompt() {
  const promptEl = document.getElementById('starPrompt');
  if (promptEl) {
    promptEl.style.display = 'none';
    localStorage.setItem('starPromptDismissed', 'true');
  }
}


/**
 * Display the repository size when the extension loads.
 */
async function displayRepoSize() {
  const statusEl = document.getElementById('status');
  const errorEl = document.getElementById('error');
  const repoSizeEl = document.getElementById('repoSize');
  const loadingEl = document.getElementById('loading');

  loadingEl.style.display = 'flex'; // Show loading spinner
  repoSizeEl.style.display = 'none'; // Hide the size element until it's fetched

  try {
    const repoInfo = await getRepoInfoFromCurrentTab();
    if (repoInfo) {
      const repoSizeMB = await getRepoSize(repoInfo.owner, repoInfo.repo);
      repoSizeEl.textContent = `Repo Size: ${repoSizeMB.toFixed(2)} MB`;
      repoSizeEl.style.display = 'block'; // Show the repo size once it's fetched
      loadingEl.style.display = 'none'; // Hide the loading spinner
    } else {
      throw new Error('Unable to retrieve repository information.');
    }
  } catch (error) {
    console.error('Error fetching repository size:', error);
    loadingEl.style.display = 'none';
    errorEl.textContent = 'Error fetching repository size.';
    errorEl.style.display = 'block';
  }
}

/**
 * Extract repository owner and name from the current URL (active tab).
 * @returns {Object|null} - An object with owner and repo or null if not a valid repo URL.
 */
function getRepoInfoFromCurrentTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      const repoInfo = getRepoInfoFromURL(tab.url); // Get repo info from the current tab's URL
      resolve(repoInfo);
    });
  });
}


/**
 * Pre-scan the repository to fetch and display available file extensions and directories.
 */
async function preScanRepo() {
  const errorEl = document.getElementById('error');
  const availableExtensionsEl = document.getElementById('availableExtensions');
  const directoriesContainerEl = document.getElementById('directoriesContainer');
  const selectedCountEl = document.getElementById('selectedCount');
  errorEl.style.display = 'none';
  const scanningText = chrome.i18n.getMessage('scanningText');
  availableExtensionsEl.innerHTML = scanningText;
  directoriesContainerEl.innerHTML = scanningText;
  selectedCountEl.textContent = chrome.i18n.getMessage('selectedCount', '0');

  chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
    const tab = tabs[0];
    const repoInfo = getRepoInfoFromURL(tab.url);
    if (repoInfo) {
      try {
        const commit = document.getElementById('commit').value.trim();
        const files = await fetchRepoTree(repoInfo.owner, repoInfo.repo, commit);
        // Extract extensions and counts
        const extensionCounts = {};
        const excludedExtensions = [
          // Archives
          '.zip', '.rar', '.tar', '.gz', '.7z', '.exe', '.dll',
          // Images
          '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.svg', '.webp', '.tiff', '.ico', '.psd',
          // Media
          '.mp4', '.mp3', '.avi', '.mkv', '.flac', '.mov', '.wmv',
          // Documents
          '.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx', '.csv',
          // Others
          '.iso', '.dmg', 'No Extension'
        ];

        files.forEach((file) => {
          if (file.type === 'blob') {
            const extMatch = file.path.match(/\.([a-zA-Z0-9]+)$/);
            let ext = '';
            if (extMatch) {
              ext = '.' + extMatch[1].toLowerCase();
            } else if (file.path.endsWith('Dockerfile')) {
              ext = 'Dockerfile';
            } else {
              ext = 'No Extension';
            }
            // Exclude unwanted extensions
            if (excludedExtensions.includes(ext)) {
              return;
            }
            extensionCounts[ext] = (extensionCounts[ext] || 0) + 1;
          }
        });

        // Sort extensions by count
        const sortedExtensions = Object.keys(extensionCounts).sort((a, b) => extensionCounts[b] - extensionCounts[a]);

        // Identify top 10 most common extensions for pre-selection or highlighting
        const topExtensions = sortedExtensions.slice(0, 10);

        // Display extension checkboxes
        availableExtensionsEl.innerHTML = ''; // Clear existing checkboxes
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

          // Pre-select top extensions by default
          checkbox.checked = topExtensions.includes(ext);

          const textNode = document.createTextNode(`${ext} (${extensionCounts[ext]})`);
          if (topExtensions.includes(ext)) {
            // Highlight top extensions
            // Using a bullet or similar marker for highlighting
            textNode.textContent = `• ${ext} (${extensionCounts[ext]})`;
          }

          label.appendChild(checkbox);
          label.appendChild(textNode);
          availableExtensionsEl.appendChild(label);
        });

        // Extract directories
        const directories = extractDirectories(files);

        // Always include root directory '/'
        if (files.some(file => !file.path.includes('/'))) {
          directories.push('/'); // Add root if there are files in the root
        }

        // Remove duplicates and sort
        const uniqueDirectories = Array.from(new Set(directories)).sort();

        // Display directory checkboxes
        directoriesContainerEl.innerHTML = ''; // Clear existing checkboxes
        if (uniqueDirectories.length > 0) {
          uniqueDirectories.forEach((dir) => {
            const label = document.createElement('label');

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'directory-checkbox';
            checkbox.value = dir;
            checkbox.checked = true; // All directories checked by default

            label.appendChild(checkbox);
            label.appendChild(document.createTextNode(' ' + (dir === '/' ? 'Root Directory (/)': dir)));

            directoriesContainerEl.appendChild(label);
          });

          // Update selected count
          updateSelectedCount();
        } else {
          // If no directories, inform the user and hide the directories selection
          directoriesContainerEl.innerHTML = '<em>No directories found. All files with specified extensions will be included.</em>';
          document.getElementById('selectAllContainer').style.display = 'none';
          document.getElementById('directorySearch').style.display = 'none';
          document.getElementById('clearSelectionBtn').style.display = 'none';
          selectedCountEl.textContent = chrome.i18n.getMessage('selectedCount', '0');
        }

        // After populating extensions and directories, update the main extensions field
        updateMainExtensionsField();

        // Attach event listeners to dynamic checkboxes
        attachCheckboxEventListeners();

      } catch (error) {
        console.error('Error during pre-scan:', error);
        availableExtensionsEl.innerHTML = 'Error fetching extensions.';
        directoriesContainerEl.innerHTML = 'Error fetching directories.';
        displayError(error.message);
      }
    } // End of if (repoInfo)
  }); // End of chrome.tabs.query
}

/**
 * Extract unique directories from the repository tree.
 * @param {Array} files - The repository tree files.
 * @returns {Array} - List of unique directories.
 */
function extractDirectories(files) {
  const directories = new Set();
  files.forEach(file => {
    if (file.type === 'tree') { // 'tree' indicates a directory
      directories.add(file.path);
    } else {
      // Extract directory from file path
      const dir = file.path.split('/').slice(0, -1).join('/');
      if (dir) directories.add(dir);
    }
  });
  return Array.from(directories).sort();
}

/**
 * Load selected directories into the UI.
 * @param {Array} selectedDirectories - List of directories to select.
 */
function loadSelectedDirectories(selectedDirectories) {
  document.querySelectorAll('.directory-checkbox').forEach(checkbox => {
    checkbox.checked = selectedDirectories.includes(checkbox.value);
  });

  // Update Select All checkbox based on individual selections
  updateSelectAllCheckbox();

  // Update selected count
  updateSelectedCount();
}

/**
 * Get list of selected directories from the UI.
 * @returns {Array} - List of selected directories.
 */
function getSelectedDirectories() {
  const checkboxes = document.querySelectorAll('.directory-checkbox');
  const selected = Array.from(checkboxes)
    .filter(checkbox => checkbox.checked)
    .map(checkbox => checkbox.value);
  return selected;
}

/**
 * Update the main extensions input field based on the checked extension checkboxes.
 */
function updateMainExtensionsField() {
  const extensionCheckboxes = document.querySelectorAll('.extension-checkbox');
  const selectedExtensions = Array.from(extensionCheckboxes)
    .filter(checkbox => checkbox.checked)
    .map(checkbox => checkbox.value);
  document.getElementById('extensions').value = selectedExtensions.join(', ');
}

/**
 * Attach event listeners to dynamically created checkboxes and other settings inputs.
 */
function attachCheckboxEventListeners() {
  const saveIfNeeded = () => {
    if (document.getElementById('saveSettings').checked) {
      saveSettings();
    }
  };

  // Attach listeners to directory checkboxes
  document.querySelectorAll('.directory-checkbox').forEach(checkbox => {
    checkbox.addEventListener('change', () => {
      saveIfNeeded();
      updateSelectAllCheckbox();
      updateSelectedCount();
    });
  });

  // Attach listeners to extension checkboxes
  document.querySelectorAll('.extension-checkbox').forEach(checkbox => {
    checkbox.addEventListener('change', () => {
      updateMainExtensionsField();
      saveIfNeeded();
    });
  });

  // Attach listeners to other settings inputs
  document.getElementById('extensions').addEventListener('input', saveIfNeeded);
  document.getElementById('maxChars').addEventListener('input', saveIfNeeded);
  document.getElementById('includeContent').addEventListener('change', saveIfNeeded);
  document.getElementById('includeTree').addEventListener('change', saveIfNeeded);

  // Attach listener to 'saveSettings' checkbox
  document.getElementById('saveSettings').addEventListener('change', saveSettings);
}

// Fetch repository details to get the size
async function getRepoSize(owner, repo) {
  const response = await fetchWithToken(`https://api.github.com/repos/${owner}/${repo}`);
  const repoData = await response.json();
  return repoData.size / 1024; // Convert size from KB to MB
}

// Fetch recent commits for a repository
async function fetchRecentCommits(owner, repo, limit = 10) {
  const response = await fetchWithToken(`https://api.github.com/repos/${owner}/${repo}/commits?per_page=${limit}`);
  const data = await response.json();
  if (!Array.isArray(data)) {
    throw new Error('Unable to fetch commits');
  }
  return data;
}

// Populate commit dropdown with recent commits
async function populateCommitDropdown() {
  const dropdown = document.getElementById('commitDropdown');
  if (!dropdown) return;
  dropdown.innerHTML = '<option>Loading commits...</option>';
  chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
    const tab = tabs[0];
    const repoInfo = getRepoInfoFromURL(tab.url);
    if (!repoInfo) {
      dropdown.innerHTML = '<option>No repo detected</option>';
      return;
    }
    try {
      const commits = await fetchRecentCommits(repoInfo.owner, repoInfo.repo);
      dropdown.innerHTML = '<option value="">Latest</option>';
      commits.forEach(commit => {
        const sha = commit.sha;
        const message = commit.commit && commit.commit.message ? commit.commit.message.split('\n')[0] : sha;
        const option = document.createElement('option');
        option.value = sha;
        option.textContent = `${sha.substring(0,7)} - ${message}`;
        dropdown.appendChild(option);
      });
    } catch (err) {
      console.error(err);
      dropdown.innerHTML = '<option>Error loading commits</option>';
    }
  });

  dropdown.addEventListener('change', (e) => {
    document.getElementById('commit').value = e.target.value;
  });
}


/**
 * Process the repository: fetch files, summarize, and prepare the download.
 */
async function processRepo() {
  const statusEl = document.getElementById('status');
  const errorEl = document.getElementById('error');
  const loadingEl = document.getElementById('loading');
  const downloadLinkContainer = document.getElementById('downloadLink');
  const downloadFileLink = document.getElementById('downloadFileLink');
  const summaryPreviewEl = document.getElementById('summaryPreview');
  const copySummaryBtn = document.getElementById('copySummaryBtn');
  const fileSizeEl = document.getElementById('fileSize');
  const tokenCountEl = document.getElementById('tokenCount');

  // Reset UI elements
  statusEl.style.display = 'none';
  errorEl.style.display = 'none';
  loadingEl.style.display = 'flex';
  downloadLinkContainer.style.display = 'none';
  summaryPreviewEl.style.display = 'none';
  summaryPreviewEl.textContent = '';
  copySummaryBtn.style.display = 'none';
  fileSizeEl.style.display = 'none';
  tokenCountEl.style.display = 'none';

  chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
    const tab = tabs[0];
    const repoInfo = getRepoInfoFromURL(tab.url);
    if (repoInfo) {
      try {
        const commit = document.getElementById('commit').value.trim();
        const files = await fetchRepoTree(repoInfo.owner, repoInfo.repo, commit);

        // Fetch repository size and display it
        const repoSizeMB = await getRepoSize(repoInfo.owner, repoInfo.repo);
        document.getElementById('repoSize').textContent = `Repository size: ${repoSizeMB.toFixed(2)} MB`;

        // Extract directories
        const directories = extractDirectories(files);

        let selectedDirectories = [];
        if (directories.length > 0) {
          selectedDirectories = getSelectedDirectories();
          if (selectedDirectories.length === 0) {
            throw new Error('Please select at least one directory to include in the summary.');
          }
        } else {
          // No directories found; include all files with specified extensions
          selectedDirectories = []; // Empty array signifies all directories are included
        }

        // Get extensions from the main input field
        let extensionsInput = document.getElementById('extensions').value;
        let extensions = extensionsInput
          .split(',')
          .map(ext => ext.trim().toLowerCase())
          .filter(ext => ext);
        
        // Handle 'No Extension'
        extensions = extensions.filter(ext => ext.toLowerCase() !== 'no extension');

        if (extensions.length === 0) {
          throw new Error('Please specify at least one file extension.');
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

        let codeFiles = filterCodeFiles(files, extensions, selectedDirectories);
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
          treeStructure = buildTreeStructure(files); // Use all files for the tree
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
        latestSummary = finalContent;
        copySummaryBtn.style.display = 'block';

        // Scroll to the copy button and center it in the view
        copySummaryBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });

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
  // Improved regex to handle URLs with additional paths or parameters
  const regex = /^https:\/\/github\.com\/([^\/]+)\/([^\/?#]+)(?:[\/?#].*)?$/;
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
function fetchRepoTree(owner, repo, ref) {
  const refPromise = ref
    ? Promise.resolve(ref)
    : fetchWithToken(`https://api.github.com/repos/${owner}/${repo}`)
        .then(response => response.json())
        .then(repoData => repoData.default_branch);
  return refPromise
    .then(resolvedRef =>
      fetchWithToken(`https://api.github.com/repos/${owner}/${repo}/git/trees/${resolvedRef}?recursive=1`)
    )
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
 * Filter files based on selected extensions and directories.
 * @param {Array} files - The repository tree files.
 * @param {Array} extensions - The selected file extensions.
 * @param {Array} selectedDirectories - The selected directories to include.
 * @returns {Array} - Filtered files.
 */
function filterCodeFiles(files, extensions, selectedDirectories) {
  if (!files || !Array.isArray(files)) {
    throw new Error('No files found in the repository.');
  }
  return files.filter(item => {
    // Check if the file is a blob (file)
    if (item.type !== 'blob') return false;

    // Check file extension
    const hasValidExtension = extensions.some(ext => {
      if (ext === 'Dockerfile') {
        return item.path.endsWith('Dockerfile');
      }
      return item.path.toLowerCase().endsWith(ext);
    });

    if (!hasValidExtension) return false;

    // If there are selected directories, check if the file is within them
    if (selectedDirectories.length > 0) {
      return selectedDirectories.some(dir => {
        if (dir === '/') {
          // Root directory: include all files not in any subdirectory
          return !item.path.includes('/');
        }
        // Ensure that dir is a prefix of the file path
        return item.path === dir || item.path.startsWith(dir + '/');
      });
    } else {
      // No directories selected, include all files with valid extensions
      return true;
    }
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

function copySummaryToClipboard() {
  if (!latestSummary) {
    displayError('No summary available to copy.');
    return;
  }
  navigator.clipboard.writeText(latestSummary)
    .then(() => {
      displayStatus('Summary copied to clipboard.');
      const statusEl = document.getElementById('status');
      statusEl.classList.add('highlight');
      statusEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(() => {
        statusEl.classList.remove('highlight');
      }, 2000);
      maybeShowStarPrompt();
    })
    .catch(err => {
      console.error('Clipboard copy failed:', err);
      displayError('Failed to copy summary to clipboard.');
    });
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

/**
 * Display the app version in the popup.
 */
function displayAppVersion() {
  const versionEl = document.getElementById('appVersion');
  if (versionEl) {
    const manifestData = chrome.runtime.getManifest();
    versionEl.textContent = chrome.i18n.getMessage('versionPrefix', manifestData.version);
  }
}

/**
 * Display the number of selected directories.
 */
function updateSelectedCount() {
  const selectedCountEl = document.getElementById('selectedCount');
  const selected = getSelectedDirectories().length;
  selectedCountEl.textContent = chrome.i18n.getMessage('selectedCount', selected.toString());
}

/**
 * Toggle select all directories based on the "Select All" checkbox.
 */
function toggleSelectAllDirectories() {
  const selectAllCheckbox = document.getElementById('selectAllDirectories');
  const isChecked = selectAllCheckbox.checked;
  document.querySelectorAll('.directory-checkbox').forEach(checkbox => {
    checkbox.checked = isChecked;
  });
  saveSettings();
  updateSelectedCount();
}

/**
 * Clear all directory selections.
 */
function clearAllDirectories() {
  document.querySelectorAll('.directory-checkbox').forEach(checkbox => {
    checkbox.checked = false;
  });
  document.getElementById('selectAllDirectories').checked = false;
  saveSettings();
  updateSelectedCount();
}

/**
 * Update the state of the "Select All" checkbox based on individual selections.
 */
function updateSelectAllCheckbox() {
  const selectAllCheckbox = document.getElementById('selectAllDirectories');
  const total = document.querySelectorAll('.directory-checkbox').length;
  const checked = document.querySelectorAll('.directory-checkbox:checked').length;
  if (checked === total) {
    selectAllCheckbox.checked = true;
    selectAllCheckbox.indeterminate = false;
  } else if (checked > 0) {
    selectAllCheckbox.checked = false;
    selectAllCheckbox.indeterminate = true;
  } else {
    selectAllCheckbox.checked = false;
    selectAllCheckbox.indeterminate = false;
  }
}

/**
 * Filter directories based on search input.
 */
function filterDirectories() {
  const searchTerm = document.getElementById('directorySearch').value.toLowerCase();
  document.querySelectorAll('.directory-checkbox').forEach(checkbox => {
    const label = checkbox.parentElement;
    if (checkbox.value.toLowerCase().includes(searchTerm)) {
      label.style.display = 'flex';
    } else {
      label.style.display = 'none';
    }
  });
}

/**
 * Display an error message to the user.
 * @param {string} message - The error message to display.
 */
function displayError(message) {
  const errorEl = document.getElementById('error');
  const loadingEl = document.getElementById('loading');
  const statusEl = document.getElementById('status');
  statusEl.style.display = 'none';
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
  const errorEl = document.getElementById('error');
  loadingEl.style.display = 'none';
  errorEl.style.display = 'none';
  statusEl.textContent = message;
  statusEl.style.display = 'block';}
/**
 * Toggle authentication method between manual token and Google sign-in.
 */
function toggleAuthMethod() {
  const method = document.getElementById('authMethod').value;
  const manualGroup = document.getElementById('manualTokenGroup');
  const googleBtn = document.getElementById('googleSignInBtn');
  if (method === 'google') {
    manualGroup.style.display = 'none';
    googleBtn.style.display = 'block';
  } else {
    manualGroup.style.display = 'block';
    googleBtn.style.display = 'none';
  }
}

/**
 * Initiate Google sign-in to retrieve a GitHub OAuth token.
 */
function signInWithGoogle() {
  chrome.runtime.sendMessage({ type: 'oauth' }, (response) => {
    if (response && response.token) {
      document.getElementById('token').value = response.token;
      saveToken(response.token);
    } else if (response && response.error) {
      displayError('OAuth failed: ' + response.error);
    }
  });
}

