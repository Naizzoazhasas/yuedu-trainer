# 读谱训练器 · Android APK

这份目录把「读谱训练器」这个**纯前端离线网页应用**封装成一个可以直接装在 Android 手机上的 APK。
它**不使用 Gradle、不使用 Android Studio**，只用 `node` 内置模块调用 JDK 与 Android build-tools 的命令行工具，
打包过程完全可复现、可读、可审计。

---

## 一、这个 APK 是什么

- 一个极简的 **WebView 外壳**（`src/com/yuedu/trainer/MainActivity.java`，约 400 行含注释），
  启动后用 `file:///android_asset/index.html` 加载打包进 APK 的网页资源；
- 网页资源来自项目本身（`index.html`、`src/**`、`vendor/vexflow.js`、`icons/**`、`manifest.webmanifest`），
  在 `assets/` 里保持原有目录结构，**运行时完全离线**；
- 因此所有网页功能（随机乐谱生成、五线谱/简谱渲染、节拍器、调音器、音阶表、导出、练习记录）都能用，
  和浏览器里打开的版本一致；
- 数据（练习记录、自定义音型、偏好设置）存在 WebView 的 `localStorage` 里，卸载应用即清除。

| 项目 | 值 |
|---|---|
| 包名 | `com.yuedu.trainer` |
| 应用名 | 读谱训练器 |
| versionName / versionCode | `1.1.0` / `2` |
| minSdkVersion | `21`（Android 5.0） |
| targetSdkVersion | `34`（Android 14） |
| 权限 | `android.permission.RECORD_AUDIO`、`android.permission.MODIFY_AUDIO_SETTINGS` |
| 网络权限 | **无**（不申请 INTERNET，应用完全离线） |

---

## 二、目录结构

```
android/
├── AndroidManifest.xml               # 权限、Activity、图标、minSdk/targetSdk
├── README.md                         # 本文件
├── res/
│   ├── mipmap/icon.png               # 应用图标（由构建脚本从 icons/icon-192.png 自动生成）
│   └── values/strings.xml            # app_name = 读谱训练器
├── src/com/yuedu/trainer/
│   └── MainActivity.java             # WebView 外壳（含麦克风权限处理）
├── assets/                           # ← 构建时自动生成（.gitignore 已忽略，不要手工提交）
├── build/                            # ← 构建中间产物（.flat / R.java / classes / dexout / apk）
├── classes/                          # ← javac 输出（.gitignore 已忽略）
└── keystore/yuedu-release.jks        # ← 首次打包时自动生成的自签名密钥（.gitignore 已忽略）
```

---

## 三、怎么构建

### 1. 需要什么

- **Node.js**（用到 `fs`/`path`/`crypto`/`child_process`/`zlib`，无 npm 依赖，不需要 `npm install`）；
- **JDK 17**（`java`、`javac`、`keytool`）；
- **Android build-tools**（`aapt2`、`d8`、`zipalign`、`apksigner` 与 `android.jar`）。

默认工具链位置是 `<工作区>/_tools/android/`：

```
_tools/android/
├── jdk/bin/java.exe, javac.exe, keytool.exe
└── build-tools/
    ├── aapt2.exe, zipalign.exe, apksigner.bat, d8.bat, android.jar
    └── lib/d8.jar, lib/apksigner.jar
```

工具链在别处时用 `--tools` 指定，或设环境变量 `YUEDU_ANDROID_TOOLS`：

```powershell
node tools/build-apk.js --tools "D:\sdk-lite"
```

构建脚本会先检查工具链，缺哪个文件会逐条列出来并告诉你期望的目录结构，不会中途莫名失败。

### 2. 一条命令打包

```powershell
cd D:\文档\deepseek-harness\default-workspace\yuedu-trainer
node tools/build-apk.js
```

产物：**`dist/android/yuedu-trainer.apk`**

打包脚本做的事（每一步都会打印中文日志）：

