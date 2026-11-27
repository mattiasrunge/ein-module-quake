#!/usr/bin/env node
/**
 * Browser smoke test for the quake module: signs in to a running EiN in headless Chrome, opens a
 * game's page (`/games/quake/<game>`, the Games page's page for it), plays a little and saves
 * screenshots, then prints what the page logged to its console.
 *
 * It talks to Chrome over the DevTools protocol with Node's own WebSocket, so it needs nothing
 * installed beyond Node 22+ and Chrome.
 *
 *   EIN_PASSWORD=... node test/smoke.mjs [--url http://localhost:8080] [--user admin] [--game shareware] [--out shots]
 *
 * Environment: EIN_PASSWORD (required), CHROME (path to the Chrome binary, defaults to macOS's).
 * The mouse is not tried: headless Chrome gives no page the pointer lock.
 * Exits non-zero if the page threw, if the game never drew a frame that is not black, if a key
 * meant for the game took the page elsewhere, if fullscreen did not take the game, or if Alt+H
 * outside the game did not reach the shell (the control that shows the game's keys are held back).
 */

import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const { values: options } = parseArgs({
  options: {
    url: { type: 'string', default: 'http://localhost:8080' },
    user: { type: 'string', default: 'admin' },
    game: { type: 'string', default: 'shareware' },
    out: { type: 'string', default: 'shots' },
  },
});
const password = process.env.EIN_PASSWORD;
if (!password) {
  console.error('set EIN_PASSWORD to the password of --user');
  process.exit(2);
}
const chromePath = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const outDir = resolve(options.out);
mkdirSync(outDir, { recursive: true });

