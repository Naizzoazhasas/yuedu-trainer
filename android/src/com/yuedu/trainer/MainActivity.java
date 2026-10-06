package com.yuedu.trainer;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.view.ViewGroup;
import android.view.Window;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.InputStream;

/**
 * 读谱训练器 —— Android 外壳（一个最小 WebView 容器）。
 *
 * <p>这个 Activity 不做任何业务逻辑，全部功能都由打包在 assets/ 里的网页实现。
 * 它只负责三件事：
 * <ol>
 *   <li>用 WebView 加载 file:///android_asset/index.html，并打开网页在 file:// 下正常工作所需要的开关；</li>
 *   <li>把麦克风权限在「系统层（RECORD_AUDIO）」与「网页层（getUserMedia 的 PermissionRequest）」
 *       两面都打通 —— 调音器靠它工作；</li>
 *   <li>处理返回键与外链跳转，让应用用起来像原生 App。</li>
 * </ol>
 *
 * <p>本应用不申请 INTERNET 权限：所有资源都在 APK 内，完全离线。
 */
public class MainActivity extends Activity {

    private static final String TAG = "YueDuTrainer";

    /** 离线应用入口：网页资源打包在 APK 的 assets/ 目录下，没有网络请求 */
    private static final String START_URL = "file:///android_asset/index.html";

    /** 主动申请录音权限的请求码 */
    private static final int REQ_RECORD_AUDIO = 1001;

    /** 深色主题色，与网页 <meta name="theme-color" content="#0f1420"> 保持一致 */
    private static final String THEME_COLOR = "#0f1420";

    private WebView mWebView;

    /** 网页 → 原生的文件保存桥接（导出 PNG / MIDI / MusicXML 靠它） */
    private WebBridge mBridge;

    /** bridge.js 是否已注入（只注一次） */
    private boolean mBridgeInjected;

    /**
     * 网页通过 getUserMedia() 发起的麦克风请求。
     * 如果此时系统权限还没授予，就先把它暂存下来，等 onRequestPermissionsResult 里
     * 拿到 RECORD_AUDIO 之后再调用 grant()，否则网页拿到的是一个立即失败的 Promise。
     */
    private PermissionRequest mPendingAudioRequest;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Log.i(TAG, "启动读谱训练器外壳，加载 " + START_URL);

