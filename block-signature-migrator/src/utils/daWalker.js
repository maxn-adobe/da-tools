import { listDirectory, fetchDocument } from '../api/daApi.js';
import { parseDocument } from './blockParser.js';

export async function crawlDirectory(rootPath, { onProgress } = {}) {
  const results = [];

  async function walk(dirPath) {
    let items;
    try {
      items = await listDirectory(dirPath);
    } catch {
      return;
    }

    const htmlFiles = items.filter((item) => item.ext === 'html');
    const subDirs = items.filter((item) => !item.ext);

    for (const file of htmlFiles) {
      try {
        const html = await fetchDocument(file.path);
        const { blocks } = parseDocument(html);
        results.push({ path: file.path, blocks });
      } catch {
        // skip documents that fail to fetch or parse
      }
      onProgress?.({ scanned: results.length, current: file.path });
    }

    for (const dir of subDirs) {
      await walk(dir.path);
    }
  }

  await walk(rootPath);
  return results;
}