| 步骤 | 做了什么 | 实际调用的命令 |
|---|---|---|
| 1 | 准备网页资源到 `android/assets/` | 资源清单从 `index.html` 的 `<script src>` / `<link href>` **解析**得到（加模块不用改脚本）；有 `dist/site/` 就优先用它 |
| 2 | 编译资源 | `aapt2 compile -o android/build/compiled <每个 res 文件>`，然后 `aapt2 link -o android/build/resources.ap_ -I android.jar --manifest android/AndroidManifest.xml --java android/build/gen --min-sdk-version 21 --target-sdk-version 34 --version-code 2 --version-name 1.1.0 <*.flat>` |
| 3 | 编译 Java | `javac -source 8 -target 8 -bootclasspath android.jar -encoding UTF-8 -nowarn -Xlint:-options -d android/classes <源码 + R.java>` |
| 4 | 转 dex | `d8 --lib android.jar --min-api 21 --release --output android/build/dexout <*.class>` |
| 5 | 组装 APK | 纯 node ZIP 写入器：`resources.ap_` 里的条目 + `classes.dex` + `assets/**`，根目录必须是 `AndroidManifest.xml` / `classes.dex` / `resources.arsc` / `assets/…` |
| 6 | 对齐 | `zipalign -p -f 4 <未对齐.apk> <对齐.apk>`（**必须先对齐再签名**） |
| 7 | 生成密钥（仅首次） | `keytool -genkeypair -keystore android/keystore/yuedu-release.jks -alias yuedu -keyalg RSA -keysize 2048 -validity 10000 -storepass … -keypass …` |
| 8 | 签名 | `apksigner sign --ks … --ks-key-alias yuedu --ks-pass pass:… --key-pass pass:… --v1-signing-enabled true --v2-signing-enabled true --out dist/android/yuedu-trainer.apk <对齐.apk>` |
| 9 | 验证 | `apksigner verify --verbose --print-certs` + 断言 ZIP 内含关键文件 + `aapt2 dump badging` 打印关键行 |

> 说明：APK 里的条目**刻意全部不压缩**（store）。Android 11（targetSdk 30）起要求 `resources.arsc`
> 必须未压缩且 4 字节对齐，全量 store 最稳妥；代价只是体积大一点（约 1.5 MB），远低于安装限制。

### 3. 单独校验

```powershell
node tools/verify-apk.js
```

它会断言：包名 `com.yuedu.trainer`、版本 `1.1.0`/`2`、minSdk 21、targetSdk 34、含 `RECORD_AUDIO` 权限、
`apksigner verify` 退出码为 0、APK 内含 `assets/index.html` 与 `assets/vendor/vexflow.js`、体积 < 20 MB。
全部通过 exit 0，任一失败 exit 1；**本机没有工具链时会优雅跳过并 exit 0**，不会报错崩掉。

---

## 四、怎么装到手机上

### 方式 A：数据线 + adb（推荐）

```powershell
adb install -r "dist\android\yuedu-trainer.apk"
```

`-r` 表示覆盖安装（升级时保留应用数据）。手机上需要先打开「开发者选项 → USB 调试」。

### 方式 B：直接把 APK 传到手机

1. 用微信/QQ/网盘/数据线把 `dist\android\yuedu-trainer.apk` 传到手机；
2. 在文件管理器里点击这个 APK；
3. 系统会提示「禁止安装未知应用」，按提示进入「设置 → 安全 → 安装未知应用 / 未知来源」，
   给当前文件管理器（或浏览器）**允许安装**；
4. 返回后继续安装。首次安装可能有「Play 保护机制」提示，选择「仍要安装」即可。

卸载：桌面长按图标 → 卸载；或在「设置 → 应用」里找到「读谱训练器」卸载。

### 支持的设备

Android 5.0（API 21）及以上。因为不申请网络权限、也不做后台服务，安装包很小（约 1.5 MB），
在旧机器上也很流畅。

---

## 五、签名与密钥

- 密钥文件：`android/keystore/yuedu-release.jks`（首次打包时由 `keytool` 自动生成，**已加入 .gitignore**）；
- 别名 `yuedu`，口令 `yuedu-trainer`，有效期 10000 天，`CN=YueDu Trainer`；
- 口令**写在 `tools/build-apk.js` 顶部的常量里**，这是有意的：这是一个**纯本地、离线、自用/小范围分发**的项目，
  不需要向应用商店提交，也不需要保护分发密钥。这样任何人都能一条命令复现出同样的 APK。
- **自签名**的含义：证书不是 CA 签发的，Android 只要求「同一应用的后续版本用同一把钥匙签名」，
  不要求证书由谁签发 —— 所以自签名 APK 可以正常安装使用。
- 如果你要上架应用商店（Google Play、国内各家），请**自己生成新的 keystore 并妥善保管**，
  不要把口令提交到公开仓库，同时改用 `--ks` 指向你自己的密钥。**一旦丢失密钥，就无法再给已安装的用户推送升级。**

换一把新钥匙后，手机上必须先卸载旧版本再装新版本（签名不一致系统会直接拒绝覆盖安装）。

---

## 六、为什么不需要联网

网页资源（`index.html`、`src/**`、`vendor/vexflow.js`、`icons/**`）全部打包进 APK 的 `assets/` 目录，
运行时通过 `file:///android_asset/...` 读取，不产生任何网络请求：

