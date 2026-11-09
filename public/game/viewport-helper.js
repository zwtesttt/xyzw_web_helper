(function () {
  "use strict";

  const guardKey = "__XYZW_GAME_VIEWPORT_HELPER__";
  if (window[guardKey]) return;
  window[guardKey] = true;

  let container = null;
  let originalPosition = null;
  let resizeObserver = null;
  let animationFrame = 0;

  function readContainer() {
    const candidate =
      (window.cc && window.cc.game && window.cc.game.container) ||
      document.getElementById("Cocos2dGameContainer");
    if (!candidate || candidate === container) return candidate;

    if (resizeObserver) resizeObserver.disconnect();
    container = candidate;
    originalPosition = {
      left: container.style.left,
      top: container.style.top,
    };
    if (typeof window.ResizeObserver === "function") {
      resizeObserver = new window.ResizeObserver(scheduleCenter);
      resizeObserver.observe(container);
    }
    return container;
  }

  function hasEditableFocus() {
    const activeElement = document.activeElement;
    if (!activeElement || !container || !container.contains(activeElement)) {
      return false;
    }
    const tagName = String(activeElement.tagName || "").toLowerCase();
    return (
      activeElement.isContentEditable ||
      tagName === "textarea" ||
      tagName === "select" ||
      (tagName === "input" && activeElement.type !== "hidden")
    );
  }

  function restoreEnginePosition() {
    if (!container || !originalPosition) return;
    container.style.left = originalPosition.left;
    container.style.top = originalPosition.top;
  }

  function centerContainer() {
    animationFrame = 0;
    if (!readContainer()) return;

    const gameView = window.cc && window.cc.view;
    if (gameView && gameView._isRotated) {
      restoreEnginePosition();
      return;
    }
    if (hasEditableFocus()) return;

    const visualViewport = window.visualViewport;
    const viewportWidth =
      (visualViewport && visualViewport.width) ||
      document.documentElement.clientWidth ||
      window.innerWidth;
    const viewportHeight =
      (visualViewport && visualViewport.height) ||
      document.documentElement.clientHeight ||
      window.innerHeight;
    const viewportLeft = (visualViewport && visualViewport.offsetLeft) || 0;
    const viewportTop = (visualViewport && visualViewport.offsetTop) || 0;
    const bounds = container.getBoundingClientRect();
    const containerWidth = container.offsetWidth || bounds.width;
    const containerHeight = container.offsetHeight || bounds.height;

    container.style.left =
      `${Math.max(0, Math.round(viewportLeft + (viewportWidth - containerWidth) / 2))}px`;
    container.style.top =
      `${Math.max(0, Math.round(viewportTop + (viewportHeight - containerHeight) / 2))}px`;
  }

  function scheduleCenter() {
    if (animationFrame) return;
    animationFrame = window.requestAnimationFrame(centerContainer);
  }

  window.addEventListener("resize", scheduleCenter, { passive: true });
  window.addEventListener("orientationchange", scheduleCenter, { passive: true });
  window.addEventListener("fullscreenchange", scheduleCenter);
  document.addEventListener("fullscreenchange", scheduleCenter);
  document.addEventListener("focusout", scheduleCenter, true);
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", scheduleCenter, {
      passive: true,
    });
  }

  const cc = window.cc;
  if (cc && cc.game && cc.game.EVENT_GAME_INITED) {
    cc.game.on(cc.game.EVENT_GAME_INITED, scheduleCenter);
  }
  if (cc && cc.director && cc.Director && cc.Director.EVENT_AFTER_SCENE_LAUNCH) {
    cc.director.on(cc.Director.EVENT_AFTER_SCENE_LAUNCH, scheduleCenter);
  }

  scheduleCenter();
})();
