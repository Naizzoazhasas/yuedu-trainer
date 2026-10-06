package com.yuedu.trainer;

import android.content.ContentValues;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.widget.Toast;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.util.HashMap;
import java.util.Map;

/**
 * 网页 → Android 的「保存文件」桥接（支持分块传输）。
 *
 * <p>为什么需要它：应用里的「保存为图片 / 导出 MIDI / 导出 MusicXML」都是用 Blob +
 * {@code <a download>} 触发的下载。普通浏览器会自己处理，但 WebView 默认**没有下载能力**，
 * 于是手机上点了按钮会毫无反应。这里把网页侧的 Blob 转成 base64 传进来，由原生代码写进
 * 系统相册（图片）或「下载」目录（MIDI / MusicXML / 文本）。
 *
 * <p>为什么分块：一次性把几 MB 的 base64 通过 JS→Java 边界传过去，在部分 WebView 版本上
 * 会失败或卡顿。所以网页侧按 192 KB 分块调用 {@link #appendSave}，最后 {@link #finishSave}
 * 落盘（或 {@link #abortSave} 放弃）。
 *
 * <p>安全与健壮性：
 * <ul>
 *   <li>只接受白名单后缀（png/jpg/webp/mid/midi/xml/mxl/txt/json/csv），其它一律拒绝；</li>
 *   <li>文件名做净化（去掉路径分隔符与非法字符），避免目录穿越；</li>
 *   <li>所有异常都被捕获并返回可读的中文错误，绝不让网页侧崩掉；</li>
 *   <li>会话有数量与总量上限，防止被恶意脚本撑爆内存。</li>
 * </ul>
 */
public class WebBridge {

    private static final String TAG = "YueDuTrainer";

    /** 允许保存的扩展名白名单 */
    private static final String[] ALLOWED_EXT = {
            "png", "jpg", "jpeg", "webp",
            "mid", "midi",
            "xml", "mxl",
            "txt", "json", "csv"
    };

    /** 同时最多几个会话，防止内存被占满 */
    private static final int MAX_SESSIONS = 3;
    /** 单个文件最大 64 MB（base64 长度上限） */
    private static final int MAX_BASE64_LEN = 64 * 1024 * 1024;
    /** 单块最大 1 MB（网页侧实际用 192 KB） */
    private static final int MAX_CHUNK = 1024 * 1024;

    private static final class Session {
        final String name;
        final String mime;
        final int declaredLen;
        final StringBuilder data;

        Session(String name, String mime, int declaredLen) {
            this.name = name;
            this.mime = mime;
            this.declaredLen = declaredLen;
            this.data = new StringBuilder(Math.max(1024, Math.min(declaredLen + 16, 8 * 1024 * 1024)));
        }
    }

    private final MainActivity mActivity;
    private final Map<String, Session> mSessions = new HashMap<String, Session>();

    public WebBridge(MainActivity activity) {
        mActivity = activity;
    }

    /** 网页侧注入的桥接对象名 */
    public static String scriptName() {
        return "__yueduNative";
    }

    /* ==================== 分块保存 ==================== */

    /** 开始一次保存；返回 true 表示可以继续 append */
    @JavascriptInterface
    public synchronized boolean startSave(String id, String fileName, String mimeType, int base64Length) {
        try {
            if (id == null || id.length() == 0) {
                return false;
            }
            if (base64Length <= 0 || base64Length > MAX_BASE64_LEN) {
                Log.w(TAG, "拒绝保存：长度不合法 " + base64Length);
                return false;
            }
            String safeName = sanitizeFileName(fileName);
            String ext = extensionOf(safeName);
            if (!isAllowedExt(ext)) {
                Log.w(TAG, "拒绝保存：不允许的后缀 ." + ext);
                toast("保存失败：不支持的文件类型 ." + ext);
                return false;
            }
            if (mSessions.size() >= MAX_SESSIONS) {
                /* 清掉最旧的会话，避免网页忘记 finish 时内存泄漏 */
                String oldest = mSessions.keySet().iterator().next();
                mSessions.remove(oldest);
                Log.w(TAG, "会话过多，已丢弃 " + oldest);
            }
            String mime = (mimeType == null || mimeType.length() == 0) ? guessMime(ext) : mimeType;
            mSessions.put(id, new Session(safeName, mime, base64Length));
            Log.i(TAG, "开始保存 " + safeName + "（" + base64Length + " 字符 base64）");
            return true;
        } catch (Throwable t) {
            Log.e(TAG, "startSave 异常", t);
            return false;
        }
    }

