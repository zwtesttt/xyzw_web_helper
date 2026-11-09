import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const helperSource = await readFile(
  new URL("../public/game/viewport-helper.js", import.meta.url),
  "utf8",
);

function createEventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    dispatchEvent(type, event = {}) {
      for (const listener of listeners.get(type) || []) listener(event);
    },
    listenerCount(type) {
      return listeners.get(type)?.size || 0;
    },
  };
}

function createEmitter() {
  const listeners = new Map();
  return {
    on(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
    },
    emit(type) {
      for (const listener of listeners.get(type) || []) listener();
    },
    listenerCount(type) {
      return listeners.get(type)?.size || 0;
    },
  };
}

function createEnvironment({
  viewportWidth = 390,
  viewportHeight = 844,
  containerWidth = 360,
  containerHeight = 640,
  initialLeft = "7px",
  initialTop = "9px",
} = {}) {
  const window = createEventTarget();
  const document = createEventTarget();
  const animationFrames = new Map();
  const resizeObservers = [];
  const game = createEmitter();
  const director = createEmitter();
  const visualViewport = Object.assign(createEventTarget(), {
    width: viewportWidth,
    height: viewportHeight,
    offsetLeft: 0,
    offsetTop: 0,
  });
  const container = {
    style: { left: initialLeft, top: initialTop },
    offsetWidth: containerWidth,
    offsetHeight: containerHeight,
    getBoundingClientRect() {
      return { width: this.offsetWidth, height: this.offsetHeight };
    },
    contains(element) {
      return element?.parentElement === this;
    },
  };
  const documentElement = {
    clientWidth: viewportWidth,
    clientHeight: viewportHeight,
  };
  const cc = {
    game: Object.assign(game, {
      container,
      EVENT_GAME_INITED: "game_inited",
    }),
    director,
    Director: { EVENT_AFTER_SCENE_LAUNCH: "after_scene_launch" },
    view: { _isRotated: false },
  };
  Object.assign(window, {
    cc,
    innerWidth: viewportWidth,
    innerHeight: viewportHeight,
    visualViewport,
    requestAnimationFrame(callback) {
      const id = animationFrames.size + 1;
      animationFrames.set(id, callback);
      return id;
    },
    ResizeObserver: class {
      constructor(callback) {
        this.callback = callback;
        this.observed = null;
        this.disconnected = false;
        resizeObservers.push(this);
      }

      observe(target) {
        this.observed = target;
      }

      disconnect() {
        this.disconnected = true;
      }

      trigger() {
        this.callback([{ target: this.observed }]);
      }
    },
  });
  Object.assign(document, {
    activeElement: null,
    documentElement,
    getElementById(id) {
      return id === "Cocos2dGameContainer" ? container : null;
    },
  });

  function flushAnimationFrames() {
    while (animationFrames.size) {
      const pending = [...animationFrames.values()];
      animationFrames.clear();
      pending.forEach((callback) => callback());
    }
  }

  function runHelper() {
    vm.runInNewContext(helperSource, { document, window });
  }

  return {
    cc,
    container,
    document,
    director,
    flushAnimationFrames,
    resizeObservers,
    runHelper,
    visualViewport,
    window,
  };
}

test("centers the game canvas in a tall mobile viewport after scene launch", () => {
  const env = createEnvironment();
  env.runHelper();
  env.cc.game.emit("game_inited");
  env.director.emit("after_scene_launch");
  env.flushAnimationFrames();

  assert.equal(env.container.style.left, "15px");
  assert.equal(env.container.style.top, "102px");
});

test("recenters after window, visual viewport, and container size changes", () => {
  const env = createEnvironment();
  env.runHelper();
  env.flushAnimationFrames();

  env.window.innerWidth = 430;
  env.window.innerHeight = 900;
  env.document.documentElement.clientWidth = 430;
  env.document.documentElement.clientHeight = 900;
  env.visualViewport.width = 430;
  env.visualViewport.height = 900;
  env.window.dispatchEvent("resize");
  env.flushAnimationFrames();
  assert.equal(env.container.style.left, "35px");
  assert.equal(env.container.style.top, "130px");

  env.container.offsetWidth = 340;
  env.container.offsetHeight = 700;
  env.visualViewport.width = 390;
  env.visualViewport.height = 780;
  env.visualViewport.offsetTop = 24;
  env.resizeObservers[0].trigger();
  env.visualViewport.dispatchEvent("resize");
  env.flushAnimationFrames();
  assert.equal(env.container.style.left, "25px");
  assert.equal(env.container.style.top, "64px");
});

test("restores the engine position while Cocos has rotated the viewport", () => {
  const env = createEnvironment();
  env.runHelper();
  env.flushAnimationFrames();
  assert.equal(env.container.style.left, "15px");
  assert.equal(env.container.style.top, "102px");

  env.cc.view._isRotated = true;
  env.window.dispatchEvent("resize");
  env.flushAnimationFrames();
  assert.equal(env.container.style.left, "7px");
  assert.equal(env.container.style.top, "9px");
});

test("does not reposition or steal focus from the active game edit box", () => {
  const env = createEnvironment();
  env.runHelper();
  env.flushAnimationFrames();
  const originalLeft = env.container.style.left;
  const originalTop = env.container.style.top;
  const editBox = {
    parentElement: env.container,
    tagName: "INPUT",
    type: "text",
  };
  env.document.activeElement = editBox;
  env.window.innerWidth = 450;
  env.visualViewport.width = 450;
  env.window.dispatchEvent("resize");
  env.flushAnimationFrames();
  assert.equal(env.container.style.left, originalLeft);
  assert.equal(env.container.style.top, originalTop);
  assert.equal(env.document.activeElement, editBox);

  env.document.activeElement = null;
  env.document.dispatchEvent("focusout");
  env.flushAnimationFrames();
  assert.equal(env.container.style.left, "45px");
});

test("installing the helper more than once does not register duplicate listeners", () => {
  const env = createEnvironment();
  env.runHelper();
  env.flushAnimationFrames();
  const resizeListenerCount = env.window.listenerCount("resize");
  const gameInitListenerCount = env.cc.game.listenerCount("game_inited");
  const sceneLaunchListenerCount =
    env.director.listenerCount("after_scene_launch");

  env.runHelper();
  assert.equal(env.window.listenerCount("resize"), resizeListenerCount);
  assert.equal(env.cc.game.listenerCount("game_inited"), gameInitListenerCount);
  assert.equal(
    env.director.listenerCount("after_scene_launch"),
    sceneLaunchListenerCount,
  );
  assert.equal(env.resizeObservers.length, 1);
});