        // 深色配色：状态栏/导航栏染色（API 21+）
        Window win = getWindow();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            try {
                win.setStatusBarColor(Color.parseColor(THEME_COLOR));
                win.setNavigationBarColor(Color.parseColor(THEME_COLOR));
            } catch (Throwable t) {
                // 少数定制 ROM 上染色可能抛异常，绝不让它影响启动
                Log.w(TAG, "状态栏染色失败（可忽略）：" + t);
            }
        }

        // 纯代码创建 WebView，省掉一份 layout XML
        mWebView = new WebView(this);
        mWebView.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        // WebView 默认白底，加载前先刷成深色，避免出现一瞬间的白闪
        mWebView.setBackgroundColor(Color.parseColor(THEME_COLOR));
        setContentView(mWebView);

        configureWebSettings(mWebView.getSettings());
        installJsBridge();
        installWebViewClient();
        installWebChromeClient();

        // 适配 Android 6+：运行时权限必须主动申请一次。
        // 这里在启动时申请，是为了让用户第一次进「调音器」时不必再看到一次延迟弹窗；
        // 若用户拒绝也不影响其它功能，后续网页再次请求麦克风时会重新走 onPermissionRequest。
        requestRecordAudioPermissionIfNeeded();

        if (savedInstanceState == null) {
            mWebView.loadUrl(START_URL);
        } else {
            // 旋转/重建后恢复历史（本应用已用 configChanges 尽量避免重建，这里只是兜底）
            mWebView.restoreState(savedInstanceState);
        }
    }

    /* ==================== JS 桥接：导出文件 / 提示 ==================== */

    /**
     * 注入两样东西：
     * <ol>
     *   <li>{@code window.__yueduNative}：保存文件的接口（分块：startSave / appendSave / finishSave）；
     *       没有它，「保存为图片」「导出 MIDI / MusicXML」在手机上点了会毫无反应；</li>
     *   <li>{@code window.__yueduToast}：让网页把提示信息交给原生 Toast 显示，
     *       比网页自己的 toast 更醒目（存到相册/下载目录这类信息需要用户看见）。</li>
     * </ol>
     * 桥接脚本本身随 APK 打包在 assets/bridge.js，由 onPageFinished 注入，
     * 这样它是冷启动第一帧之前就已存在，网页里的点击拦截不会漏掉。
     */
    private void installJsBridge() {
        mBridge = new WebBridge(this);
        mWebView.addJavascriptInterface(mBridge, WebBridge.scriptName());

        // 原生 Toast 出口：网页调用 window.__yueduToast('...')
        mWebView.addJavascriptInterface(new Object() {
            @JavascriptInterface
            public void show(final String msg) {
                if (msg == null) {
                    return;
                }
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        Toast.makeText(MainActivity.this, msg, Toast.LENGTH_LONG).show();
                    }
                });
            }
        }, "__yueduToastNative");
    }

    /** 页面加载完成后注入桥接脚本；只注入一次 */
    private void injectBridgeScript() {
        if (mBridgeInjected) {
            return;
        }
        mBridgeInjected = true;
        try {
            String js = readAsset("bridge.js");
            if (js == null) {
                Log.w(TAG, "assets/bridge.js 不存在，导出功能在手机上可能不可用");
                return;
            }
            mWebView.evaluateJavascript(js, null);
            // 让网页优先用原生 Toast（更醒目），失败时网页会退回自己的提示
            mWebView.evaluateJavascript(
                    "(function(){try{window.__yueduToast=function(m){try{__yueduToastNative.show(String(m));}"
                            + "catch(e){}};}catch(e){}})();", null);
            Log.i(TAG, "已注入 bridge.js（导出保存桥接）");
        } catch (Throwable t) {
            Log.w(TAG, "注入 bridge.js 失败：" + t);
        }
    }

    /** 读取 assets 下的文本资源 */
    private String readAsset(String name) {
        InputStream in = null;
        try {
            in = getAssets().open(name);
            java.io.ByteArrayOutputStream bos = new java.io.ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) {
                bos.write(buf, 0, n);
            }
            return new String(bos.toByteArray(), "UTF-8");
        } catch (Throwable t) {
            Log.w(TAG, "读取 assets/" + name + " 失败：" + t);
            return null;
        } finally {
            if (in != null) {
                try { in.close(); } catch (Throwable ignored) { }
            }
        }
    }

    /* ==================== WebSettings：网页在 file:// 下正常工作所需的全部开关 ==================== */

    private void configureWebSettings(WebSettings s) {
        // 1) 整个应用是 JS 写的，不开就没有任何功能
        s.setJavaScriptEnabled(true);

        // 2) localStorage：练习记录、自定义音型、偏好设置都存在这里（不开会直接丢失/报错）
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);

        // 3) 音频：节拍器与播放走 WebAudio。
        //    部分 WebView 版本把 WebAudio 也纳入「需要用户手势」的媒体播放策略，
        //    要求手势时会出现「按了播放却没声音」或要按两次才出声，因此必须关掉该限制。
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.JELLY_BEAN_MR1) {
            s.setMediaPlaybackRequiresUserGesture(false);
        }

        // 4) file:// 访问：index.html 通过相对路径加载 src/*.js 与 vendor/vexflow.js，
        //    WebView 从 API 16 起默认禁止 file:// 页面读取其它 file:// 资源，
        //    下面两行打开这个限制，否则页面会白屏（所有脚本都加载失败）。
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(true);
        s.setAllowFileAccessFromFileURLs(true);
        s.setAllowUniversalAccessFromFileURLs(true);

        // 5) 缓存：本地资源不需要特殊策略，交给 WebView 默认处理
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setDefaultTextEncodingName("UTF-8");

        // 6) 视口：网页自己有响应式布局，禁掉双指缩放（缩放手势会和谱面横向滚动打架），
        //    同时开启宽视口 + 概览模式，让 <meta name="viewport"> 生效。
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);

        // 7) 允许脚本打开新窗口（当前没有用到，留着避免以后加「帮助页」时踩坑）
        s.setJavaScriptCanOpenWindowsAutomatically(true);

        // 8) 混合内容：本应用不联网，这里只是放宽策略，避免以后引入 http 资源时被拦
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        }
    }

    /* ==================== WebViewClient：外链 / 错误处理 ==================== */

    private void installWebViewClient() {
        mWebView.setWebViewClient(new WebViewClient() {

            /**
             * 页面加载完成后注入导出保存桥接（bridge.js）。
             * 放在这里而不是 onCreate 里，是因为 evaluateJavascript 必须在页面文档存在之后调用。
             */
            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                injectBridgeScript();
            }

            /** 返回 true 表示「已由我们自己处理，WebView 不要加载」 */
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return handleUrl(request == null ? null : request.getUrl());
            }

            /** API < 24 的旧回调（minSdk 21 需要） */
            @Override
            @SuppressWarnings("deprecation")
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return handleUrl(url == null ? null : Uri.parse(url));
            }

            /** API 23+ 的错误回调 */
            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                // 只记日志：子资源（例如 file:// 下用不到的资源）加载失败时，
                // 千万不要在这里 loadData() 一个兜底页，那会把已经渲染好的界面刷白。
                if (request != null && request.isForMainFrame()) {
                    Log.w(TAG, "主框架加载失败：" + (error == null ? "未知错误" : error.getDescription())
                            + " url=" + request.getUrl());
                } else {
                    Log.d(TAG, "子资源加载失败（已忽略）");
                }
            }

            /** API < 23 的旧错误回调，同样只记日志 */
            @Override
            @SuppressWarnings("deprecation")
            public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
                Log.w(TAG, "资源加载失败（旧回调）：code=" + errorCode + " " + description + " url=" + failingUrl);
            }
        });
    }

    /**
     * 外链策略：http/https 交给系统浏览器打开（应用本身不联网），
     * 其余（file://、about:、blob: 等）一律留在 WebView 里，保证内部跳转正常。
     */
    private boolean handleUrl(Uri uri) {
        if (uri == null) {
            return false;
        }
        String scheme = uri.getScheme();
        if (scheme == null) {
            return false;
        }
        if (scheme.equalsIgnoreCase("http") || scheme.equalsIgnoreCase("https")) {
            try {
                Intent intent = new Intent(Intent.ACTION_VIEW, uri);
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(intent);
            } catch (Throwable t) {
                Log.w(TAG, "没有可打开该链接的应用：" + uri, t);
            }
            return true;
        }
        return false;
    }

    /* ==================== 麦克风：WebChromeClient + 运行时权限 ==================== */

    private void installWebChromeClient() {
        mWebView.setWebChromeClient(new WebChromeClient() {

            /**
             * 网页调用 getUserMedia({audio:true}) 时，WebView 会把请求送到这里。
             * 这是调音器能否工作的关键：不 grant 的话，网页侧永远拿不到麦克风。
             */
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        boolean wantsAudio = false;
                        String[] resources = request.getResources();
                        if (resources != null) {
                            for (String res : resources) {
                                if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(res)) {
                                    wantsAudio = true;
                                }
                            }
                        }
                        // 只放行音频采集；摄像头/视频等一律拒绝（本应用不需要）
                        if (!wantsAudio) {
                            Log.w(TAG, "拒绝非音频的网页权限请求");
                            request.deny();
                            return;
                        }
                        if (hasRecordAudioPermission()) {
                            Log.i(TAG, "授予网页麦克风权限（RESOURCE_AUDIO_CAPTURE）");
                            request.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
                        } else {
                            // 系统权限还没给：暂存请求，先去申请；结果回来后（或被拒绝时）再决定
                            Log.i(TAG, "系统尚未授予 RECORD_AUDIO，先申请再回复网页");
                            mPendingAudioRequest = request;
                            requestRecordAudioPermissionIfNeeded();
                        }
                    }
                });
            }

            /** 网页主动取消（例如用户离开了调音器页面）时清掉暂存，避免误 grant */
            @Override
            public void onPermissionRequestCanceled(PermissionRequest request) {
                if (mPendingAudioRequest == request) {
                    mPendingAudioRequest = null;
                }
            }
        });
    }

    private boolean hasRecordAudioPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
            return true; // Android 6 以下在安装时就授权了
        }
        return checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
    }

    /** Android 6+ 需要运行时申请；已授权或系统太老则跳过 */
    private void requestRecordAudioPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
            return;
        }
        if (hasRecordAudioPermission()) {
            return;
        }
        try {
            requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, REQ_RECORD_AUDIO);
            Log.i(TAG, "已向系统申请 RECORD_AUDIO 权限");
        } catch (Throwable t) {
            Log.w(TAG, "申请录音权限失败：" + t);
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != REQ_RECORD_AUDIO) {
            return;
        }
        boolean granted = grantResults != null && grantResults.length > 0
                && grantResults[0] == PackageManager.PERMISSION_GRANTED;
        Log.i(TAG, "RECORD_AUDIO 权限申请结果：" + (granted ? "已授权" : "被拒绝"));

        PermissionRequest pending = mPendingAudioRequest;
        mPendingAudioRequest = null;
        if (pending != null) {
            if (granted) {
                // 用户刚同意：把网页那边的请求补上，调音器立刻可用
                pending.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
            } else {
                // 明确拒绝，让网页侧收到失败（调音器会显示「没有麦克风权限」的提示）
                pending.deny();
            }
        }
    }

    /* ==================== 生命周期与返回键 ==================== */

    /** 返回键：WebView 能后退就先后退，否则交回系统（退出应用） */
    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (mWebView != null && mWebView.canGoBack()) {
            mWebView.goBack();
            return;
        }
        super.onBackPressed();
    }

    @Override
    protected void onPause() {
        if (mWebView != null) {
            mWebView.onPause();
        }
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (mWebView != null) {
            mWebView.onResume();
        }
    }

    @Override
    protected void onDestroy() {
        if (mWebView != null) {
            mWebView.stopLoading();
            mWebView.destroy();
            mWebView = null;
        }
        super.onDestroy();
    }
}
