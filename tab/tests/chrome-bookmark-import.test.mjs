import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// The upstream extension package is CommonJS, but Vite bundles its TS modules
// as ESM. Compile this dependency-free service to ESM for Node's test runner.
const source = readFileSync(new URL('../src/lib/services/chrome-bookmark-import.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } });
const { listBrowserFolders, previewBrowserFolder, getImportApiBase, importBrowserBookmarks } =
  await import(`data:text/javascript,${encodeURIComponent(outputText)}`);

const bookmark = (id, url, title = 'Page') => ({ id, url, title });
const folder = (id, title, children = []) => ({ id, title, children });

test('requires an explicit folder and only previews supported descendant links', () => {
  const root = folder('0', '', [
    folder('1', 'Bookmarks Bar', [
      folder('10', 'Projects', [
        bookmark('a', 'https://example.com/one', 'One'),
        folder('11', 'Subfolder', [
          bookmark('b', 'https://example.com/two', 'Two'),
          bookmark('c', 'chrome://extensions'),
          bookmark('d', 'https://example.com/one'),
          bookmark('e', 'not a URL'),
        ]),
      ]),
    ]),
    folder('2', 'Other Bookmarks', [bookmark('f', 'https://not-selected.example')]),
  ]);
  assert.deepEqual(listBrowserFolders([root]), [
    { id: '1', path: 'Bookmarks Bar' },
    { id: '10', path: 'Bookmarks Bar / Projects' },
    { id: '11', path: 'Bookmarks Bar / Projects / Subfolder' },
    { id: '2', path: 'Other Bookmarks' },
  ]);
  const preview = previewBrowserFolder(root.children[0].children[0]);
  assert.deepEqual(preview.candidates.map(({ id, folderPath }) => [id, folderPath]), [
    ['a', 'Projects'], ['b', 'Projects / Subfolder'],
  ]);
  assert.equal(preview.unsupported, 2);
  assert.equal(preview.duplicateUrls, 1);
});

test('only accepts a secure TMarks origin, never the default hosted instance', () => {
  assert.equal(getImportApiBase('https://my-site.pages.dev/'), 'https://my-site.pages.dev/api');
  assert.equal(getImportApiBase('https://my-site.pages.dev/api'), 'https://my-site.pages.dev/api');
  for (const input of ['', 'http://my-site.pages.dev', 'https://user:pass@my-site.pages.dev',
    'https://my-site.pages.dev/api/v1', 'https://my-site.pages.dev/?redirect=1']) {
    assert.throws(() => getImportApiBase(input));
  }
});

test('creates new bookmarks, skips existing URLs and continues after per-link error', async () => {
  const candidates = [bookmark('1', 'https://new.example'), bookmark('2', 'https://exists.example'), bookmark('3', 'https://bad.example')];
  const called = [];
  const snapshots = [];
  const progress = await importBrowserBookmarks(candidates, async candidate => {
    called.push(candidate.url);
    if (candidate.id === '2') return { meta: { code: 'BOOKMARK_EXISTS' } };
    if (candidate.id === '3') throw new Error('bad input');
    return { data: { bookmark: { id: candidate.id } } };
  }, { delayMs: 0, onProgress: state => snapshots.push(state.processed) });
  assert.deepEqual(called, candidates.map(candidate => candidate.url));
  assert.deepEqual([progress.created, progress.existing, progress.failed, progress.processed, progress.cancelled], [1, 1, 1, 3, false]);
  assert.deepEqual(snapshots, [0, 1, 2, 3, 3]);
});

test('stops after authentication or rate-limit error without repeated writes', async () => {
  const candidates = [bookmark('1', 'https://a.example'), bookmark('2', 'https://b.example')];
  for (const code of ['INVALID_API_KEY', 'RATE_LIMIT_EXCEEDED']) {
    let calls = 0;
    const result = await importBrowserBookmarks(candidates, async () => {
      calls++;
      const error = new Error('stop');
      error.code = code;
      throw error;
    }, { delayMs: 0 });
    assert.equal(calls, 1);
    assert.equal(result.processed, 1);
    assert.equal(result.failed, 1);
  }
});

test('cancellation stops before the next write', async () => {
  const candidates = [bookmark('1', 'https://a.example'), bookmark('2', 'https://b.example')];
  let stop = false;
  const result = await importBrowserBookmarks(candidates, async () => {
    stop = true;
    return {};
  }, { delayMs: 0, shouldStop: () => stop });
  assert.equal(result.created, 1);
  assert.equal(result.processed, 1);
  assert.equal(result.cancelled, true);
});
