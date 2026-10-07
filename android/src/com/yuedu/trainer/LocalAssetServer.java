package com.yuedu.trainer;

import android.content.res.AssetManager;
import android.util.Log;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URLConnection;
import java.net.URLDecoder;
import java.util.HashMap;
import java.util.Map;

/**
 * 极简本地 HTTP 服务器：只把 APK 里 assets/ 的静态资源通过
 * <code>http://127.0.0.1:&lt;port&gt;/</code> 提供给 WebView。
 *
 * <h3>为什么需要它（这是调音器能不能用的关键）</h3>
 * 浏览器（含 Android WebView 里的 Chromium）规定：<b>只有「安全上下文」才允许
 * getUserMedia 采集麦克风</b>。安全上下文包括 https、<b>http://127.0.0.1 / localhost</b>，
 * 而 <code>file://</code> 不算。所以如果直接用 file:///android_asset/index.html 加载网页，
 * 网页里 <code>navigator.mediaDevices</code> 是 undefined，调音器必然显示「不可用」。
 *
 * <p>AndroidX 的 WebViewAssetLoader 也是这个思路（映射到 https 虚拟域名），但引入它需要
 * 额外依赖；本实现只用 JDK 自带的 ServerSocket，零第三方库，效果等价：
 * WebView 加载 <code>http://127.0.0.1:PORT/</code>，于是
 * <ul>
 *   <li>是安全上下文 → 调音器可申请麦克风；</li>
 *   <li>是 http 源 → localStorage / IndexedDB / Service Worker 行为与普通网站一致；</li>
 *   <li>只绑定回环地址 → 不对外暴露，也不需要有网络权限（手机自身回环流量）。</li>
 * </ul>
 *
 * <h3>安全边界</h3>
 * <ul>
 *   <li>只监听 127.0.0.1（{@link InetAddress#getLoopbackAddress()}），局域网访问不到；</li>
 *   <li>只提供 assets/ 下的只读文件，且做了路径规范化，禁止 <code>..</code> 越界；</li>
 *   <li>端口由系统随机分配（bind 0），避免与其它应用冲突；</li>
 *   <li>每个连接只处理一个请求就关闭，最简 HTTP/1.1，够用且不易出错。</li>
 * </ul>
 */
public class LocalAssetServer {

    private static final String TAG = "YueDuTrainer";

    /** 静态资源的 MIME 表（URLConnection 猜不准的自己补齐） */
    private static final Map<String, String> MIME = new HashMap<String, String>();

    static {
        MIME.put("html", "text/html; charset=utf-8");
        MIME.put("htm", "text/html; charset=utf-8");
        MIME.put("js", "application/javascript; charset=utf-8");
        MIME.put("mjs", "application/javascript; charset=utf-8");
        MIME.put("css", "text/css; charset=utf-8");
        MIME.put("json", "application/json; charset=utf-8");
        MIME.put("webmanifest", "application/manifest+json; charset=utf-8");
        MIME.put("svg", "image/svg+xml");
        MIME.put("png", "image/png");
        MIME.put("jpg", "image/jpeg");
        MIME.put("jpeg", "image/jpeg");
        MIME.put("webp", "image/webp");
        MIME.put("ico", "image/x-icon");
        MIME.put("txt", "text/plain; charset=utf-8");
        MIME.put("xml", "application/xml; charset=utf-8");
        MIME.put("mid", "audio/midi");
        MIME.put("midi", "audio/midi");
        MIME.put("woff2", "font/woff2");
    }

    private final AssetManager mAssets;
    private ServerSocket mServerSocket;
    private Thread mThread;
    private volatile boolean mRunning;
    private int mPort;

    public LocalAssetServer(AssetManager assets) {
        mAssets = assets;
    }

    /** 随机端口；服务器启动失败时返回 false，调用方应回退到 file:// 加载 */
    public boolean start() {
        try {
            mServerSocket = new ServerSocket(0, 8, InetAddress.getLoopbackAddress());
            mPort = mServerSocket.getLocalPort();
            mRunning = true;
            mThread = new Thread(new Runnable() {
                @Override
                public void run() {
                    loop();
                }
            }, "yuedu-asset-server");
            mThread.setDaemon(true);
            mThread.start();
            Log.i(TAG, "本地资源服务器已启动：http://127.0.0.1:" + mPort + "/（安全上下文，调音器可用）");
            return true;
        } catch (Throwable t) {
            Log.e(TAG, "启动本地资源服务器失败，将回退到 file:// 加载（调音器不可用）", t);
            closeQuietly();
            return false;
        }
    }

    /** 供 WebView 使用的根地址，例如 http://127.0.0.1:38271/ */
    public String baseUrl() {
        return "http://127.0.0.1:" + mPort + "/";
    }

    public String startUrl() {
        return baseUrl() + "index.html";
    }

    public int port() {
        return mPort;
    }

    public boolean isRunning() {
        return mRunning;
    }

    public void stop() {
        mRunning = false;
        closeQuietly();
        if (mThread != null) {
            mThread.interrupt();
            mThread = null;
        }
        Log.i(TAG, "本地资源服务器已停止");
    }

    private void closeQuietly() {
        try {
            if (mServerSocket != null) {
                mServerSocket.close();
            }
        } catch (Throwable ignored) {
            /* 忽略 */
        }
        mServerSocket = null;
    }

    /* ---------------- 请求循环 ---------------- */

