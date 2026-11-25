import { type RefObject, useEffect } from 'react';
import type { Engine } from './engine.ts';

/**
 * Run `engine` while it is set: the time since the last on every animation frame, and a blit onto
 * `canvas` when the game drew, the canvas as large as the game's frame, which a Quake 2 player
 * changes with the video mode. `onEnd` hears the error the game ended with, Quit included. A hidden
 * page draws no frames, so the game stands still while it is hidden.
 */
export function useGameLoop(engine: Engine | null, canvas: RefObject<HTMLCanvasElement | null>, onEnd: (error: unknown) => void) {
  useEffect(() => {
    const context = canvas.current?.getContext('2d');
    if (!engine || !context) return;
    let image: ImageData | undefined;
    let drawn = -1;
    let request = 0;
    const step = () => {
      try {
        engine.tick();
      } catch (error) {
        onEnd(error);
        return;
      }
      if (engine.frames() !== drawn) {
        drawn = engine.frames();
        const [width, height] = [engine.width(), engine.height()];
        if (image?.width !== width || image?.height !== height) {
          context.canvas.width = width;
          context.canvas.height = height;
          image = context.createImageData(width, height);
        }
        engine.draw(image);
        context.putImageData(image, 0, 0);
      }
      request = requestAnimationFrame(step);
    };
    request = requestAnimationFrame(step);
    return () => cancelAnimationFrame(request);
  }, [engine]);
}
