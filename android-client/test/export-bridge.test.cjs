const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const assetPath = path.join(__dirname, "../app/src/main/assets/xyzw-export-bridge.js");
const bridgeSource = fs.readFileSync(assetPath, "utf8");
const nonce = "0123456789abcdefghijklmnopqrstuv";

class FakeBlob {
  constructor(parts, options = {}) {
    this.bytes = Buffer.concat(parts.map((part) => Buffer.from(part)));
    this.type = options.type || "";
    this.size = this.bytes.length;
  }
}

class FakeAnchor {
  constructor(href, download = "") {
    this.href = href;
    this.download = download;
    this.attributes = new Map([["download", download]]);
    this.clicked = 0;
    this.parentNode = null;
  }

  hasAttribute(name) {
    return this.attributes.has(name);
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  click() {
    this.clicked += 1;
  }
}

class FakeFileReader {
  readAsDataURL(blob) {
    this.result = `data:${blob.type || "application/octet-stream"};base64,${blob.bytes.toString("base64")}`;
    queueMicrotask(() => this.onload?.());
  }
}

class FakeURL {
  static nextId = 0;
  static objects = new Map();

  static createObjectURL(blob) {
    const url = `blob:test-${++this.nextId}`;
    this.objects.set(url, blob);
    return url;
  }

  static revokeObjectURL(url) {
    this.objects.delete(String(url));
  }
}

function makeHarness(fetchImpl = async () => { throw new Error("unexpected fetch"); }) {
  const listeners = new Map();
  const elements = new Map();
  const document = {
    body: {
      appendChild(element) {
        elements.set(element.id, element);
        element.isConnected = true;
      },
    },
    addEventListener(name, handler, capture) {
      listeners.set(name, { handler, capture });
    },
    createElement() {
      return {
        style: { cssText: "" },
        setAttribute() {},
        isConnected: false,
      };
    },
    getElementById(id) {
      return elements.get(id) || null;
    },
  };
  const prompts = [];
  const window = {
    clearTimeout() {},
    setTimeout() { return 1; },
    prompt(message, payload) {
      prompts.push({ message, payload });
      return "accepted";
    },
  };
  const context = {
    window,
    document,
    URL: FakeURL,
    HTMLAnchorElement: FakeAnchor,
    Blob: FakeBlob,
    FileReader: FakeFileReader,
    fetch: fetchImpl,
    setTimeout,
    clearTimeout,
    Buffer,
  };
  vm.runInNewContext(bridgeSource, context, { filename: "xyzw-export-bridge.js" });
  assert.equal(window.__XYZW_NATIVE_EXPORT_INSTALL__(nonce), true);
  return { context, document, listeners, prompts };
}

test("detached anchor click captures blob before immediate URL revocation", async () => {
  const harness = makeHarness();
  const { context, prompts } = harness;
  const blob = new FakeBlob(["json-data"], { type: "application/json" });
  const url = context.URL.createObjectURL(blob);
  const anchor = new context.HTMLAnchorElement(url, "tokens.json");

  anchor.click();
  context.URL.revokeObjectURL(url);
  await new Promise(setImmediate);

  assert.equal(anchor.clicked, 0);
  assert.equal(prompts.length, 1);
  assert.equal(prompts[0].message, "__XYZW_FILE_EXPORT_V1__");
  const payload = JSON.parse(prompts[0].payload);
  assert.equal(payload.nonce, nonce);
  assert.equal(payload.name, "tokens.json");
  assert.equal(payload.type, "application/json");
  assert.equal(Buffer.from(payload.data.split(",")[1], "base64").toString(), "json-data");
});

test("ordinary links are left to WebView", () => {
  const { context, prompts } = makeHarness();
  const anchor = new context.HTMLAnchorElement("https://example.invalid/page", "");
  anchor.attributes.clear();

  anchor.click();

  assert.equal(anchor.clicked, 1);
  assert.equal(prompts.length, 0);
});

test("trusted download click captures a data URL and prevents browser navigation", async () => {
  const fetchCalls = [];
  const harness = makeHarness(async (url) => {
    fetchCalls.push(url);
    return { blob: async () => new FakeBlob(["png-data"], { type: "image/png" }) };
  });
  const { context, listeners, prompts } = harness;
  const href = "data:image/png;base64,cG5nLWRhdGE=";
  const anchor = new context.HTMLAnchorElement(href, "map.png");
  const handler = listeners.get("click").handler;
  const event = {
    isTrusted: true,
    target: anchor,
    defaultPrevented: false,
    stopped: false,
    preventDefault() { this.defaultPrevented = true; },
    stopImmediatePropagation() { this.stopped = true; },
  };

  handler(event);
  await new Promise(setImmediate);

  assert.deepEqual(fetchCalls, [href]);
  assert.equal(event.defaultPrevented, true);
  assert.equal(event.stopped, true);
  assert.equal(prompts.length, 1);
  const payload = JSON.parse(prompts[0].payload);
  assert.equal(payload.name, "map.png");
  assert.equal(payload.type, "image/png");
  assert.equal(Buffer.from(payload.data.split(",")[1], "base64").toString(), "png-data");
});


test("oversized blob reports an error without reading or exporting bytes", () => {
  const { context, prompts } = makeHarness();
  const blob = new FakeBlob([""], { type: "application/octet-stream" });
  blob.size = 8 * 1024 * 1024 + 1;
  const url = context.URL.createObjectURL(blob);
  const anchor = new context.HTMLAnchorElement(url, "large.bin");

  anchor.click();

  assert.equal(anchor.clicked, 0);
  assert.equal(prompts.length, 1);
  assert.deepEqual(JSON.parse(prompts[0].payload), { nonce, error: "too_large" });
});
