package io.github.w1249178256.xyzwhelper;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Intent;
import android.content.res.ColorStateList;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.Drawable;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.RippleDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.JsPromptResult;
import android.webkit.SslErrorHandler;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebStorage;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.ImageButton;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;
import android.text.TextUtils;
import android.util.Base64;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

public final class MainActivity extends Activity {
    private static final String PREFERENCES = "server_settings";
    private static final String PREF_SERVER_ORIGIN = "server_origin";
    private static final String STATE_SERVER_ORIGIN = "state_server_origin";
    private static final String STATE_WEB_VIEW = "state_web_view";
    private static final String STATE_SETTINGS_VISIBLE = "state_settings_visible";
    private static final String EXPORT_PROMPT_PREFIX = "__XYZW_FILE_EXPORT_V1__";
    private static final int EXPORT_SAVE_REQUEST = 4108;
    private static final SecureRandom SECURE_RANDOM = new SecureRandom();
    private static final int FILE_CHOOSER_REQUEST = 4107;

    private FrameLayout root;
    private LinearLayout page;
    private FrameLayout content;
    private FrameLayout overlay;
    private WebView webView;
    private TextView serverLabel;
    private View toolbarView;
    private View toolbarDivider;
    private String serverOrigin;
    private String exportNonce;
    private boolean settingsVisible;
    private volatile boolean destroyed;
    private volatile long exportOperationId;
    private PendingExport pendingExport;
    private Future<?> exportWriteFuture;
    private final ExecutorService exportExecutor = Executors.newSingleThreadExecutor();
    private View fullscreenView;
    private WebChromeClient.CustomViewCallback fullscreenCallback;
    private int toolbarVisibility = View.VISIBLE;
    private int toolbarDividerVisibility = View.VISIBLE;
    private int fullscreenOriginalPaddingLeft;
    private int fullscreenOriginalPaddingTop;
    private int fullscreenOriginalPaddingRight;
    private int fullscreenOriginalPaddingBottom;
    private boolean fullscreenPaddingSaved;
    private ValueCallback<Uri[]> pendingFileCallback;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);

        serverOrigin = readStoredOrigin();
        buildInterface();
        createWebView();

        if (serverOrigin == null) {
            showSettingsScreen();
            return;
        }

        boolean restored = restoreWebView(savedInstanceState);
        if (!restored) loadTrustedPath("/app");
        if (savedInstanceState != null && savedInstanceState.getBoolean(STATE_SETTINGS_VISIBLE)) {
            showSettingsScreen();
        }
    }

    private String readStoredOrigin() {
        String stored = getSharedPreferences(PREFERENCES, MODE_PRIVATE).getString(PREF_SERVER_ORIGIN, null);
        if (stored == null) return null;
        try {
            return ServerAddressPolicy.normalizeOrigin(stored, BuildConfig.DEBUG);
        } catch (IllegalArgumentException exception) {
            getSharedPreferences(PREFERENCES, MODE_PRIVATE).edit().remove(PREF_SERVER_ORIGIN).apply();
            return null;
        }
    }

    private void buildInterface() {
        root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        page = new LinearLayout(this);
        page.setOrientation(LinearLayout.VERTICAL);
        page.setBackgroundColor(getColor(R.color.native_background));

        LinearLayout toolbar = new LinearLayout(this);
        toolbarView = toolbar;
        toolbar.setOrientation(LinearLayout.HORIZONTAL);
        toolbar.setGravity(Gravity.CENTER_VERTICAL);
        toolbar.setPadding(dp(9), 0, dp(9), 0);
        toolbar.setBackgroundColor(getColor(R.color.native_surface));

        serverLabel = textView("连接服务器", 12f, false);
        serverLabel.setSingleLine(true);
        serverLabel.setEllipsize(TextUtils.TruncateAt.END);
        serverLabel.setGravity(Gravity.CENTER_VERTICAL | Gravity.START);
        serverLabel.setContentDescription("当前服务器地址");
        toolbar.addView(serverLabel, new LinearLayout.LayoutParams(0, dp(48), 1f));

        ImageButton home = iconButton(R.drawable.ic_home, "回到功能首页",
                () -> navigateToPath("/app"));
        toolbar.addView(home, new LinearLayout.LayoutParams(dp(48), dp(48)));
        ImageButton refresh = iconButton(R.drawable.ic_refresh, "刷新页面", this::reloadPage);
        toolbar.addView(refresh, new LinearLayout.LayoutParams(dp(48), dp(48)));
        ImageButton settings = iconButton(R.drawable.ic_settings, "服务器设置", this::showSettingsScreen);
        toolbar.addView(settings, new LinearLayout.LayoutParams(dp(48), dp(48)));
        page.addView(toolbar, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(48)));

        View divider = new View(this);
        toolbarDivider = divider;
        divider.setBackgroundColor(getColor(R.color.native_border));
        page.addView(divider, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(1)));

        content = new FrameLayout(this);
        page.addView(content, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        root.addView(page, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        ViewCompat.setOnApplyWindowInsetsListener(root, (view, insets) -> {
            Insets safeArea = insets.getInsets(
                    WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            Insets ime = insets.getInsets(WindowInsetsCompat.Type.ime());
            page.setPadding(safeArea.left, safeArea.top, safeArea.right,
                    Math.max(safeArea.bottom, ime.bottom));
            if (fullscreenView != null) {
                Insets cutout = insets.getInsets(WindowInsetsCompat.Type.displayCutout());
                fullscreenView.setPadding(
                        fullscreenOriginalPaddingLeft + cutout.left,
                        fullscreenOriginalPaddingTop + cutout.top,
                        fullscreenOriginalPaddingRight + cutout.right,
                        fullscreenOriginalPaddingBottom + Math.max(cutout.bottom, ime.bottom));
            }
            return insets;
        });
        setContentView(root);
        updateServerLabel();
    }

    private ImageButton iconButton(int icon, String description, Runnable action) {
        ImageButton button = new ImageButton(this);
        button.setImageResource(icon);
        button.setScaleType(ImageView.ScaleType.CENTER_INSIDE);
        button.setPadding(dp(13), dp(13), dp(13), dp(13));
        button.setBackground(rippleBackground(getColor(R.color.native_surface), Color.TRANSPARENT, 14));
        button.setContentDescription(description);
        button.setTooltipText(description);
        button.setOnClickListener(view -> action.run());
        return button;
    }

    private void createWebView() {
        webView = new WebView(this);
        webView.setBackgroundColor(Color.WHITE);
        webView.setFocusable(true);
        webView.setFocusableInTouchMode(true);

        CookieManager cookieManager = CookieManager.getInstance();
        cookieManager.setAcceptCookie(true);
        cookieManager.setAcceptThirdPartyCookies(webView, false);

        webView.getSettings().setJavaScriptEnabled(true);
        webView.getSettings().setDomStorageEnabled(true);
        webView.getSettings().setDatabaseEnabled(true);
        webView.getSettings().setAllowContentAccess(true);
        webView.getSettings().setAllowFileAccess(false);
        webView.getSettings().setAllowFileAccessFromFileURLs(false);
        webView.getSettings().setAllowUniversalAccessFromFileURLs(false);
        webView.getSettings().setJavaScriptCanOpenWindowsAutomatically(false);
        webView.getSettings().setSupportMultipleWindows(false);
        webView.getSettings().setMixedContentMode(android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return handleNavigation(request.getUrl(), request.isForMainFrame());
            }

            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                clearPendingExport();
                if (fullscreenView != null) hideFullscreen();
                exportNonce = ServerAddressPolicy.isSameOrigin(serverOrigin, url, BuildConfig.DEBUG)
                        ? newExportNonce() : null;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                if (ServerAddressPolicy.isSameOrigin(serverOrigin, url, BuildConfig.DEBUG)
                        && exportNonce != null) {
                    injectExportBridge(exportNonce);
                }
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) {
                    showError("无法连接到服务器，请检查网络和服务器地址后重试。");
                }
            }

            @Override
            public void onReceivedSslError(WebView view, SslErrorHandler handler,
                                           android.net.http.SslError error) {
                handler.cancel();
                showError("服务器 HTTPS 证书无效或不受信任，连接已阻止。请检查服务器域名和证书。");
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                             FileChooserParams params) {
                openDocumentChooser(callback, params);
                return true;
            }

            @Override
            public boolean onJsPrompt(WebView view, String url, String message,
                                      String defaultValue, JsPromptResult result) {
                if (!EXPORT_PROMPT_PREFIX.equals(message)) {
                    return super.onJsPrompt(view, url, message, defaultValue, result);
                }
                handleExportPrompt(url, defaultValue, result);
                return true;
            }

            @Override
            public void onShowCustomView(View view, CustomViewCallback callback) {
                showFullscreen(view, callback);
            }

            @Override
            public void onShowCustomView(View view, int requestedOrientation,
                                         CustomViewCallback callback) {
                showFullscreen(view, callback);
            }

            @Override
            public void onHideCustomView() {
                hideFullscreen();
            }
        });

        content.addView(webView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        webView.requestFocus(View.FOCUS_DOWN);
        overlay = new FrameLayout(this);
        overlay.setBackgroundColor(Color.WHITE);
        overlay.setVisibility(View.GONE);
        content.addView(overlay, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
    }

    private boolean restoreWebView(Bundle savedInstanceState) {
        if (savedInstanceState == null) return false;
        String savedOrigin = savedInstanceState.getString(STATE_SERVER_ORIGIN);
        Bundle webState = savedInstanceState.getBundle(STATE_WEB_VIEW);
        if (!serverOrigin.equals(savedOrigin) || webState == null) return false;
        webView.restoreState(webState);
        String restoredUrl = webView.getUrl();
        if (ServerAddressPolicy.isSameOrigin(serverOrigin, restoredUrl, BuildConfig.DEBUG)) return true;
        webView.clearHistory();
        return false;
    }

    private boolean handleNavigation(Uri uri, boolean mainFrame) {
        if (uri == null || serverOrigin == null) return true;
        String target = uri.toString();
        if (ServerAddressPolicy.isSameOrigin(serverOrigin, target, BuildConfig.DEBUG)) return false;
        if (!mainFrame) return true;

        String scheme = uri.getScheme();
        if (scheme != null && ("http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme))) {
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, uri));
            } catch (ActivityNotFoundException exception) {
                Toast.makeText(this, "没有可打开此链接的浏览器", Toast.LENGTH_SHORT).show();
            }
        }
        return true;
    }

    private void navigateToPath(String path) {
        if (serverOrigin == null) {
            showSettingsScreen();
            return;
        }
        hideOverlay();
        loadTrustedPath(path);
    }

    private void loadTrustedPath(String path) {
        if (serverOrigin == null || webView == null) return;
        String safePath = path.startsWith("/") ? path : "/" + path;
        exportNonce = newExportNonce();
        webView.loadUrl(serverOrigin + safePath);
    }

    private void updateServerLabel() {
        if (serverLabel == null) return;
        if (serverOrigin == null) {
            serverLabel.setText("连接服务器");
            serverLabel.setContentDescription("连接服务器");
            return;
        }
        Uri origin = Uri.parse(serverOrigin);
        String host = origin.getHost();
        int port = origin.getPort();
        String address = host == null ? serverOrigin : host + (port < 0 ? "" : ":" + port);
        serverLabel.setText(getString(R.string.server_label, address));
        serverLabel.setContentDescription("服务器地址：" + address);
    }

    private String newExportNonce() {
        byte[] randomBytes = new byte[24];
        SECURE_RANDOM.nextBytes(randomBytes);
        return Base64.encodeToString(randomBytes, Base64.URL_SAFE | Base64.NO_PADDING | Base64.NO_WRAP);
    }

    private void injectExportBridge(String nonce) {
        if (webView == null || nonce == null || destroyed
                || !ServerAddressPolicy.isSameOrigin(serverOrigin, webView.getUrl(), BuildConfig.DEBUG)) {
            return;
        }
        try (InputStream input = getAssets().open("xyzw-export-bridge.js");
             ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[4096];
            int count;
            while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
            String bridge = output.toString(java.nio.charset.StandardCharsets.UTF_8.name());
            webView.evaluateJavascript(
                    bridge + "\n;window.__XYZW_NATIVE_EXPORT_INSTALL__('" + nonce + "');", null);
        } catch (IOException | RuntimeException exception) {
            Toast.makeText(this, "文件导出支持暂不可用", Toast.LENGTH_SHORT).show();
        }
    }

    private void handleExportPrompt(String frameUrl, String payload, JsPromptResult result) {
        if (destroyed || settingsVisible || exportNonce == null
                || !ServerAddressPolicy.isSameOrigin(serverOrigin, frameUrl, BuildConfig.DEBUG)
                || webView == null
                || !ServerAddressPolicy.isSameOrigin(serverOrigin, webView.getUrl(), BuildConfig.DEBUG)) {
            showExportError("stale");
            result.confirm("rejected");
            return;
        }
        if (pendingExport != null) {
            showExportError("busy");
            result.confirm("rejected");
            return;
        }

        final ExportPolicy.ExportData export;
        try {
            export = ExportPolicy.parsePayload(payload, exportNonce);
        } catch (ExportPolicy.ExportError error) {
            showExportError(error.getCode());
            result.confirm("rejected");
            return;
        } catch (RuntimeException error) {
            showExportError("invalid");
            result.confirm("rejected");
            return;
        }

        long operationId = ++exportOperationId;
        pendingExport = new PendingExport(operationId, export);
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(export.getMimeType());
        intent.putExtra(Intent.EXTRA_TITLE, export.getFilename());
        try {
            startActivityForResult(intent, EXPORT_SAVE_REQUEST);
            result.confirm("accepted");
        } catch (ActivityNotFoundException exception) {
            clearPendingExport();
            showExportError("chooser_unavailable");
            result.confirm("rejected");
        }
    }

    private void showExportError(String code) {
        String message;
        switch (code) {
            case "too_large":
                message = "文件超过 8 MiB，无法导出";
                break;
            case "read_failed":
                message = "文件读取失败，请重试";
                break;
            case "unsupported":
                message = "App 暂不支持服务器直接下载的文件";
                break;
            case "busy":
                message = "已有文件导出正在处理，请稍后再试";
                break;
            case "chooser_unavailable":
                message = "系统保存窗口不可用";
                break;
            case "stale":
                message = "页面已切换，请重新点击导出";
                break;
            default:
                message = "文件导出失败，请重试";
                break;
        }
        Toast.makeText(this, message, Toast.LENGTH_SHORT).show();
    }

    private void writeExportToUri(PendingExport export, Uri destination) {
        long operationId = export.operationId;
        byte[] bytes = export.data.getBytes();
        exportWriteFuture = exportExecutor.submit(() -> {
            boolean saved = false;
            try (OutputStream output = getContentResolver().openOutputStream(destination, "w")) {
                if (output == null) throw new IOException("Unable to open destination");
                int offset = 0;
                while (offset < bytes.length) {
                    if (Thread.currentThread().isInterrupted() || destroyed
                            || exportOperationId != operationId) {
                        throw new IOException("Export cancelled");
                    }
                    int count = Math.min(32 * 1024, bytes.length - offset);
                    output.write(bytes, offset, count);
                    offset += count;
                }
                output.flush();
                saved = true;
            } catch (IOException | RuntimeException exception) {
                saved = false;
            }
            final boolean success = saved;
            if (!destroyed) {
                runOnUiThread(() -> finishExportWrite(operationId, success));
            } else {
                Arrays.fill(bytes, (byte) 0);
            }
        });
    }

    private void finishExportWrite(long operationId, boolean saved) {
        PendingExport export = pendingExport;
        if (export == null || export.operationId != operationId || exportOperationId != operationId) {
            return;
        }
        export.data.clear();
        pendingExport = null;
        exportWriteFuture = null;
        if (saved) {
            Toast.makeText(this, "文件已保存：" + export.data.getFilename(), Toast.LENGTH_SHORT).show();
        } else {
            showExportError("write_failed");
        }
    }

    private void clearPendingExport() {
        exportOperationId++;
        if (pendingExport != null) {
            pendingExport.data.clear();
            pendingExport = null;
        }
        if (exportWriteFuture != null) {
            exportWriteFuture.cancel(true);
            exportWriteFuture = null;
        }
    }

    private void showFullscreen(View view, WebChromeClient.CustomViewCallback callback) {
        if (fullscreenView != null) {
            callback.onCustomViewHidden();
            return;
        }
        fullscreenView = view;
        fullscreenCallback = callback;
        toolbarVisibility = toolbarView.getVisibility();
        toolbarDividerVisibility = toolbarDivider.getVisibility();
        fullscreenOriginalPaddingLeft = view.getPaddingLeft();
        fullscreenOriginalPaddingTop = view.getPaddingTop();
        fullscreenOriginalPaddingRight = view.getPaddingRight();
        fullscreenOriginalPaddingBottom = view.getPaddingBottom();
        fullscreenPaddingSaved = true;
        toolbarView.setVisibility(View.GONE);
        toolbarDivider.setVisibility(View.GONE);
        root.addView(view, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        webView.requestFocus(View.FOCUS_DOWN);
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(getWindow(), root);
        controller.setSystemBarsBehavior(
                WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        controller.hide(WindowInsetsCompat.Type.systemBars());
        ViewCompat.requestApplyInsets(root);
    }

    private void hideFullscreen() {
        if (fullscreenView == null) return;
        View view = fullscreenView;
        root.removeView(view);
        if (fullscreenPaddingSaved) {
            view.setPadding(fullscreenOriginalPaddingLeft, fullscreenOriginalPaddingTop,
                    fullscreenOriginalPaddingRight, fullscreenOriginalPaddingBottom);
        }
        fullscreenView = null;
        fullscreenPaddingSaved = false;
        toolbarView.setVisibility(toolbarVisibility);
        toolbarDivider.setVisibility(toolbarDividerVisibility);
        WindowCompat.getInsetsController(getWindow(), root)
                .show(WindowInsetsCompat.Type.systemBars());
        ViewCompat.requestApplyInsets(root);
        webView.requestFocus(View.FOCUS_DOWN);
        WebChromeClient.CustomViewCallback callback = fullscreenCallback;
        fullscreenCallback = null;
        if (callback != null) callback.onCustomViewHidden();
    }

    private void reloadPage() {
        if (serverOrigin == null) {
            showSettingsScreen();
            return;
        }
        hideOverlay();
        webView.reload();
    }

    private void showSettingsScreen() {
        settingsVisible = true;
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(getColor(R.color.native_background));
        LinearLayout outer = new LinearLayout(this);
        outer.setOrientation(LinearLayout.VERTICAL);
        outer.setGravity(Gravity.TOP | Gravity.CENTER_HORIZONTAL);
        outer.setPadding(dp(20), dp(20), dp(20), dp(24));
        scroll.addView(outer, new ScrollView.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(22), dp(23), dp(22), dp(22));
        card.setBackground(roundedShape(
                getColor(R.color.native_surface), getColor(R.color.native_border), 20));
        card.setElevation(dp(2));
        int availableWidth = (int) (getResources().getDisplayMetrics().widthPixels /
                getResources().getDisplayMetrics().density) - 40;
        int cardWidth = dp(Math.min(500, Math.max(260, availableWidth)));
        LinearLayout.LayoutParams cardParams = new LinearLayout.LayoutParams(
                cardWidth, ViewGroup.LayoutParams.WRAP_CONTENT);
        cardParams.gravity = Gravity.CENTER_HORIZONTAL;
        outer.addView(card, cardParams);

        LinearLayout brandRow = new LinearLayout(this);
        brandRow.setGravity(Gravity.CENTER_VERTICAL);
        FrameLayout brandMark = new FrameLayout(this);
        brandMark.setBackground(roundedShape(Color.rgb(255, 249, 235), Color.rgb(244, 232, 207), 15));
        ImageView fish = new ImageView(this);
        fish.setImageResource(R.drawable.ic_brand_fish);
        fish.setContentDescription(null);
        fish.setScaleType(ImageView.ScaleType.CENTER_INSIDE);
        brandMark.addView(fish, new FrameLayout.LayoutParams(dp(39), dp(39), Gravity.CENTER));
        brandRow.addView(brandMark, new LinearLayout.LayoutParams(dp(48), dp(48)));
        LinearLayout titleBlock = new LinearLayout(this);
        titleBlock.setOrientation(LinearLayout.VERTICAL);
        titleBlock.setGravity(Gravity.CENTER_VERTICAL);
        TextView productName = textView("咸鱼助手", 13f, true);
        productName.setTextColor(getColor(R.color.native_muted));
        TextView productNote = textView("服务器任务管理", 12f, false);
        productNote.setTextColor(getColor(R.color.native_muted));
        titleBlock.addView(productName);
        titleBlock.addView(productNote);
        LinearLayout.LayoutParams titleBlockParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, dp(48));
        titleBlockParams.leftMargin = dp(11);
        brandRow.addView(titleBlock, titleBlockParams);
        card.addView(brandRow, marginParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(48), 0, 0, 0, 22));

        TextView title = textView("连接你的服务器", 24f, true);
        card.addView(title, marginParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, 0, 0, 0, 7));
        TextView explanation = textView(
                "填写 Docker 服务所在电脑或服务器的地址。手机上的 localhost 指手机自身，不是电脑。",
                14f, false);
        explanation.setTextColor(getColor(R.color.native_muted));
        card.addView(explanation, marginParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, 0, 0, 0, 17));

        TextView addressLabel = textView("服务器地址", 13f, true);
        card.addView(addressLabel, marginParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, 0, 0, 0, 6));
        EditText address = new EditText(this);
        address.setId(View.generateViewId());
        addressLabel.setLabelFor(address.getId());
        address.setSingleLine(true);
        address.setInputType(android.text.InputType.TYPE_CLASS_TEXT |
                android.text.InputType.TYPE_TEXT_VARIATION_URI);
        address.setHint(BuildConfig.DEBUG
                ? "https://example.com 或 http://192.168.1.10:8080"
                : "https://example.com");
        address.setText(serverOrigin == null ? "" : serverOrigin);
        address.setSelectAllOnFocus(true);
        address.setTextColor(getColor(R.color.native_ink));
        address.setHintTextColor(Color.rgb(137, 151, 171));
        address.setTextSize(14f);
        address.setPadding(dp(13), 0, dp(13), 0);
        address.setMinHeight(dp(50));
        address.setBackground(roundedShape(
                getColor(R.color.native_field), getColor(R.color.native_border), 12));
        card.addView(address, marginParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(50), 0, 0, 0, 8));

        TextView helper = textView(BuildConfig.DEBUG
                ? "调试版可用 HTTPS；局域网测试也可填写 HTTP 地址。正式版仅接受 HTTPS。"
                : "正式版仅接受 HTTPS 地址。",
                12f, false);
        helper.setTextColor(getColor(R.color.native_muted));
        card.addView(helper, marginParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, 0, 0, 0, 10));

        TextView validation = textView("", 13f, false);
        validation.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
        validation.setTextColor(getColor(R.color.native_danger));
        validation.setVisibility(View.GONE);
        card.addView(validation, marginParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, 0, 0, 0, 6));

        Button connect = nativeButton("连接服务器", true,
                () -> saveServerAddress(address.getText().toString(), validation));
        card.addView(connect, marginParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(50), 0, 8, 0, 0));
        if (serverOrigin != null) {
            Button cancel = nativeButton("返回功能页", false, () -> {
                hideOverlay();
                if (webView.getUrl() == null) loadTrustedPath("/app");
            });
            card.addView(cancel, marginParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, dp(48), 0, 8, 0, 0));
        }
        showOverlay(scroll);
        address.requestFocus();
    }

    private void saveServerAddress(String address, TextView validation) {
        final String normalized;
        try {
            normalized = ServerAddressPolicy.normalizeOrigin(address, BuildConfig.DEBUG);
        } catch (IllegalArgumentException exception) {
            validation.setText(exception.getMessage());
            validation.setVisibility(View.VISIBLE);
            return;
        }

        boolean changed = serverOrigin != null && !serverOrigin.equals(normalized);
        if (!changed) {
            persistAndLoad(normalized);
            return;
        }

        if (pendingFileCallback != null) {
            pendingFileCallback.onReceiveValue(null);
            pendingFileCallback = null;
        }
        clearPendingExport();
        exportNonce = null;
        webView.stopLoading();
        webView.clearHistory();
        webView.clearCache(true);
        webView.clearFormData();
        webView.clearSslPreferences();
        CookieManager cookieManager = CookieManager.getInstance();
        cookieManager.removeAllCookies(removed -> {
            cookieManager.flush();
            WebStorage.getInstance().deleteAllData();
            runOnUiThread(() -> persistAndLoad(normalized));
        });
    }

    private void persistAndLoad(String normalizedOrigin) {
        serverOrigin = normalizedOrigin;
        updateServerLabel();
        getSharedPreferences(PREFERENCES, MODE_PRIVATE)
                .edit().putString(PREF_SERVER_ORIGIN, normalizedOrigin).apply();
        hideOverlay();
        webView.clearHistory();
        loadTrustedPath("/app");
    }

    private void showError(String message) {
        settingsVisible = false;
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(getColor(R.color.native_background));
        LinearLayout outer = new LinearLayout(this);
        outer.setGravity(Gravity.CENTER);
        outer.setPadding(dp(20), dp(20), dp(20), dp(20));
        scroll.addView(outer, new ScrollView.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(22), dp(23), dp(22), dp(22));
        card.setBackground(roundedShape(
                getColor(R.color.native_surface), getColor(R.color.native_border), 20));
        card.setElevation(dp(2));
        outer.addView(card, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        TextView kicker = textView("咸鱼助手", 12f, true);
        kicker.setTextColor(getColor(R.color.native_muted));
        card.addView(kicker, marginParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, 0, 0, 0, 10));
        TextView title = textView("暂时无法连接", 22f, true);
        card.addView(title, marginParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, 0, 0, 0, 8));
        TextView details = textView(message, 14f, false);
        details.setTextColor(getColor(R.color.native_muted));
        details.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
        card.addView(details, marginParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, 0, 0, 0, 16));
        Button retry = nativeButton("重试连接", true, this::reloadPage);
        card.addView(retry, marginParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(50), 0, 4, 0, 0));
        Button settings = nativeButton("更改服务器地址", false, this::showSettingsScreen);
        card.addView(settings, marginParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(48), 0, 8, 0, 0));
        showOverlay(scroll);
    }

    private void showOverlay(View view) {
        overlay.removeAllViews();
        overlay.addView(view, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        overlay.setVisibility(View.VISIBLE);
    }

    private void hideOverlay() {
        settingsVisible = false;
        overlay.setVisibility(View.GONE);
        overlay.removeAllViews();
    }

    private void openDocumentChooser(ValueCallback<Uri[]> callback, WebChromeClient.FileChooserParams params) {
        if (pendingFileCallback != null) pendingFileCallback.onReceiveValue(null);
        pendingFileCallback = callback;

        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        String[] acceptTypes = params == null ? new String[0] : params.getAcceptTypes();
        List<String> mimeTypes = new ArrayList<>();
        if (acceptTypes != null) {
            for (String acceptType : acceptTypes) {
                if (acceptType != null && acceptType.contains("/") && !mimeTypes.contains(acceptType)) {
                    mimeTypes.add(acceptType);
                }
            }
        }
        if (!mimeTypes.isEmpty()) {
            intent.putExtra(Intent.EXTRA_MIME_TYPES, mimeTypes.toArray(new String[0]));
        }
        boolean multiple = params != null && params.getMode() == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE;
        intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, multiple);

        try {
            startActivityForResult(Intent.createChooser(intent, "选择文件"), FILE_CHOOSER_REQUEST);
        } catch (ActivityNotFoundException exception) {
            pendingFileCallback.onReceiveValue(null);
            pendingFileCallback = null;
            Toast.makeText(this, "系统文件选择器不可用", Toast.LENGTH_SHORT).show();
        }
    }

    @Override
    @SuppressWarnings("deprecation")
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == EXPORT_SAVE_REQUEST) {
            PendingExport export = pendingExport;
            if (export == null) return;
            Uri destination = data == null ? null : data.getData();
            if (resultCode != RESULT_OK || destination == null) {
                long operationId = export.operationId;
                export.data.clear();
                pendingExport = null;
                if (exportOperationId == operationId) exportOperationId++;
                exportWriteFuture = null;
                if (resultCode == RESULT_OK) showExportError("invalid");
                return;
            }
            if (!"content".equalsIgnoreCase(destination.getScheme())) {
                clearPendingExport();
                showExportError("invalid");
                return;
            }
            writeExportToUri(export, destination);
            return;
        }
        if (requestCode != FILE_CHOOSER_REQUEST || pendingFileCallback == null) return;
        Uri[] result = null;
        if (resultCode == RESULT_OK && data != null) {
            ArrayList<Uri> selected = new ArrayList<>();
            ClipData clipData = data.getClipData();
            if (clipData != null) {
                for (int index = 0; index < clipData.getItemCount(); index++) {
                    Uri uri = clipData.getItemAt(index).getUri();
                    if (isDocumentUri(uri)) selected.add(uri);
                }
            } else if (isDocumentUri(data.getData())) {
                selected.add(data.getData());
            }
            if (!selected.isEmpty()) result = selected.toArray(new Uri[0]);
        }
        pendingFileCallback.onReceiveValue(result);
        pendingFileCallback = null;
    }

    private boolean isDocumentUri(Uri uri) {
        return uri != null && "content".equalsIgnoreCase(uri.getScheme());
    }

    private Button nativeButton(String label, boolean primary, Runnable action) {
        Button button = new Button(this);
        button.setText(label);
        button.setTextColor(getColor(primary ? R.color.native_surface : R.color.native_ink));
        button.setTextSize(14f);
        button.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        button.setAllCaps(false);
        button.setMinWidth(0);
        button.setMinimumHeight(dp(48));
        button.setPadding(dp(14), 0, dp(14), 0);
        button.setStateListAnimator(null);
        button.setBackground(primary
                ? rippleBackground(getColor(R.color.native_primary), Color.TRANSPARENT, 13)
                : rippleBackground(getColor(R.color.native_surface), getColor(R.color.native_border), 13));
        button.setOnClickListener(view -> action.run());
        return button;
    }

    private TextView textView(String text, float size, boolean bold) {
        TextView view = new TextView(this);
        view.setText(text);
        view.setTextSize(size);
        view.setTextColor(getColor(R.color.native_ink));
        view.setLineSpacing(dp(2), 1f);
        if (bold) view.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        return view;
    }

    private GradientDrawable roundedShape(int fillColor, int strokeColor, int radiusDp) {
        GradientDrawable shape = new GradientDrawable();
        shape.setShape(GradientDrawable.RECTANGLE);
        shape.setColor(fillColor);
        shape.setCornerRadius(dp(radiusDp));
        if (strokeColor != Color.TRANSPARENT) shape.setStroke(dp(1), strokeColor);
        return shape;
    }

    private Drawable rippleBackground(int fillColor, int strokeColor, int radiusDp) {
        return new RippleDrawable(
                ColorStateList.valueOf(getColor(R.color.native_ripple)),
                roundedShape(fillColor, strokeColor, radiusDp),
                null);
    }

    private LinearLayout.LayoutParams marginParams(int width, int height,
                                                   int left, int top, int right, int bottom) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(width, height);
        params.setMargins(dp(left), dp(top), dp(right), dp(bottom));
        return params;
    }

    private int dp(float value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    @Override
    public void onBackPressed() {
        if (fullscreenView != null) {
            hideFullscreen();
            return;
        }
        if (settingsVisible && serverOrigin != null) {
            hideOverlay();
            if (webView.getUrl() == null) loadTrustedPath("/app");
            return;
        }
        if (webView != null && webView.canGoBack()) {
            int previousIndex = webView.copyBackForwardList().getCurrentIndex() - 1;
            if (previousIndex >= 0) {
                String previousUrl = webView.copyBackForwardList().getItemAtIndex(previousIndex).getUrl();
                if (ServerAddressPolicy.isSameOrigin(serverOrigin, previousUrl, BuildConfig.DEBUG)) {
                    webView.goBack();
                } else {
                    loadTrustedPath("/app");
                }
                return;
            }
        }
        super.onBackPressed();
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        if (serverOrigin != null && webView != null) {
            outState.putString(STATE_SERVER_ORIGIN, serverOrigin);
            Bundle webState = new Bundle();
            webView.saveState(webState);
            outState.putBundle(STATE_WEB_VIEW, webState);
            outState.putBoolean(STATE_SETTINGS_VISIBLE, settingsVisible);
        }
        super.onSaveInstanceState(outState);
    }

    @Override
    protected void onPause() {
        if (webView != null) webView.onPause();
        CookieManager.getInstance().flush();
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) webView.onResume();
    }

    @Override
    protected void onDestroy() {
        destroyed = true;
        clearPendingExport();
        exportExecutor.shutdownNow();
        if (fullscreenView != null) {
            root.removeView(fullscreenView);
            fullscreenView = null;
            if (fullscreenCallback != null) fullscreenCallback.onCustomViewHidden();
            fullscreenCallback = null;
        }
        if (pendingFileCallback != null) {
            pendingFileCallback.onReceiveValue(null);
            pendingFileCallback = null;
        }
        if (webView != null) {
            webView.stopLoading();
            webView.setWebChromeClient(null);
            webView.setWebViewClient(null);
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    private static final class PendingExport {
        private final long operationId;
        private final ExportPolicy.ExportData data;

        private PendingExport(long operationId, ExportPolicy.ExportData data) {
            this.operationId = operationId;
            this.data = data;
        }
    }
}
