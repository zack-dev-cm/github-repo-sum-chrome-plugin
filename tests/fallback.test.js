import assert from 'assert';

// Minimal implementation of fetchFilesContent and helper for testing
async function fetchFilesContent(files, maxChars, owner, repo, ref) {
  if (!files || !Array.isArray(files) || files.length === 0) {
    return { filesContent: [], skippedFiles: [] };
  }
  const skippedFiles = [];
  const MAX_FILE_SIZE = 500000; // 500 KB
  const fetches = files.map(file => {
    return fetchWithToken(file.url)
      .then(response => {
        if (!response.ok) {
          skippedFiles.push(file.path);
          return null;
        }
        return response.json();
      })
      .then(blobData => {
        if (!blobData || blobData.size > MAX_FILE_SIZE) {
          skippedFiles.push(file.path);
          return null;
        }
        if (blobData.content) {
          let content = atob(blobData.content.replace(/\n/g, ''));
          if (maxChars > 0 && content.length > maxChars * 2) {
            const startContent = content.substring(0, maxChars);
            const endContent = content.substring(content.length - maxChars);
            content = startContent + '\n\n...\n\n' + endContent;
          }
          return { path: file.path, content };
        }
        return fetchWithToken(`https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${file.path}`)
          .then(rawResponse => {
            if (!rawResponse.ok) {
              skippedFiles.push(file.path);
              return null;
            }
            return rawResponse.text();
          })
          .then(rawContent => {
            if (rawContent === null) return null;
            let content = rawContent;
            if (maxChars > 0 && content.length > maxChars * 2) {
              const startContent = content.substring(0, maxChars);
              const endContent = content.substring(content.length - maxChars);
              content = startContent + '\n\n...\n\n' + endContent;
            }
            return { path: file.path, content };
          });
      })
      .catch(() => {
        skippedFiles.push(file.path);
        return null;
      });
  });
  const results = await Promise.all(fetches);
  return { filesContent: results.filter(r => r), skippedFiles };
}

// Mock fetchWithToken to simulate blob without content then fallback to raw
function fetchWithToken(url) {
  if (url.endsWith('/blobs/sha1')) {
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ size: 10 })
    });
  }
  if (url.endsWith('/main/test.txt')) {
    return Promise.resolve({
      ok: true,
      text: () => Promise.resolve('raw text')
    });
  }
  return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
}

(async () => {
  const files = [{ path: 'test.txt', url: 'https://api.github.com/repos/x/y/git/blobs/sha1' }];
  const { filesContent, skippedFiles } = await fetchFilesContent(files, 0, 'x', 'y', 'main');
  assert.deepStrictEqual(filesContent, [{ path: 'test.txt', content: 'raw text' }]);
  assert.deepStrictEqual(skippedFiles, []);
  console.log('fallback test passed');
})();
