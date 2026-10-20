// Manual, one-way import: reads one explicitly selected Chrome folder and only
// creates missing TMarks bookmarks. It never writes to chrome.bookmarks.
export interface ImportCandidate {
  id: string;
  title: string;
  url: string;
  folderPath: string;
}

export interface ImportPreview {
  candidates: ImportCandidate[];
  unsupported: number;
  duplicateUrls: number;
}

export interface ImportProgress {
  processed: number;
  total: number;
  created: number;
  existing: number;
  failed: number;
  cancelled: boolean;
  errors: Array<{ url: string; message: string }>;
}

export function listBrowserFolders(roots: chrome.bookmarks.BookmarkTreeNode[]): Array<{ id: string; path: string }> {
  const folders: Array<{ id: string; path: string }> = [];
  function visit(node: chrome.bookmarks.BookmarkTreeNode, parents: string[]) {
    if (node.url) return;
    // The synthetic browser root (id 0) cannot be selected: importing all
    // bookmarks by accident would be too easy.
    const path = node.id === '0' ? parents : [...parents, node.title || '未命名文件夹'];
    if (node.id !== '0') folders.push({ id: node.id, path: path.join(' / ') });
    node.children?.forEach(child => visit(child, path));
  }
  roots.forEach(root => visit(root, []));
  return folders;
}

export function previewBrowserFolder(root: chrome.bookmarks.BookmarkTreeNode): ImportPreview {
  const preview: ImportPreview = { candidates: [], unsupported: 0, duplicateUrls: 0 };
  const seen = new Set<string>();

  function visit(node: chrome.bookmarks.BookmarkTreeNode, parents: string[]) {
    if (!node.url) {
      const path = [...parents, node.title || '未命名文件夹'];
      node.children?.forEach(child => visit(child, path));
      return;
    }
    const url = node.url.trim();
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol) || url.length > 2000) {
        preview.unsupported++;
        return;
      }
    } catch {
      preview.unsupported++;
      return;
    }
    if (seen.has(url)) {
      preview.duplicateUrls++;
      return;
    }
    seen.add(url);
    preview.candidates.push({
      id: node.id,
      title: (node.title.trim() || url).slice(0, 500),
      url,
      folderPath: parents.join(' / '),
    });
  }
  visit(root, []);
  return preview;
}

// The extension settings accept the site URL, not an arbitrary HTTP endpoint.
// Never silently fall back to the author's hosted site if the user forgets it.
export function getImportApiBase(siteUrl: string): string {
  const url = new URL(siteUrl.trim());
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
      !['', '/', '/api', '/api/'].includes(url.pathname)) {
    throw new Error('请输入 HTTPS TMarks 站点根地址（或其 /api 地址）');
  }
  return `${url.origin}/api`;
}

type SaveResponse = { meta?: { code?: string } };

export async function importBrowserBookmarks(
  candidates: ImportCandidate[],
  createBookmark: (candidate: ImportCandidate) => Promise<SaveResponse>,
  options: {
    shouldStop?: () => boolean;
    onProgress?: (progress: ImportProgress) => void;
    delayMs?: number;
  } = {},
): Promise<ImportProgress> {
  const progress: ImportProgress = {
    processed: 0, total: candidates.length, created: 0, existing: 0,
    failed: 0, cancelled: false, errors: [],
  };
  const delayMs = options.delayMs ?? 1100; // Stay under D1 API Key's 60/minute limit.
  options.onProgress?.({ ...progress, errors: [] });
  for (const candidate of candidates) {
    if (options.shouldStop?.()) {
      progress.cancelled = true;
      break;
    }
    try {
      const response = await createBookmark(candidate);
      if (response.meta?.code === 'BOOKMARK_EXISTS') progress.existing++;
      else progress.created++;
    } catch (error) {
      progress.failed++;
      const code = error instanceof Error && 'code' in error ? String(error.code) : '';
      const message = error instanceof Error ? error.message : String(error);
      progress.errors.push({ url: candidate.url, message });
      // Authentication errors, rate limits, and server failures should not
      // trigger hundreds more failing writes. Re-running skips existing URLs.
      if (['INVALID_API_KEY', 'MISSING_API_KEY', 'INSUFFICIENT_PERMISSIONS', 'RATE_LIMIT_EXCEEDED'].includes(code) ||
          (error instanceof Error && 'status' in error && Number(error.status) >= 500)) {
        progress.processed++;
        options.onProgress?.({ ...progress, errors: [...progress.errors] });
        break;
      }
    }
    progress.processed++;
    options.onProgress?.({ ...progress, errors: [...progress.errors] });
    if (progress.processed < progress.total && delayMs > 0 && !options.shouldStop?.()) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  progress.cancelled ||= Boolean(options.shouldStop?.());
  options.onProgress?.({ ...progress, errors: [...progress.errors] });
  return progress;
}