    private void loop() {
        while (mRunning) {
            Socket socket = null;
            try {
                socket = mServerSocket.accept();
                socket.setSoTimeout(8000);
                handle(socket);
            } catch (Throwable t) {
                if (mRunning) {
                    Log.w(TAG, "处理请求出错：" + t);
                }
            } finally {
                try {
                    if (socket != null) {
                        socket.close();
                    }
                } catch (Throwable ignored) {
                    /* 忽略 */
                }
            }
        }
    }

    private void handle(Socket socket) throws IOException {
        InputStream in = socket.getInputStream();
        OutputStream out = socket.getOutputStream();

        /* 只读请求行，够用（不实现 POST / chunked） */
        String firstLine = readLine(in, 8192);
        if (firstLine == null) {
            return;
        }
        /* 把请求头读掉，避免客户端等待 */
        for (int i = 0; i < 64; i++) {
            String h = readLine(in, 8192);
            if (h == null || h.length() == 0) {
                break;
            }
        }

        String[] parts = firstLine.split(" ");
        if (parts.length < 2 || !"GET".equalsIgnoreCase(parts[0])) {
            respond(out, 405, "text/plain; charset=utf-8", "Method Not Allowed".getBytes("UTF-8"));
            return;
        }

        String target = parts[1];
        int q = target.indexOf('?');
        if (q >= 0) {
            target = target.substring(0, q);
        }
        int hash = target.indexOf('#');
        if (hash >= 0) {
            target = target.substring(0, hash);
        }
        try {
            target = URLDecoder.decode(target, "UTF-8");
        } catch (Throwable ignored) {
            /* 用原串 */
        }

        String path = normalize(target);
        if (path == null) {
            respond(out, 403, "text/plain; charset=utf-8", "Forbidden".getBytes("UTF-8"));
            return;
        }
        if (path.length() == 0) {
            path = "index.html";
        }

        byte[] body = readAssetOrNull(path);
        if (body == null) {
            /* 找不到：对 SPA 友好的 404，正文给中文提示便于排查 */
            String msg = "404 找不到资源：" + path;
            respond(out, 404, "text/plain; charset=utf-8", msg.getBytes("UTF-8"));
            Log.w(TAG, msg);
            return;
        }
        respond(out, 200, mimeOf(path), body);
    }

    /**
     * 规范化请求路径：
     * - 去掉开头的 "/"
     * - 禁止 ".." 与 "\\"（防目录穿越）
     * - 空路径表示目录，交给调用方当 index.html
     * 返回 null 表示非法请求。
     */
    private String normalize(String target) {
        if (target == null) {
            return null;
        }
        String p = target.replace('\\', '/');
        while (p.startsWith("/")) {
            p = p.substring(1);
        }
        if (p.indexOf("..") >= 0) {
            return null;
        }
        /* 去掉重复斜杠 */
        while (p.indexOf("//") >= 0) {
            p = p.replace("//", "/");
        }
        return p;
    }

    /** 尝试读取 assets 下的文件；若该路径是目录，则尝试其下的 index.html */
    private byte[] readAssetOrNull(String path) {
        byte[] b = tryRead(path);
        if (b != null) {
            return b;
        }
        if (!path.endsWith("/")) {
            byte[] idx = tryRead(path + "/index.html");
            if (idx != null) {
                return idx;
            }
        }
        return null;
    }

    private byte[] tryRead(String path) {
        InputStream in = null;
        try {
            in = mAssets.open(path, AssetManager.ACCESS_STREAMING);
            ByteArrayOutputStream bos = new ByteArrayOutputStream(16 * 1024);
            byte[] buf = new byte[16 * 1024];
            int n;
            while ((n = in.read(buf)) > 0) {
                bos.write(buf, 0, n);
            }
            return bos.toByteArray();
        } catch (Throwable t) {
            return null;
        } finally {
            if (in != null) {
                try {
                    in.close();
                } catch (Throwable ignored) {
                    /* 忽略 */
                }
            }
        }
    }

    private String mimeOf(String path) {
        int dot = path.lastIndexOf('.');
        if (dot >= 0 && dot < path.length() - 1) {
            String ext = path.substring(dot + 1).toLowerCase();
            String m = MIME.get(ext);
            if (m != null) {
                return m;
            }
            String guessed = URLConnection.guessContentTypeFromName(path);
            if (guessed != null) {
                return guessed;
            }
        }
        return "application/octet-stream";
    }

    private void respond(OutputStream out, int code, String mime, byte[] body) throws IOException {
        StringBuilder sb = new StringBuilder();
        sb.append("HTTP/1.1 ").append(code).append(' ').append(reason(code)).append("\r\n");
        sb.append("Content-Type: ").append(mime).append("\r\n");
        sb.append("Content-Length: ").append(body.length).append("\r\n");
        sb.append("Cache-Control: no-store\r\n");
        sb.append("Connection: close\r\n");
        sb.append("\r\n");
        out.write(sb.toString().getBytes("UTF-8"));
        out.write(body);
        out.flush();
    }

    private String reason(int code) {
        if (code == 200) return "OK";
        if (code == 403) return "Forbidden";
        if (code == 404) return "Not Found";
        if (code == 405) return "Method Not Allowed";
        return "OK";
    }

    /** 按字节读一行（以 \n 结尾），带长度上限 */
    private String readLine(InputStream in, int max) throws IOException {
        ByteArrayOutputStream bos = new ByteArrayOutputStream(128);
        int c;
        while ((c = in.read()) != -1) {
            if (c == '\n') {
                break;
            }
            if (c != '\r') {
                bos.write(c);
            }
            if (bos.size() > max) {
                break;
            }
        }
        if (c == -1 && bos.size() == 0) {
            return null;
        }
        return new String(bos.toByteArray(), "UTF-8");
    }
}