/** Wait `ms` milliseconds. */
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** Start Chrome headless with a throwaway profile; resolves to the browser's DevTools WebSocket URL. */
function launchChrome(profile) {
  const chrome = spawn(chromePath, [
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    '--window-size=1280,900',
    '--no-first-run',
    '--no-default-browser-check',
    '--autoplay-policy=no-user-gesture-required',
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  return new Promise((done, fail) => {
    let seen = '';
    chrome.stderr.on('data', (chunk) => {
      seen += chunk;
      const match = seen.match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) done({ chrome, endpoint: match[1] });
    });
    chrome.on('exit', (code) => fail(new Error(`Chrome exited (${code}) before it listened:\n${seen}`)));
  });
}

/** A DevTools protocol connection: `send` a method to a session, `on` an event from any. */
async function connect(endpoint) {
  const socket = new WebSocket(endpoint);
  await new Promise((done, fail) => {
    socket.onopen = done;
    socket.onerror = fail;
  });
  let nextId = 1;
  const pending = new Map();
  const listeners = [];
  socket.onmessage = (message) => {
    const data = JSON.parse(message.data);
    if (data.id && pending.has(data.id)) {
      const { done, fail } = pending.get(data.id);
      pending.delete(data.id);
      if (data.error) fail(new Error(`${data.error.message} ${data.error.data ?? ''}`));
      else done(data.result);
    } else if (data.method) {
      for (const listener of listeners) listener(data);
    }
  };
  return {
    send(method, params = {}, sessionId) {
      const id = nextId++;
      socket.send(JSON.stringify({ id, method, params, sessionId }));
      return new Promise((done, fail) => pending.set(id, { done, fail }));
    },
    on(listener) {
      listeners.push(listener);
    },
    close() {
      socket.close();
    },
  };
}

const profile = mkdtempSync(join(tmpdir(), 'ein-quake-smoke-'));
const { chrome, endpoint } = await launchChrome(profile);
const cdp = await connect(endpoint);
const console_ = [];
let failed = false;

try {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  /** Send to the page's session. */
  const page = (method, params) => cdp.send(method, params, sessionId);

  cdp.on((event) => {
    if (event.sessionId !== sessionId) return;
    if (event.method === 'Runtime.consoleAPICalled') {
      const text = event.params.args.map((arg) => arg.value ?? arg.description ?? arg.type).join(' ');
      console_.push(`[console.${event.params.type}] ${text}`);
    } else if (event.method === 'Runtime.exceptionThrown') {
      const details = event.params.exceptionDetails;
      console_.push(`[exception] ${details.exception?.description ?? details.text}`);
      failed = true;
    } else if (event.method === 'Log.entryAdded') {
      const entry = event.params.entry;
      console_.push(`[log.${entry.level}] ${entry.text}${entry.url ? ` (${entry.url})` : ''}`);
    }
  });
  await page('Runtime.enable');
  await page('Log.enable');
  await page('Page.enable');
  await page('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });

  /** Evaluate `expression` in the page and return its value. */
  const evaluate = async (expression) => {
    const { result, exceptionDetails } = await page('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (exceptionDetails) throw new Error(`${expression}: ${exceptionDetails.exception?.description ?? exceptionDetails.text}`);
    return result.value;
  };
  /** Poll `expression` until it is truthy, or throw after `ms`. */
  const waitFor = async (expression, ms = 15000) => {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      if (await evaluate(expression).catch(() => false)) return;
      await sleep(200);
    }
    throw new Error(`timed out waiting for ${expression}`);
  };
  /** Save a screenshot of the viewport as `<name>.png` in the output directory. */
  const shoot = async (name) => {
    const { data } = await page('Page.captureScreenshot', { format: 'png' });
    const path = join(outDir, `${name}.png`);
    writeFileSync(path, Buffer.from(data, 'base64'));
    console.log(`screenshot ${path}`);
  };
  /** Press and release a key as the keyboard would, with its `code` so physical-key handlers see it. */
  const press = async (key, code, keyCode, { hold = 60, modifiers = 0 } = {}) => {
    const base = { key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode, modifiers };
    await page('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base });
    await sleep(hold);
    await page('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
    await sleep(120);
  };
  /** Hold a modifier, given as [key, code, keyCode, modifier bit], while pressing another key for `hold` ms. */
  const chord = async ([modKey, modCode, modKeyCode, bit], [key, code, keyCode], hold) => {
    const modifier = { key: modKey, code: modCode, windowsVirtualKeyCode: modKeyCode, nativeVirtualKeyCode: modKeyCode, modifiers: bit };
    await page('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...modifier });
    await press(key, code, keyCode, { hold, modifiers: bit });
    await page('Input.dispatchKeyEvent', { type: 'keyUp', ...modifier, modifiers: 0 });
    await sleep(120);
  };
  /** Click the centre of the first element matching `selector`. */
  const click = async (selector) => {
    const box = await evaluate(
      `(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`,
    );
    for (const type of ['mousePressed', 'mouseReleased']) {
      await page('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 });
    }
  };
  /** Type `text` into the input matching `selector`, as keystrokes so React sees it. */
  const type = async (selector, text) => {
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`);
    await page('Input.insertText', { text });
  };
  /** Mean brightness of the game canvas, 0 to 255: whether the game drew anything but black. */
  const canvasBrightness = () =>
    evaluate(`(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) return -1;
    const copy = document.createElement('canvas');
    copy.width = canvas.width; copy.height = canvas.height;
    const context = copy.getContext('2d');
    context.drawImage(canvas, 0, 0);
    const pixels = context.getImageData(0, 0, copy.width, copy.height).data;
    let sum = 0;
    for (let i = 0; i < pixels.length; i += 4) sum += pixels[i] + pixels[i + 1] + pixels[i + 2];
    return sum / (pixels.length / 4) / 3;
  })()`);

  // Sign in.
  await page('Page.navigate', { url: `${options.url}/login` });
  await waitFor(`!!document.querySelector('input[type=password]')`);
  await type('form input:not([type=password])', options.user);
  await type('input[type=password]', password);
  await click('button[type=submit]');
  await waitFor(`location.pathname !== '/login'`).catch(async (error) => {
    await shoot('00-sign-in-failed');
    throw error;
  });
  console.log(`signed in, at ${await evaluate('location.pathname')}`);

  // How /file/ labels the module's assets: the page must not depend on it, but it is worth seeing.
  for (const name of ['quake.js', 'quake.wasm']) {
    const type = await evaluate(`fetch('/file/usr/modules/quake/assets/${name}', { method: 'HEAD' }).then((r) => r.status + ' ' + r.headers.get('content-type'))`);
    console.log(`/file/ serves ${name} as ${type}`);
  }

  // The game's page.
  const gamePath = `/games/quake/${encodeURIComponent(options.game)}`;
  await page('Page.navigate', { url: `${options.url}${gamePath}` });
  await waitFor(`!!document.querySelector('[data-game-state]') && document.querySelector('[data-game-state]').dataset.gameState !== 'listing'`);
  await sleep(1500);
  await shoot('01-page');

  const hasPlay = await evaluate(`!!document.querySelector('[data-game-play]')`);
  if (!hasPlay) {
    console.log(`no Play button: ${options.game} is not here, or not fetched yet; stopping here`);
  } else {
    // The demo loop, after the click that starts the game.
    await click('[data-game-play]');
    await waitFor(`document.querySelector('[data-game-state]')?.dataset.gameState === 'running'`, 60000);
    await sleep(4000);
    console.log(`canvas brightness in the demo: ${(await canvasBrightness()).toFixed(1)}`);
    await shoot('02-demo');
    if ((await canvasBrightness()) < 2) failed = true;

    // A new game: Escape opens the menu, Enter picks Single Player, then New Game.
    await press('Escape', 'Escape', 27);
    await sleep(400);
    await shoot('03-menu');
    // The longest gap between animation frames while the level loads.
    await evaluate(`(() => {
      window.quakeGaps = { last: performance.now(), longest: 0 };
      const watch = (now) => {
        window.quakeGaps.longest = Math.max(window.quakeGaps.longest, now - window.quakeGaps.last);
        window.quakeGaps.last = now;
        requestAnimationFrame(watch);
      };
      requestAnimationFrame(watch);
    })()`);
    for (let i = 0; i < 2; i++) {
      await press('Enter', 'Enter', 13);
      await sleep(500);
    }
    await sleep(3000);
    console.log(`longest gap between frames loading the level: ${Math.round(await evaluate('window.quakeGaps.longest'))} ms`);
    await shoot('04-new-game');

    // Walk forward, turn and fire.
    await press('w', 'KeyW', 87, { hold: 1200 });
    await press('ArrowLeft', 'ArrowLeft', 37, { hold: 500 });
    await press('Control', 'ControlLeft', 17, { modifiers: 2 });
    await sleep(300);
    await shoot('05-moved');

    // Alt+H is the shell's key for Home and Alt+ArrowLeft one of its terminal's; with the game
    // focused both are Quake's (Alt strafes), and the page must stay where it is.
    await chord(['Alt', 'AltLeft', 18, 1], ['h', 'KeyH', 72], 200);
    await chord(['Alt', 'AltLeft', 18, 1], ['ArrowLeft', 'ArrowLeft', 37], 600);
    await sleep(300);
    await shoot('06-strafed');
    const after = await evaluate('location.pathname');
    console.log(`after Alt+H and Alt+ArrowLeft in the game the page is ${after}`);
    if (after !== gamePath) failed = true;

    // Fullscreen.
    await click('[aria-label="Fullscreen"]');
    await sleep(1000);
    const fullscreen = await evaluate(`document.fullscreenElement?.dataset.gameState ?? 'none'`);
    console.log(`fullscreen element is the game: ${fullscreen === 'running'}`);
    if (fullscreen !== 'running') failed = true;
    await shoot('07-fullscreen');
    await evaluate('document.exitFullscreen()');
    await sleep(500);

    // The control: with the focus off the game, Alt+H is the shell's again.
    await evaluate('document.activeElement.blur()');
    await chord(['Alt', 'AltLeft', 18, 1], ['h', 'KeyH', 72], 200);
    await sleep(800);
    const home = await evaluate('location.pathname');
    console.log(`after Alt+H outside the game the page is ${home}`);
    if (home === gamePath) failed = true;
  }
} catch (error) {
  console.error(error);
  failed = true;
} finally {
  console.log('--- page console ---');
  for (const line of console_) console.log(line);
  cdp.close();
  chrome.kill();
  await sleep(500);
  rmSync(profile, { recursive: true });
}
process.exit(failed ? 1 : 0);