    /** 追加一块 base64 */
    @JavascriptInterface
    public synchronized boolean appendSave(String id, String chunk) {
        try {
            Session s = mSessions.get(id);
            if (s == null) {
                Log.w(TAG, "appendSave：没有对应会话 " + id);
                return false;
            }
            if (chunk == null || chunk.length() == 0) {
                return true;
            }
            if (chunk.length() > MAX_CHUNK) {
                Log.w(TAG, "appendSave：单块过大 " + chunk.length());
                return false;
            }
            if (s.data.length() + chunk.length() > MAX_BASE64_LEN) {
                Log.w(TAG, "appendSave：超出总长度上限");
                return false;
            }
            s.data.append(chunk);
            return true;
        } catch (Throwable t) {
            Log.e(TAG, "appendSave 异常", t);
            return false;
        }
    }

    /** 结束并落盘；返回可读的中文结果 */
    @JavascriptInterface
    public synchronized String finishSave(String id) {
        Session s;
        try {
            s = mSessions.remove(id);
        } catch (Throwable t) {
            return "保存失败：" + t.getMessage();
        }
        if (s == null) {
            return "保存失败：会话已失效";
        }
        try {
            byte[] bytes = Base64.decode(s.data.toString(), Base64.DEFAULT);
            s.data.setLength(0);
            if (bytes.length == 0) {
                return "保存失败：内容为空";
            }
            String where = writeFile(bytes, s.name, s.mime);
            if (where == null) {
                return "保存失败：无法写入存储";
            }
            final String msg = "已保存到 " + where;
            Log.i(TAG, msg + "（" + bytes.length + " 字节）");
            toast(msg);
            return msg;
        } catch (Throwable t) {
            Log.e(TAG, "finishSave 异常", t);
            return "保存失败：" + t.getMessage();
        }
    }

    /** 放弃这次保存（网页侧出错时调用） */
    @JavascriptInterface
    public synchronized void abortSave(String id) {
        if (id != null) {
            mSessions.remove(id);
        }
    }

