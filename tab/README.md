# TMarks 浏览器扩展（可维护源码版）

本目录从上游仓库 `1.1.0` 分支的 `tab/` 开发源码引入，保留 [`LICENSE`](LICENSE) 中的 MIT 许可证。在此源码基础上实现了**手动将选定 Chrome 原生书签文件夹单向导入自建 TMarks**。没有使用 `1.0.2` 或 `1.0.4` 的预编译 JavaScript；这两个旧包的对应开发源码未在所检查的仓库分支中找到。

## 从源码构建并加载

```sh
git clone https://github.com/Wu-HZ/tmarks.git
cd tmarks/tab
corepack pnpm install --frozen-lockfile
corepack pnpm test
corepack pnpm build:only
```

在 Chrome 打开 `chrome://extensions/`（Edge 为 `edge://extensions/`），开启**开发者模式**，点击**加载已解压的扩展程序**，选择生成的 `tab/dist` 文件夹，确保其中有 `manifest.json`。更新源码后重新运行 `corepack pnpm build:only` 并在扩展管理页重新加载。`dist/`、依赖和本地发布产物不会提交到 Git。

> 这个版本还包含原有的新标签页功能，会接管浏览器新标签页。建议先停用之前加载的其他 TMarks 扩展，避免新标签页扩展之间发生冲突。

## Chrome → TMarks：单向导入

1. 登录你的自建 TMarks 网站，在 **API Keys** 中创建专用密钥。导入需要 `bookmarks.create` 权限；扩展原有的读标签、读书签等功能还需对应的读取权限。密钥仅在创建时显示，请妥善保存，不要提交到 Git。
2. 打开扩展的**选项/设置**，在“TMarks API 配置”填写你的 **HTTPS 站点根地址**（例如 `https://你的站点.pages.dev`）与 API Key。导入模块使用当前表单中的地址和密钥；如需供扩展其他功能复用，再点击“保存设置”。
3. 在“导入 Chrome 原生书签”中**明确选择一个文件夹**，点击“预览文件夹”。只收集该文件夹及其子目录中的 HTTP(S) 网页；跳过 `chrome://`、`file://` 等链接及本次文件夹内重复的 URL。
4. 确认站点与预览数量后点击“确认导入到 TMarks”。服务器上同一 URL 的现有书签由服务器判重并跳过；再次导入可用于补传先前失败的内容。界面提供进度、停止后续导入和错误详情。

**边界：**只读取 Chrome 书签，导入时不会调用 `chrome.bookmarks` 写入、移动或删除；不会把网站里的变更自动写回 Chrome，也不会监听浏览器书签变化自动上传。文件夹层级不会复制到 TMarks（TMarks 使用标签组织）。服务器上的软删除同 URL 记录可能按服务器默认行为被恢复；导入前可先用测试文件夹试验。大量导入按约 1 次/秒提交，避免触发 API Key 每分钟限流。关闭扩展选项页可能中断当前导入；已成功写入的书签不会回滚。

这个导入功能不依赖原有“同步缓存”按钮；它只处理扩展内部缓存与 TMarks 数据。服务器其他书签列表功能若报 `Failed to get bookmarks`，请检查生产 D1 是否已执行 `tmarks/migrations/0105_bookmark_pin_order.sql`。

## 构建与许可

`corepack pnpm build:only` 只生成本地 `tab/dist`；`corepack pnpm build` 还会生成 `tab/release/` 下的发行文件，但不会把 ZIP 覆盖到网站 `tmarks/public/extensions/`。源码与构建脚本都在本目录内。网站项目根目录的许可证另见仓库根目录 [`LICENSE`](../LICENSE)，不要误把两个目录视为同一许可证。
