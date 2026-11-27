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
const K_MOUSE1 = 200;
const K_MOUSE2 = 201;
const K_MOUSE3 = 202;

/** The mouse wheel turned up and down, as Quake numbers its keys, and as Yamagi Quake II (`keyboard.h`) and Quake 3 (`keycodes.h`) number theirs. */
export const WHEEL: Record<EngineName, { up: number; down: number }> = {
  quake: { up: 239, down: 240 },
  quake2: { up: 184, down: 183 },
  quake3: { up: 184, down: 183 },
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

/**
 * Quake 3's key codes (`keycodes.h`) where they are not Quake's: the keys that are not a character,
 * numbered on from 128 in another order, and the console's key, which opens the console whatever it
 * is bound to.
 */
const QUAKE3: Record<string, number> = {
  Tab: K_TAB,
  Enter: K_ENTER,
  Escape: K_ESCAPE,
  Space: K_SPACE,
  Backspace: K_BACKSPACE,
  CapsLock: 129,
  Pause: 131,
  ArrowUp: 132,
  ArrowDown: 133,
  ArrowLeft: 134,
  ArrowRight: 135,
  AltLeft: 136,
  AltRight: 136,
  ControlLeft: 137,
  ControlRight: 137,
  ShiftLeft: 138,
  ShiftRight: 138,
  Insert: 139,
  Delete: 140,
  PageDown: 141,
  PageUp: 142,
  Home: 143,
  End: 144,
  NumpadEnter: 169,
  NumpadDivide: 172,
  NumpadSubtract: 173,
  NumpadAdd: 174,
  NumpadMultiply: 176,
  Backquote: 371,
  IntlBackslash: 371,
};

/** Quake 3's first function key, F1; F2 to F12 follow it. */
const QUAKE3_F1 = 145;

/** The Quake 3 key for a physical key, or undefined for one Quake 3 has no use for. */
export function quake3Key(code: string): number | undefined {
  if (code in QUAKE3) return QUAKE3[code];
  const fn = code.match(/^F([1-9]|1[0-2])$/);
  if (fn) return QUAKE3_F1 + Number(fn[1]) - 1;
  return quakeKey(code);
}

/**
 * The Yamagi Quake II key for a physical key: Yamagi numbers its keys as Quake 3 does
 * (`keyboard.h`), but the console's key, which comes as '`' and opens the console whatever it is
 * bound to (`quake2_ein.c`).
 */
export function quake2Key(code: string): number | undefined {
  if (code === 'Backquote' || code === 'IntlBackslash') return '`'.charCodeAt(0);
  return quake3Key(code);
}

/** The Quake 3 key for a mouse button, and Yamagi Quake II's: left, right and middle, then the two side buttons. */
export function quake3MouseKey(button: number): number | undefined {
  return [178, 180, 179, 181, 182][button];
}

/** The characters the punctuation keys type with Shift held, on a US keyboard, as the keys themselves are read. */
const SHIFTED: Record<string, string> = {
  '-': '_',
  '=': '+',
  '[': '{',
  ']': '}',
  '\\': '|',
  ';': ':',
  "'": '"',
  ',': '<',
  '.': '>',
  '/': '?',
  '1': '!',
  '2': '@',
  '3': '#',
  '4': '$',
  '5': '%',
  '6': '^',
  '7': '&',
  '8': '*',
  '9': '(',
  '0': ')',
};

/**
 * The character a physical key types into Quake 3's and Yamagi Quake II's console and their menus'
 * fields, on a US keyboard as the keys are read, with Shift held or not; Backspace is Ctrl+H, as
 * Quake 3 takes it. Undefined for a key that types nothing, the console's key among them.
 */
export function quake3Character(code: string, shift: boolean): string | undefined {
  if (code === 'Backspace') return '\b';
  if (code === 'Space') return ' ';
  if (code === 'Backquote' || code === 'IntlBackslash' || code.startsWith('Numpad') && !/^Numpad[0-9]$/.test(code)) return undefined;
  const key = quakeKey(code);
  if (key === undefined || key < 33 || key > 126) return undefined;
  const character = String.fromCharCode(key);
  if (!shift) return character;
  return /[a-z]/.test(character) ? character.toUpperCase() : SHIFTED[character] ?? character;
}