- `AndroidManifest.xml` 里**没有** `android.permission.INTERNET`；
- `WebSettings.setCacheMode(LOAD_DEFAULT)` 只用于磁盘缓存本地资源；
- `sw.js`（Service Worker）在 `file://` 下不会注册，也不影响功能。

所以飞行模式下打开应用，所有功能（包括调音器）都正常。

---

## 七、调音器的麦克风授权

调音器要用 `getUserMedia({audio:true})` 采集麦克风，代码里做了**两层**处理，缺一不可：

1. **系统层**：`AndroidManifest.xml` 声明 `android.permission.RECORD_AUDIO`；
   `MainActivity` 在启动时调用 `requestPermissions()` 主动申请一次（Android 6+ 运行时权限）。
   如果用户这次拒绝了，不影响其它功能。
2. **网页层**：WebView 里 `getUserMedia` 的授权请求会走到 `WebChromeClient.onPermissionRequest()`。
   代码在回调里只对 `RESOURCE_AUDIO_CAPTURE`（音频采集）调用 `request.grant(...)`，其余一律 `deny()`。
   如果此时系统权限还没拿到，会先把请求暂存，等 `onRequestPermissionsResult` 返回授权结果后再补上 `grant()`，
   否则网页侧会收到一个立即失败的 Promise（表现为「调音器一直显示没有权限」）。

使用时：进入「调音器」标签页 → 点开始 → 第一次会弹出系统麦克风授权 → 选择「允许」。
如果误点了「拒绝」：进入「设置 → 应用 → 读谱训练器 → 权限 → 麦克风」打开即可，
或卸载重装。没插耳机时请把手机靠近乐器，环境安静时读数更稳。

另外，`setMediaPlaybackRequiresUserGesture(false)` 保证了节拍器与播放不需要额外的手势就能出声。

---

## 八、如何改包名 / 版本号

要改的地方有**两处**，必须保持一致：

1. `android/AndroidManifest.xml`：`package="…"`、`android:versionCode`、`android:versionName`
   （以及 `src/com/yuedu/trainer/` 目录与 `MainActivity.java` 的 `package` 语句，若改 Java 包名）；
2. `tools/build-apk.js` 顶部的 `APP` 常量：`packageName`、`versionName`、`versionCode`、`minSdk`、`targetSdk`；
   同时 `tools/verify-apk.js` 顶部的 `EXPECT` 常量也要跟着改，否则校验会失败。

只改版本号（例如发 1.2.0 的升级包）时：

```js
// tools/build-apk.js
const APP = { packageName: 'com.yuedu.trainer', versionName: '1.2.0', versionCode: 3, ... };
```

```xml
<!-- android/AndroidManifest.xml -->
<manifest package="com.yuedu.trainer" android:versionCode="3" android:versionName="1.2.0">
```

> ⚠️ `versionCode` 必须**递增**，否则手机不会把它当成升级（同一个 versionCode 只能覆盖安装）。

改完重新 `node tools/build-apk.js`，用同一把 keystore 签名，就能覆盖安装到旧版本上，练习记录会保留。

---

## 九、常见问题

| 现象 | 原因与解决 |
|---|---|
| 打包报「工具链尚未就绪」 | 缺 JDK 或 build-tools；按提示的目录结构补齐，或用 `--tools` 指定 |
| `aapt2 link` 失败 | 多为 `AndroidManifest.xml` 引用了不存在的资源（如 `@mipmap/icon`），或 minSdk/targetSdk 与 `android.jar` 不匹配 |
| `javac` 报「找不到符号: R」 | 资源编译没成功；看第 2 步日志，确认 `android/build/gen/…/R.java` 已生成 |
| `d8` 失败 | 确认 `JAVA_HOME` 指向 JDK 17；脚本已内置「失败后改用 `java -cp lib/d8.jar`」的重试 |
| 装上后白屏 | 检查 APK 内是否含 `assets/index.html`、`assets/src/*.js`、`assets/vendor/vexflow.js`（`node tools/verify-apk.js` 会断言） |
| 调音器没声音/没反应 | 在系统设置里给应用开麦克风权限；确认手机没静音、没被其它应用占用麦克风 |
| 节拍器不出声 | 本应用已关闭「需要用户手势」限制；若仍无声，检查媒体音量（不是铃声音量） |
| 覆盖安装被拒绝 | 新 APK 的签名和已装版本不一致（换了 keystore）。先卸载旧版本再安装 |
| 导出 PNG 没反应 | WebView 不会自动保存 `blob:` 链接的下载；可在电脑浏览器里导出，或使用「复制文字表」等替代方式 |
