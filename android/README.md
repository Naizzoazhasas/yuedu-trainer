# 读谱训练器 · Android 版（APK）

这是「读谱训练器」的 Android 壳：一个最小的 WebView 容器，把网页应用的所有资源打包进 APK。
安装后**完全离线可用**，不需要联网，也不申请网络权限。

---

## 一、直接安装（普通用户）

手机浏览器打开下面这个链接（Release 资产，始终指向最新版）：

**<https://github.com/Naizzoazhasas/yuedu-trainer/releases/latest/download/yuedu-trainer.apk>**

1. 下载完成后点开安装；
2. 系统若提示「未知来源 / 禁止安装未知应用」，允许一次即可；
3. 也可以把 APK 传到手机上再点开，或连数据线执行 `adb install -r yuedu-trainer.apk`。

| 项目 | 值 |
|---|---|
| 应用名 | 读谱训练器 |
| 包名 | `com.yuedu.trainer` |
| 版本 | `1.3.0`（versionCode `4`） |
| 最低系统 | Android 5.0（API 21） |
| 目标系统 | Android 14（API 34） |
| 申请权限 | `RECORD_AUDIO`（调音器用麦克风）、`MODIFY_AUDIO_SETTINGS`（音频路由） |
| 不申请权限 | **没有 INTERNET** —— 全部资源在 APK 内，纯离线 |

---

## 二、它是怎么工作的

```
MainActivity (WebView 外壳)
  ├── LocalAssetServer     ← 把 assets/ 提供到 http://127.0.0.1:<随机端口>/
  │                            （关键：http://127.0.0.1 是「安全上下文」，麦克风才可用）
  ├── WebBridge            ← 网页 → 原生的文件保存（导出 PNG / MIDI / MusicXML）
  └── assets/              ← 整个网页应用（由构建脚本从项目根复制）
```

### 为什么不用 `file:///android_asset/index.html`

浏览器的「安全上下文（Secure Context）」规则规定：**只有 https、`http://127.0.0.1`、
`http://localhost` 才允许 `navigator.mediaDevices.getUserMedia()` 采集麦克风**，
而 `file://` 不在其列。如果直接用 `file://` 加载，网页里 `navigator.mediaDevices` 就是
`undefined`，调音器面板会显示「调音器不可用」。

所以本应用启动时会在本机起一个只监听回环地址的迷你 HTTP 服务器，把资源通过
`http://127.0.0.1:<端口>/` 提供给 WebView。这样：

- 是**安全上下文** → 调音器可以用麦克风；
- 是 **http 源** → `localStorage` / 缓存等行为与普通网站一致；
- **只绑定 127.0.0.1** → 局域网访问不到，也不需要有网络权限；
- 端口由系统随机分配（bind 0），不会和别的应用撞车。

若服务器因极端情况启动失败，会自动回退到 `file://` 加载并弹出提示——此时除调音器外
其它功能照常可用。

### 手机上导出文件

网页里的「保存为图片 / 导出 MIDI / 导出 MusicXML」在普通浏览器里是 Blob 下载，
WebView 默认不会处理，点了没反应。本应用通过 `WebBridge` 桥接解决：

- 网页侧（`android/bridge/bridge.js`）在捕获阶段拦下 `<a download href="blob:...">` 的点击，
  把内容转成 base64 **分块**（每块 192 KB）交给原生；
- 原生侧（`WebBridge.java`）按后缀白名单校验、净化文件名后落盘；
- 保存位置（**不需要任何存储权限**）：
  - 图片 → **相册 `Pictures/读谱训练器/`**
  - MIDI / MusicXML / 文本 → **`Download/读谱训练器/`**
  - Android 9 及以下 → `Android/data/com.yuedu.trainer/files/导出/`（用文件管理器查看）

---

## 三、自己构建

### 依赖的工具链（外部依赖，不随仓库分发）

需要 JDK 与 Android build-tools、平台包：

| 组件 | 用途 | 本机默认路径 |
|---|---|---|
| JDK 17 | 编译 Java | `<工具链根>/jdk/jdk-17.0.13+11/` |
| build-tools 34 | aapt2 / d8 / zipalign / apksigner | `<工具链根>/build-tools/android-14/` |
| platform 34 | `android.jar`（编译期 classpath） | `<工具链根>/platform/android-34/android.jar` |

`<工具链根>` 默认是 `D:\文档\deepseek-harness\default-workspace\_tools\android`，
可用参数或环境变量覆盖：

```powershell
node tools/build-apk.js --tools "D:\somewhere\android"
$env:YUEDU_ANDROID_TOOLCHAIN = "D:\somewhere\android"; node tools/build-apk.js
```

### 构建与校验

```powershell
node tools/build.js          # 先构建网页（产出 dist/site，APK 优先用它）
node tools/build-apk.js      # 打包 APK → dist/android/yuedu-trainer.apk
node tools/verify-apk.js     # 校验包名/版本/权限/签名/内容/体积
node tools/publish-apk.js    # 上传到 GitHub Release（需要令牌）
```

