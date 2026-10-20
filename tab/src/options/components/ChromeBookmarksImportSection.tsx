import { useEffect, useRef, useState } from 'react';
import { createTMarksClient } from '@/lib/api/tmarks';
import {
  getImportApiBase, importBrowserBookmarks, listBrowserFolders, previewBrowserFolder,
  type ImportPreview, type ImportProgress,
} from '@/lib/services/chrome-bookmark-import';

interface Props {
  siteUrl: string;
  apiKey: string;
}

export function ChromeBookmarksImportSection({ siteUrl, apiKey }: Props) {
  const [folders, setFolders] = useState<Array<{ id: string; path: string }>>([]);
  const [selectedId, setSelectedId] = useState('');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [previewSite, setPreviewSite] = useState('');
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState('');
  const stopRequested = useRef(false);

  useEffect(() => {
    let alive = true;
    if (!chrome.bookmarks) {
      setError('当前浏览器未授予书签权限，无法读取原生书签');
      return;
    }
    chrome.bookmarks.getTree().then(tree => {
      if (alive) setFolders(listBrowserFolders(tree));
    }).catch(err => {
      if (alive) setError(err instanceof Error ? err.message : '无法读取浏览器书签');
    });
    return () => { alive = false; };
  }, []);

  const scan = async () => {
    if (!selectedId || busy) return;
    setError('');
    setProgress(null);
    try {
      const nodes = await chrome.bookmarks.getSubTree(selectedId);
      if (!nodes?.[0] || nodes[0].url) throw new Error('文件夹已不存在，请重新选择');
      setPreview(previewBrowserFolder(nodes[0]));
      setPreviewSite(siteUrl.trim());
    } catch (err) {
      setPreview(null);
      setError(err instanceof Error ? err.message : '读取文件夹失败');
    }
  };

  const run = async () => {
    if (!preview || busy) return;
    setError('');
    try {
      if (siteUrl.trim() !== previewSite) throw new Error('站点地址已改变，请重新预览');
      const baseUrl = getImportApiBase(siteUrl);
      if (!apiKey.trim()) throw new Error('请先在上方填写 TMarks API Key（需要书签创建权限）');
      const client = createTMarksClient({ baseUrl, apiKey: apiKey.trim() });
      stopRequested.current = false;
      setStopping(false);
      setBusy(true);
      await importBrowserBookmarks(
        preview.candidates,
        async bookmark => client.bookmarks.createBookmark({ title: bookmark.title, url: bookmark.url, is_public: false }),
        { shouldStop: () => stopRequested.current, onProgress: setProgress },
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : '导入失败');
    } finally {
      setBusy(false);
      setStopping(false);
    }
  };

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-900" aria-label="导入 Chrome 原生书签">
      <h2 className="text-xl font-semibold text-gray-900 dark:text-white">导入 Chrome 原生书签</h2>
      <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
        手动选择一个文件夹，预览后将其中及子文件夹的网页单向复制到 TMarks。
        不修改 Chrome 原书签；不覆盖 TMarks 已有书签。文件夹层级不会同步到 TMarks。
      </p>
      <label htmlFor="chrome-import-folder" className="mt-4 block text-sm font-medium text-gray-800 dark:text-gray-200">源文件夹</label>
      <select
        id="chrome-import-folder"
        className="mt-2 w-full rounded-lg border border-gray-300 bg-white p-2 text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
        value={selectedId}
        disabled={busy}
        onChange={event => { setSelectedId(event.target.value); setPreview(null); setProgress(null); setError(''); }}
      >
        <option value="">请选择 Chrome 文件夹（不会默认导入全部）</option>
        {folders.map(folder => <option key={folder.id} value={folder.id}>{folder.path}</option>)}
      </select>
      <button type="button" onClick={scan} disabled={!selectedId || busy}
        className="mt-4 rounded-lg border border-blue-600 px-4 py-2 text-blue-700 disabled:opacity-50 dark:text-blue-300">
        预览文件夹
      </button>
      {preview && <div className="mt-4 rounded-lg bg-blue-50 p-3 text-sm text-gray-800 dark:bg-gray-800 dark:text-gray-100">
        <p>待尝试导入：{preview.candidates.length} 条；不支持的地址：{preview.unsupported} 条；文件夹内重复 URL：{preview.duplicateUrls} 条。</p>
        <p className="mt-1">目标站点：{previewSite || '未填写'}。已有 TMarks 书签将在写入时跳过；不会删除或覆盖浏览器书签。</p>
        <ul className="mt-2 list-inside list-disc">
          {preview.candidates.slice(0, 5).map(entry =>
            <li className="truncate" key={entry.id} title={entry.url}>{entry.title} · {entry.folderPath}</li>)}
        </ul>
        {preview.candidates.length > 5 && <p>仅展示前 5 条，确认后按顺序导入。</p>}
        <div className="mt-3 flex gap-2">
          <button type="button" onClick={run} disabled={!preview.candidates.length || busy}
            className="rounded-lg bg-blue-600 px-4 py-2 text-white disabled:opacity-50">
            {busy ? '导入中…' : '确认导入到 TMarks'}
          </button>
          {busy && <button type="button" disabled={stopping}
            onClick={() => { stopRequested.current = true; setStopping(true); }}
            className="rounded-lg border border-gray-400 px-3 py-2 disabled:opacity-50">
            {stopping ? '正在停止…' : '停止后续导入'}
          </button>}
        </div>
      </div>}
      {progress && <p role="status" className="mt-4 text-sm text-gray-700 dark:text-gray-200">
        已处理 {progress.processed}/{progress.total}；新建 {progress.created}，已有跳过 {progress.existing}，失败 {progress.failed}。
        {progress.cancelled && ' 已按请求停止；已完成的书签保留。'}
        {!progress.cancelled && !busy && progress.processed < progress.total && ' 因错误提前停止，可检查后重新预览重试。'}
      </p>}
      {progress?.errors.length ? <details className="mt-2 text-sm text-red-700 dark:text-red-300">
        <summary>失败详情（{progress.errors.length}）</summary>
        <ul>{progress.errors.map(({ url, message }, index) => <li key={`${index}-${url}`}>{url}: {message}</li>)}</ul>
      </details> : null}
      {error && <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-300">{error}</p>}
    </section>
  );
}
