# 不用命令行：在 GitHub 网页上传本项目的完整步骤

本说明假设你已经在浏览器里登录了自己的 GitHub 账号。全程只需要点鼠标，不需要安装任何软件。

---

## 第 0 步：准备上传包

在项目文件夹里运行一次：

```powershell
node tools\prepare.js
```

它会在项目下生成 `upload/yuedu-trainer-source.zip`，里面就是需要上传的全部文件（源码 + 工具 + 说明）。

> 为什么不用上传整个文件夹？因为网页上传不支持「拖一整个目录树」，用 zip 最省事。

---

## 第 1 步：新建仓库

1. 打开 <https://github.com/new>
2. **Repository name** 填 `yuedu-trainer`
3. **Description**（可选）填：`读谱训练器 — 随机节奏与旋律生成、五线谱/简谱对照、节拍器、调音器、音阶对照，纯前端离线可用`
4. 选 **Public**（GitHub Pages 免费版需要公开仓库）
5. **不要**勾选 `Add a README file`、`.gitignore`、`license`（本项目里已经有了，勾了反而会冲突）
6. 点 **Create repository**

---

## 第 2 步：上传文件

1. 在刚建好的仓库页面，点 **uploading an existing file**（或 `Add file` → `Upload files`）
2. 把 `upload/yuedu-trainer-source.zip` **拖进去**
3. 等它上传完，在下方 **Commit changes** 的输入框里写：
   `读谱训练器 v1.0.0：随机节奏/旋律生成 + 五线谱与简谱渲染 + 节拍器 + 调音器`
4. 点 **Commit changes**

> ⚠️ 重要：网页上传 zip **不会**自动解压。上传完你要用第 3 步的方式解压，
> 或者更省事：**先把 zip 在本机解压，再把解压出来的文件拖进去上传**。
> 后者更直接，推荐这么做：解压后会有 `index.html`、`src/`、`tools/` 等，全选拖到 GitHub 上传框里即可。

### 上传后检查文件结构

仓库根目录应该长这样（`index.html` 必须在最外层）：

```
index.html
manifest.webmanifest
sw.js
README.md
LICENSE
.gitignore
.gitattributes
start-server.cmd
start-offline.cmd
run-tests.cmd
使用说明.txt
USAGE-zh.txt
uploads-guide.md
src/
  app.js  core/  audio/  data/  export/  features/
tools/
docs/
icons/
.github/workflows/deploy.yml
```

如果发现多了一层文件夹（例如 `yuedu-trainer-source/index.html`），
那是不行的——**`index.html` 必须在仓库根目录**，否则 Pages 找不到首页。
解决办法：进入那层文件夹，用右上角的 `Add file` → `Upload files` 重新上传里面的内容；
或者干脆在本地解压后重传。

---

## 第 3 步：开启 GitHub Pages

有两种方式，任选一种。

### 方式 A：直接发布分支（最简单，推荐先试这个）

1. 仓库页面 → **Settings**（顶部齿轮）
2. 左侧 **Pages**
3. **Source** 选 `Deploy from a branch`
4. **Branch** 选 `main`，右边的文件夹选 `/ (root)`
5. 点 **Save**
6. 等 1–2 分钟，刷新页面，顶部会出现绿色提示，形如：
   `Your site is live at https://<你的用户名>.github.io/yuedu-trainer/`

### 方式 B：用 GitHub Actions 自动构建（本仓库已带工作流）

仓库里的 `.github/workflows/deploy.yml` 会在每次推送时自动跑测试、构建并发布。
用这种方式需要：

1. **Settings → Actions → General → Workflow permissions**，选 **Read and write permissions**，保存
2. **Settings → Pages → Source** 选 `GitHub Actions`
3. 到 **Actions** 标签页，选 `构建并发布到 GitHub Pages`，点 **Run workflow** 手动跑一次

> 注意：`.github/workflows/deploy.yml` 用网页上传的方式**可能传不上去**
> （GitHub 网页界面对 `.github` 目录有的入口不显示）。传不上去也没关系，
> 直接用**方式 A** 一样能上线；`.github` 那层不影响网站内容。

---

## 第 4 步：验证

打开 `https://<你的用户名>.github.io/yuedu-trainer/`，检查：

- [ ] 页面能打开，标题是「读谱训练器」
- [ ] 点「生成新乐段」，五线谱和简谱都出现
- [ ] 点「播放」，能听到声音
- [ ] 「节拍器」页能出声、「调音器」页能请求麦克风权限（**https 下可以，这正是它的价值**）
- [ ] 「乐器音阶表」页能看到指板图，点「保存为图片」能下载 PNG

---

## 常见问题

**页面 404 或只有 README**
`index.html` 不在仓库根目录。回到第 2 步检查文件结构。

**页面打开是源码文本**
Pages 的 Source 选错了分支或目录，重新按第 3 步设置。

**样式全丢、控制台报 404**
`src/` 目录没上传完整。检查仓库里有没有 `src/styles.css` 与 `src/app.js`。

**调音器提示不支持**
必须用 `https://`（GitHub Pages 就是 https）或 `http://127.0.0.1` 打开。
如果你是自己双击 HTML 文件（`file://`），浏览器不允许用麦克风，这是浏览器的规定，不是 bug。

**想更新网站内容**
在仓库里直接点开某个文件 → 铅笔图标 → 改完提交即可，Pages 会自动重新发布。

---

## 附：以后想用命令行维护（可选）

本机如果装了 Git，可以这样把改动推上去：

```powershell
cd <项目目录>
git remote add origin https://github.com/<你的用户名>/yuedu-trainer.git
git add -A
git commit -m "更新说明"
git push -u origin main
```

注意：GitHub 从 2021 年起不再接受账号密码推送，需要 Personal Access Token。
在 <https://github.com/settings/tokens> 生成一个带 `repo` 权限的 token，推送时用户名填你的 GitHub 用户名，密码栏粘贴 token。