`build-apk.js` 的执行步骤：

1. **准备 assets**：解析 `index.html` 的 `<script src>` / `<link href>`（非硬编码文件名），
   从 `dist/site/`（优先）或项目根复制到 `android/assets/`，并额外加入 `bridge.js`；
2. `aapt2 compile` + `aapt2 link`：产出 `resources.ap_` 与 `R.java`；
3. `javac --release 8 -bootclasspath android.jar`：编译 `src/com/yuedu/trainer/*.java`；
4. `d8 --min-api 21 --release`：转成 `classes.dex`；
5. 纯 node ZIP 组装（全部 store 不压缩，满足 targetSdk 30+ 对 `resources.arsc` 未压缩 + 4 字节对齐的要求）；
6. `zipalign -p -f 4`；
7. `apksigner sign`（v1 + v2 + v3）；
8. 校验签名与内容。

### 签名

首次构建会自动生成自签名密钥：

```
android/keystore/yuedu-release.jks
alias   : yuedu
口令     : yuedu-trainer（脚本常量 KEYSTORE_PASSWORD / KEY_PASSWORD）
有效期   : 10000 天
DN      : CN=YueDu Trainer, ...
```

> ⚠️ `android/keystore/` 已被 `.gitignore` 忽略，**不要提交**；这是自用分发的自签名密钥。
> 换成自己的密钥后，已安装的旧版本必须**先卸载**才能装新包（签名不一致）。

---

## 四、改包名 / 版本号

两处必须**同时**改，否则 `aapt2 link` 的参数会覆盖清单里的值：

1. `android/AndroidManifest.xml`：
   ```xml
   <manifest package="com.yuedu.trainer"
       android:versionCode="4"
       android:versionName="1.3.0">
   ```
2. `tools/build-apk.js` 顶部的 `APP` 常量：
   ```js
   const APP = { packageName: 'com.yuedu.trainer', versionName: '1.3.0', versionCode: 4, ... };
   ```
3. 顺手同步 `tools/verify-apk.js` 里的 `EXPECT`（校验脚本会比对）。

> `versionCode` 必须**递增**，否则手机不会把它当作升级（同一 versionCode 只能覆盖安装）。

---

## 五、常见问题

| 现象 | 原因与处理 |
|---|---|
| 装上后白屏 | APK 内缺资源。跑 `node tools/verify-apk.js`，它会断言 `assets/index.html`、`assets/src/*.js`、`assets/vendor/vexflow.js`、`assets/bridge.js` 都在 |
| **调音器显示「不可用」** | 说明网页跑在 `file://` 下（本地服务器没起来）。看日志里有没有 `本地资源服务器已启动：http://127.0.0.1:xxxxx/`；若回退了，请把机型与系统版本反馈给我 |
| 调音器没声音 | 在系统设置里给应用开麦克风权限；确认手机没静音、没被其它应用占用麦克风 |
| 节拍器不出声 | 已关闭「需要用户手势」限制；若仍无声，检查**媒体**音量（不是铃声音量） |
| 导出后找不到文件 | 图片在**相册**（Pictures/读谱训练器），MIDI / MusicXML / 文本在**下载**（Download/读谱训练器）；部分相册应用需下拉刷新 |
| 导出没弹提示 | 正常会弹「已保存到 …」的原生 Toast。若完全没有，说明 `bridge.js` 未注入（见构建日志的「已加入 assets/bridge.js」） |
| 覆盖安装被拒绝 | 新 APK 签名与已装版本不一致（换了 keystore）。先卸载旧版本再装 |
| 更新后界面没变 | 应用内可能有缓存。彻底杀掉进程重开；必要时卸载重装 |
| `aapt2` 报 `Failed to stat ... android.jar` | 无害告警：aapt2 对含中文的路径 stat 会失败，但 `android.jar` 实际已被正确读取（R.java 正常生成、badging 正确） |

---

## 六、文件清单

```
android/
├── AndroidManifest.xml                      # 清单（包名/版本/权限/Activity）
├── README.md                                # 本文件
├── bridge/
│   └── bridge.js                            # 网页侧下载拦截 + 分块上传（构建时复制进 assets）
├── res/
│   ├── mipmap/icon.png                      # 应用图标（构建时由 icons/icon-192.png 生成）
│   └── values/strings.xml                   # app_name = 读谱训练器
└── src/com/yuedu/trainer/
    ├── MainActivity.java                    # WebView 外壳 + 麦克风双层授权 + 桥接注入
    ├── LocalAssetServer.java                # 本地 HTTP 服务器（安全上下文，让调音器可用）
    └── WebBridge.java                       # 导出文件的保存桥接（分块接收 + MediaStore 落盘）

生成物（已 gitignore）：
android/assets/     android/build/     android/classes/     android/keystore/
```
