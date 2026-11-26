/**
 * Quake's key codes (`quakekeys.h`) for the browser's physical keys (`KeyboardEvent.code`) and mouse
 * buttons, so a key goes up as the same Quake key it went down as, whatever the keyboard layout
 * makes of it.
 */

import type { EngineName } from '../../lib/api.ts';

const K_TAB = 9;
const K_ENTER = 13;
const K_ESCAPE = 27;
const K_SPACE = 32;
const K_BACKSPACE = 127;
const K_UPARROW = 128;
const K_DOWNARROW = 129;
const K_LEFTARROW = 130;
const K_RIGHTARROW = 131;
const K_ALT = 132;
const K_CTRL = 133;
const K_SHIFT = 134;
const K_F1 = 135;
const K_INS = 147;
const K_DEL = 148;
const K_PGDN = 149;
const K_PGUP = 150;
const K_HOME = 151;
const K_END = 152;
const K_PAUSE = 255;
export const K_MOUSE1 = 200;
export const K_MOUSE2 = 201;
export const K_MOUSE3 = 202;

/** The mouse wheel turned up and down, which Quake II numbers the other way round from Quake (`keys.h`). */
export const WHEEL: Record<EngineName, { up: number; down: number }> = {
  quake: { up: 239, down: 240 },
  quake2: { up: 240, down: 239 },
};

/** Keys that are not a character. */
const SPECIAL: Record<string, number> = {
  Tab: K_TAB,
  Enter: K_ENTER,
  NumpadEnter: K_ENTER,
  Escape: K_ESCAPE,
  Space: K_SPACE,
  Backspace: K_BACKSPACE,
  ArrowUp: K_UPARROW,
  ArrowDown: K_DOWNARROW,
  ArrowLeft: K_LEFTARROW,
  ArrowRight: K_RIGHTARROW,
  AltLeft: K_ALT,
  AltRight: K_ALT,
  ControlLeft: K_CTRL,
  ControlRight: K_CTRL,
  ShiftLeft: K_SHIFT,
  ShiftRight: K_SHIFT,
  Insert: K_INS,
  Delete: K_DEL,
  PageDown: K_PGDN,
  PageUp: K_PGUP,
  Home: K_HOME,
  End: K_END,
  Pause: K_PAUSE,
};

/** Punctuation keys as the character they make unshifted on a US keyboard, which Quake expects. */
const PUNCTUATION: Record<string, string> = {
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  // The console's key.
  Backquote: '`',
  IntlBackslash: '`',
  Comma: ',',
  Period: '.',
  Slash: '/',
  NumpadAdd: '+',
  NumpadSubtract: '-',
};

/** The Quake key for a physical key, or undefined for one Quake has no use for. */
export function quakeKey(code: string): number | undefined {
  if (code in SPECIAL) return SPECIAL[code];
  if (code in PUNCTUATION) return PUNCTUATION[code].charCodeAt(0);
  const fn = code.match(/^F([1-9]|1[0-2])$/);
  if (fn) return K_F1 + Number(fn[1]) - 1;
  const letter = code.match(/^Key([A-Z])$/);
  if (letter) return letter[1].toLowerCase().charCodeAt(0);
  const digit = code.match(/^(?:Digit|Numpad)([0-9])$/);
  if (digit) return digit[1].charCodeAt(0);
  return undefined;
}

/** The Quake key for a mouse button (`MouseEvent.button`): left fires, right and middle are Quake's second and third. */
export function mouseKey(button: number): number | undefined {
  return button === 0 ? K_MOUSE1 : button === 2 ? K_MOUSE2 : button === 1 ? K_MOUSE3 : undefined;
}
