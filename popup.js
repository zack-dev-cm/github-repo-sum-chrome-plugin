// popup.js

document.getElementById('summarizeBtn').addEventListener('click', processRepo);

function processRepo() {
  const statusEl = document.getElementById('status');
  const errorEl = document.getElementById('error');
  const summaryEl = document.getElementById('summary');
  const downloadLink = document.getElementById('downloadLink');

  statusEl.textContent = 'Processing repository...';
  errorEl.textContent = '';
  summaryEl.textContent = '';
  downloadLink.style.display = 'none';

  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    const tab = tabs[0];
    const repoInfo = getRepoInfoFromURL(tab.url);
    if (repoInfo) {
      const extensionsInput = document.getElementById('extensions').value;
      const extensions = extensionsInput.split(',').map(ext => ext.trim()).filter(ext => ext);
      fetchRepoTree(repoInfo.owner, repoInfo.repo)
        .then(files => {
          const codeFiles = filterCodeFiles(files, extensions);
          return fetchFilesContent(codeFiles);
        })
        .then(contents => {
          const combinedContent = buildCombinedContent(contents);
          const treeStructure = buildTreeStructure(contents);
          const finalContent = combinedContent + '\n\n===== File Tree =====\n' + treeStructure;
          createDownloadableFile(finalContent);
          statusEl.textContent = 'File ready for download.';
          downloadLink.style.display = 'block';
        })
        .catch(error => {
          console.error('Error:', error);
          statusEl.textContent = '';
          errorEl.textContent = 'Error: ' + error.message;
        });
    } else {
      statusEl.textContent = '';
      errorEl.textContent = 'Not on a valid GitHub repository page.';
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
  return fetch(url, { headers });
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
      return treeData.tree;
    });
}

function filterCodeFiles(files, extensions) {
  return files.filter(item => {
    return item.type === 'blob' && extensions.some(ext => item.path.endsWith(ext));
  });
}

function fetchFilesContent(files) {
  const MAX_FILE_SIZE = 100000; // 100 KB
  const fetches = files.map(file => {
    return fetchWithToken(file.url)
      .then(response => response.json())
      .then(blobData => {
        if (blobData.size > MAX_FILE_SIZE) {
          return null; // Skip large files
        }
        const content = atob(blobData.content.replace(/\n/g, ''));
        return { path: file.path, content };
      });
  });
  return Promise.all(fetches).then(results => results.filter(item => item !== null));
}

function buildCombinedContent(filesContent) {
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

function createDownloadableFile(content) {
  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const downloadLink = document.getElementById('downloadLink');
  downloadLink.href = url;
  downloadLink.download = 'combined_code_files_output.txt';
  downloadLink.textContent = 'Download Combined File';
}