    /** 网页侧查询是否具备保存能力 */
    @JavascriptInterface
    public boolean canSave() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                return true;
            }
            return mActivity.getExternalFilesDir(null) != null || mActivity.getFilesDir() != null;
        } catch (Throwable t) {
            return false;
        }
    }

    /* ==================== 兼容：一次性保存（小文件） ==================== */

    @JavascriptInterface
    public String saveFile(String base64Data, String fileName, String mimeType) {
        if (base64Data == null || base64Data.length() == 0) {
            return "保存失败：内容为空";
        }
        if (!startSave("one-shot", fileName, mimeType, base64Data.length())) {
            return "保存失败：无法开始保存";
        }
        if (!appendSave("one-shot", base64Data)) {
            abortSave("one-shot");
            return "保存失败：写入中断";
        }
        return finishSave("one-shot");
    }

    /* ==================== 实际写入 ==================== */

    /**
     * 写入策略：
     * <ul>
     *   <li>Android 10（API 29）及以上：走 MediaStore，
     *       图片进相册（Pictures/读谱训练器），其它进「下载」（Download/读谱训练器），
     *       这样**不需要申请任何存储权限**；</li>
     *   <li>Android 9 及以下：写到应用自己的外部目录
     *       （Android/data/com.yuedu.trainer/files/导出/），同样不需要权限，
     *       缺点是用户要用文件管理器去这个目录找。</li>
     * </ul>
     */
    private String writeFile(byte[] bytes, String fileName, String mime) throws Exception {
        boolean isImage = mime != null && mime.startsWith("image/");

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ContentValues values = new ContentValues();
            values.put(MediaStore.MediaColumns.DISPLAY_NAME, fileName);
            values.put(MediaStore.MediaColumns.MIME_TYPE, mime);
            String relDir = (isImage ? Environment.DIRECTORY_PICTURES : Environment.DIRECTORY_DOWNLOADS)
                    + "/读谱训练器";
            values.put(MediaStore.MediaColumns.RELATIVE_PATH, relDir);

            Uri collection = isImage
                    ? MediaStore.Images.Media.EXTERNAL_CONTENT_URI
                    : MediaStore.Downloads.EXTERNAL_CONTENT_URI;

            Uri item = mActivity.getContentResolver().insert(collection, values);
            if (item == null) {
                return null;
            }
            OutputStream out = mActivity.getContentResolver().openOutputStream(item);
            if (out == null) {
                return null;
            }
            try {
                out.write(bytes);
                out.flush();
            } finally {
                try { out.close(); } catch (Throwable ignored) { }
            }
            return (isImage ? "相册 Pictures" : "下载 Download") + "/读谱训练器/" + fileName;

        } else {
            File base = mActivity.getExternalFilesDir(null);
            if (base == null) {
                base = mActivity.getFilesDir();
            }
            File dir = new File(base, "导出");
            if (!dir.exists() && !dir.mkdirs()) {
                Log.w(TAG, "无法创建导出目录：" + dir);
            }
            File target = new File(dir, fileName);
            FileOutputStream fos = new FileOutputStream(target);
            try {
                fos.write(bytes);
                fos.flush();
            } finally {
                try { fos.close(); } catch (Throwable ignored) { }
            }
            return target.getAbsolutePath();
        }
    }

    private void toast(final String msg) {
        try {
            mActivity.runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    Toast.makeText(mActivity, msg, Toast.LENGTH_LONG).show();
                }
            });
        } catch (Throwable t) {
            Log.w(TAG, "Toast 失败：" + t);
        }
    }

    /* ==================== 工具方法 ==================== */

    /** 去掉路径分隔符与危险字符，避免目录穿越与非法文件名 */
    static String sanitizeFileName(String name) {
        if (name == null || name.trim().length() == 0) {
            name = "yuedu-export";
        }
        String n = name.trim();
        n = n.replace('\\', '_').replace('/', '_');
        n = n.replaceAll("[\\r\\n\\t\\x00]", "");
        n = n.replaceAll("[:*?\"<>|]", "_");
        if (n.length() > 120) {
            String ext = extensionOf(n);
            n = n.substring(0, 100) + (ext.length() > 0 ? "." + ext : "");
        }
        return n;
    }

    static String extensionOf(String name) {
        if (name == null) {
            return "";
        }
        int dot = name.lastIndexOf('.');
        if (dot < 0 || dot == name.length() - 1) {
            return "";
        }
        return name.substring(dot + 1).toLowerCase();
    }

    static boolean isAllowedExt(String ext) {
        for (String allow : ALLOWED_EXT) {
            if (allow.equals(ext)) {
                return true;
            }
        }
        return false;
    }

    static String guessMime(String ext) {
        if ("png".equals(ext)) return "image/png";
        if ("jpg".equals(ext) || "jpeg".equals(ext)) return "image/jpeg";
        if ("webp".equals(ext)) return "image/webp";
        if ("mid".equals(ext) || "midi".equals(ext)) return "audio/midi";
        if ("xml".equals(ext) || "mxl".equals(ext)) return "application/xml";
        if ("json".equals(ext)) return "application/json";
        if ("csv".equals(ext)) return "text/csv";
        return "text/plain";
    }
}
