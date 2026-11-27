/** The keys of an engine whose console and menus' fields take the characters typed, beside the keys. */
import { type Controls, keyControls, type PostInput } from '@games/worker';
import { quake3Character } from './keys.ts';

/**
 * Controls that post each key, mouse button and wheel turn as `map` numbers them, as `keyControls`
 * does, and with each key pressed the character it types (`quake3Character`), which Yamagi Quake II
 * and Quake 3 take apart from the keys for their console and their menus' fields.
 */
export function typingControls(post: PostInput, map: Parameters<typeof keyControls>[1]): Controls {
  const keys = keyControls(post, map);
  let shift = false;
  return {
    ...keys,
    key(pressed, code) {
      if (code === 'ShiftLeft' || code === 'ShiftRight') shift = pressed;
      const taken = keys.key(pressed, code);
      const character = pressed ? quake3Character(code, shift) : undefined;
      if (character) post({ type: 'char', character: character.charCodeAt(0) });
      return taken;
    },
  };
}
