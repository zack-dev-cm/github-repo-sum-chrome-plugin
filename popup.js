// popup.js

document.getElementById('summarizeBtn').addEventListener('click', summarizeRepo);

function summarizeRepo() {
  const statusEl = document.getElementById('status');
  const errorEl = document.getElementById('error');
  const summaryEl = document.getElementById('summary');
  
  statusEl.textContent = 'Summarizing repository...';
  errorEl.textContent = '';
  summaryEl.textContent = '';

  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    chrome.tabs.sendMessage(tabs[0].id, { action: 'getRepoInfo' }, repoInfo => {
      if (repoInfo) {
        fetchRepoTree(repoInfo.owner, repoInfo.repo)
          .then(files => fetchFilesContent(files))
          .then(contents => {
            const summary = generateSummary(contents);
            statusEl.textContent = 'Summary generated.';
            summaryEl.textContent = summary;
          })
          .catch(error => {
            statusEl.textContent = '';
            errorEl.textContent = 'Error: ' + error.message;
          });
      } else {
        statusEl.textContent = '';
        errorEl.textContent = 'Not on a valid GitHub repository page.';
      }
    });
  });
}

function fetchRepoTree(owner, repo) {
  // Fetch the default branch
  return fetch(`https://api.github.com/repos/${owner}/${repo}`)
    .then(response => response.json())
    .then(repoData => {
      const branch = repoData.default_branch;
      return fetch(`https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`);
    })
    .then(response => response.json())
    .then(treeData => {
      if (treeData.truncated) {
        throw new Error('Repository tree is too large to fetch.');
      }
      // Filter code files
      const codeFiles = treeData.tree.filter(item => {
        return item.type === 'blob' && isCodeFile(item.path);
      });
      return codeFiles;
    });
}

function isCodeFile(filePath) {
  const codeExtensions = [
    '.js', '.ts', '.py', '.java', '.cpp', '.c', '.cs', '.php', '.rb',
    '.go', '.rs', '.kt', '.swift', '.m', '.h', '.css', '.html', '.json',
    '.xml', '.sh', '.bat', '.ps1', '.pl', '.rb', '.lua', '.dart'
  ];
  return codeExtensions.some(ext => filePath.endsWith(ext));
}

function fetchFilesContent(files) {
  const fetches = files.map(file => {
    return fetch(file.url)
      .then(response => response.json())
      .then(blobData => {
        const content = atob(blobData.content);
        return { path: file.path, content };
      });
  });
  return Promise.all(fetches);
}

function generateSummary(filesContent) {
  const MAX_CONTENT_LENGTH = 50000; // Limit to prevent performance issues
  let combinedContent = '';

  filesContent.forEach(file => {
    if (combinedContent.length < MAX_CONTENT_LENGTH) {
      combinedContent += `\n// File: ${file.path}\n${file.content}\n`;
    }
  });

  // Basic summarization: Extract comments and function names
  const summaryLines = [];
  const lines = combinedContent.split('\n');

  const commentRegex = /^\s*\/\/(.*)/; // Single-line comments
  const functionRegexes = [
    /\bfunction\s+(\w+)/,         // JavaScript, PHP
    /\bdef\s+(\w+)/,              // Python
    /\bfunc\s+(\w+)/,             // Go
    /\b(\w+)\s*\(.*\)\s*\{/,      // Java, C++, C#, Swift
    /\bclass\s+(\w+)/,            // OOP Class definitions
    /\bstruct\s+(\w+)/,           // Struct definitions
    /\binterface\s+(\w+)/         // Interface definitions
  ];

  lines.forEach(line => {
    let match;
    if ((match = line.match(commentRegex))) {
      summaryLines.push(`Comment: ${match[1].trim()}`);
    } else {
      functionRegexes.forEach(regex => {
        if ((match = line.match(regex))) {
          summaryLines.push(`Definition: ${match[0].trim()}`);
        }
      });
    }
  });

  // Remove duplicates and limit summary size
  const uniqueSummary = [...new Set(summaryLines)].slice(0, 100);

  return uniqueSummary.join('\n');
}
