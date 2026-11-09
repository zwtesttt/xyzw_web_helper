(function installXyzwExportBridge() {
  "use strict";

  const PROMPT_PREFIX = "__XYZW_FILE_EXPORT_V1__";
  const MAX_BYTES = 8 * 1024 * 1024;
  const bridgeKey = "__XYZW_NATIVE_EXPORT_BRIDGE__";

  window.__XYZW_NATIVE_EXPORT_INSTALL__ = function install(nonce) {
    if (typeof nonce !== "string" || !/^[A-Za-z0-9_-]{24,64}$/.test(nonce)) return false;

    const existing = window[bridgeKey];
    if (existing) {
      existing.nonce = nonce;
      return true;
    }

    const state = {
      nonce,
      blobs: new Map(),
      pendingFetches: new Set(),
      deferredRevokes: new Set(),
    };
    window[bridgeKey] = state;

    const originalCreateObjectURL = URL.createObjectURL.bind(URL);
    const originalRevokeObjectURL = URL.revokeObjectURL.bind(URL);
    const originalAnchorClick = HTMLAnchorElement.prototype.click;

    URL.createObjectURL = function createObjectURL(blob) {
      const objectUrl = originalCreateObjectURL(blob);
      if (blob instanceof Blob) state.blobs.set(String(objectUrl), blob);
      return objectUrl;
    };

    URL.revokeObjectURL = function revokeObjectURL(objectUrl) {
      const key = String(objectUrl);
      if (state.pendingFetches.has(key)) {
        state.deferredRevokes.add(key);
        return;
      }
      state.blobs.delete(key);
      originalRevokeObjectURL(objectUrl);
    };

    function announce(message, isError) {
      if (!document.body) return;
      let status = document.getElementById("xyzw-native-export-status");
      if (!status) {
        status = document.createElement("div");
        status.id = "xyzw-native-export-status";
        status.setAttribute("role", "status");
        status.setAttribute("aria-live", "polite");
        status.style.cssText =
          "position:fixed;z-index:2147483647;left:12px;right:12px;bottom:16px;" +
          "padding:12px 14px;border-radius:10px;background:#17243a;color:#fff;" +
          "font:14px/1.45 sans-serif;box-shadow:0 4px 18px rgba(0,0,0,.22);";
        document.body.appendChild(status);
      }
      status.textContent = message;
      status.setAttribute("aria-label", message);
      status.style.border = isError ? "1px solid #d03050" : "none";
      status.style.display = "block";
      window.clearTimeout(state.statusTimer);
      state.statusTimer = window.setTimeout(() => {
        if (status.isConnected) status.style.display = "none";
      }, 5000);
    }

    function requestNativeError(code, message) {
      try {
        window.prompt(PROMPT_PREFIX, JSON.stringify({ nonce: state.nonce, error: code }));
      } catch (_) {
        // The accessible in-page notice below is still shown if the native prompt is unavailable.
      }
      announce(message, true);
    }

    function submitBlob(blob, filename) {
      if (!blob || typeof blob.size !== "number") {
        requestNativeError("read_failed", "无法读取此文件，请重试。");
        return;
      }
      if (blob.size > MAX_BYTES) {
        requestNativeError("too_large", "文件超过 8 MiB，无法通过 App 导出。");
        return;
      }

      const reader = new FileReader();
      reader.onerror = () => requestNativeError("read_failed", "文件读取失败，请重试。");
      reader.onabort = () => requestNativeError("read_failed", "文件读取已取消。");
      reader.onload = () => {
        if (typeof reader.result !== "string") {
          requestNativeError("read_failed", "文件读取失败，请重试。");
          return;
        }
        try {
          const response = window.prompt(
            PROMPT_PREFIX,
            JSON.stringify({
              nonce: state.nonce,
              name: filename || "export.bin",
              type: blob.type || "application/octet-stream",
              data: reader.result,
            }),
          );
          if (response !== "accepted") announce("导出未启动；可重新点击导出。", true);
          else announce("请在系统窗口中选择保存位置。", false);
        } catch (_) {
          announce("无法打开系统保存窗口，请重试。", true);
        }
      };
      try {
        reader.readAsDataURL(blob);
      } catch (_) {
        requestNativeError("read_failed", "文件读取失败，请重试。");
      }
    }

    function captureAnchor(anchor) {
      const href = String(anchor.href || anchor.getAttribute("href") || "");
      const name = anchor.getAttribute("download") || anchor.download || "export.bin";
      if (href.startsWith("blob:")) {
        const mappedBlob = state.blobs.get(href);
        if (mappedBlob) {
          // Keep the Blob reference before the page can revoke its object URL.
          submitBlob(mappedBlob, name);
          return true;
        }
        state.pendingFetches.add(href);
        fetch(href)
          .then((response) => {
            if (!response.ok) throw new Error("blob_fetch_failed");
            return response.blob();
          })
          .then((blob) => submitBlob(blob, name))
          .catch(() => requestNativeError("read_failed", "文件读取失败，请重试。"))
          .finally(() => {
            state.pendingFetches.delete(href);
            if (state.deferredRevokes.delete(href)) originalRevokeObjectURL(href);
          });
        return true;
      }
      if (href.startsWith("data:")) {
        fetch(href)
          .then((response) => response.blob())
          .then((blob) => submitBlob(blob, name))
          .catch(() => requestNativeError("read_failed", "文件读取失败，请重试。"));
        return true;
      }
      if (/^https?:/i.test(href)) {
        requestNativeError("unsupported", "App 暂不支持服务器直接下载的文件。");
        return true;
      }
      return false;
    }

    HTMLAnchorElement.prototype.click = function click() {
      if (this.hasAttribute("download") && captureAnchor(this)) return;
      return originalAnchorClick.apply(this, arguments);
    };

    document.addEventListener(
      "click",
      (event) => {
        if (!event.isTrusted) return;
        let anchor = event.target;
        while (anchor && anchor !== document && !(anchor instanceof HTMLAnchorElement)) {
          anchor = anchor.parentNode;
        }
        if (!anchor || anchor === document || !anchor.hasAttribute("download")) return;
        if (captureAnchor(anchor)) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      },
      true,
    );

    return true;
  };
})();
