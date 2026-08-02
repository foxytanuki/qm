import assert from "node:assert/strict";
import { test } from "node:test";
import type { Agent } from "@earendil-works/pi-agent-core";
import { JSDOM } from "jsdom";
import { createServer } from "vite";

test("IME confirmation does not send and the next Enter sends the committed text once", async () => {
  const dom = new JSDOM('<!doctype html><div id="app"></div><main id="main"></main><div id="host"></div>', {
    url: "http://localhost/web-ui/",
  });
  Object.defineProperty(dom.window, "matchMedia", {
    value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  });
  const globals = {
    window: dom.window,
    document: dom.window.document,
    location: dom.window.location,
    history: dom.window.history,
    localStorage: dom.window.localStorage,
    navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement,
    HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
    Node: dom.window.Node,
    Event: dom.window.Event,
    InputEvent: dom.window.InputEvent,
    CompositionEvent: dom.window.CompositionEvent,
    KeyboardEvent: dom.window.KeyboardEvent,
    requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(() => callback(Date.now()), 0),
    cancelAnimationFrame: clearTimeout,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
  };
  for (const [key, value] of Object.entries(globals))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });

  globalThis.fetch = async (input) => {
    if (String(input).startsWith("/api/runtime-config")) {
      return Response.json({
        scopeId: "personal:owner",
        approvedHarnesses: ["pi"],
        modelsByHarness: { pi: ["gpt-5.6-sol"] },
        modelCatalog: { "gpt-5.6-sol": { name: "GPT-5.6 Sol", provider: "openai" } },
        orgDefault: { harnessId: "pi", modelId: "gpt-5.6-sol", revision: 1 },
        scopeOverride: null,
        effective: { harnessId: "pi", modelId: "gpt-5.6-sol" },
        upgradeAvailable: false,
      });
    }
    throw new Error(`Unexpected request: ${String(input)}`);
  };

  const vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: "custom" });
  try {
    const { nothing, render } = await vite.ssrLoadModule("lit");
    const { chatState } = await vite.ssrLoadModule("/src/chat.ts");
    const { composerForm, refreshRuntimeSelection, resetComposer } = await vite.ssrLoadModule("/src/composer.ts");
    const sent: string[] = [];
    const agent = {
      state: { isStreaming: false, messages: [], tools: [] },
      prompt: async (text: string) => {
        sent.push(text);
      },
      abort() {},
    } as unknown as Agent;
    const host = document.querySelector<HTMLElement>("#host")!;

    resetComposer();
    await refreshRuntimeSelection("personal:owner");
    chatState.agent = agent;
    chatState.host = host;
    render(composerForm(agent), host);
    const input = host.querySelector<HTMLTextAreaElement>(".composer-input")!;

    input.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    input.value = "日本";
    input.dispatchEvent(new InputEvent("input", { bubbles: true, data: "日本", isComposing: true }));
    const confirmation = new KeyboardEvent("keydown", {
      key: "Enter",
      keyCode: 229,
      bubbles: true,
      cancelable: true,
      isComposing: true,
    });
    input.dispatchEvent(confirmation);
    await Promise.resolve();

    assert.deepEqual(sent, []);
    assert.equal(confirmation.defaultPrevented, false);

    input.value = "日本語";
    input.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "語" }));
    const safariConfirmation = new KeyboardEvent("keydown", {
      key: "Enter",
      keyCode: 229,
      bubbles: true,
      cancelable: true,
      isComposing: false,
    });
    input.dispatchEvent(safariConfirmation);
    await Promise.resolve();

    assert.deepEqual(sent, []);
    assert.equal(safariConfirmation.defaultPrevented, false);

    const submit = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    input.dispatchEvent(submit);
    await Promise.resolve();

    assert.deepEqual(sent, ["日本語"]);
    assert.equal(submit.defaultPrevented, true);
    assert.equal(host.querySelector<HTMLTextAreaElement>(".composer-input")?.value, "");

    const english = host.querySelector<HTMLTextAreaElement>(".composer-input")!;
    english.value = "plain English";
    english.dispatchEvent(new InputEvent("input", { bubbles: true, data: "plain English" }));
    const newline = new KeyboardEvent("keydown", {
      key: "Enter",
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    english.dispatchEvent(newline);
    await Promise.resolve();
    assert.deepEqual(sent, ["日本語"]);
    assert.equal(newline.defaultPrevented, false);

    const englishSubmit = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    english.dispatchEvent(englishSubmit);
    await Promise.resolve();
    assert.deepEqual(sent, ["日本語", "plain English"]);
    assert.equal(englishSubmit.defaultPrevented, true);
    assert.equal(host.querySelector<HTMLTextAreaElement>(".composer-input")?.value, "");

    (agent.state as { isStreaming: boolean }).isStreaming = true;
    const steer = host.querySelector<HTMLTextAreaElement>(".composer-input")!;
    steer.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    steer.value = "追加入力";
    steer.dispatchEvent(new InputEvent("input", { bubbles: true, data: "追加入力", isComposing: true }));
    const steerConfirmation = new KeyboardEvent("keydown", {
      key: "Enter",
      keyCode: 229,
      bubbles: true,
      cancelable: true,
      isComposing: true,
    });
    steer.dispatchEvent(steerConfirmation);
    await Promise.resolve();
    assert.deepEqual(sent, ["日本語", "plain English"]);
    assert.equal(steerConfirmation.defaultPrevented, false);
    assert.equal(steer.value, "追加入力");

    (agent.state as { isStreaming: boolean }).isStreaming = false;
    render(nothing, host);
    render(composerForm(agent), host);
    const replacement = host.querySelector<HTMLTextAreaElement>(".composer-input")!;
    replacement.value = "replacement input";
    replacement.dispatchEvent(new InputEvent("input", { bubbles: true, data: "replacement input" }));
    replacement.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await Promise.resolve();
    assert.deepEqual(sent, ["日本語", "plain English", "replacement input"]);
  } finally {
    await vite.close();
  }
});

test("the composer retains the Safari composition fallback", async () => {
  const source = await import("node:fs/promises").then((fs) =>
    fs.readFile(new URL("../src/composer.ts", import.meta.url), "utf8"),
  );
  assert.match(source, /e\.isComposing \|\| e\.keyCode === 229/);
});
