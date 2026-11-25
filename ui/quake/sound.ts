import { fileUrl } from '@ein/ui/lib';

/**
 * The game's sound on Web Audio. Quake mixes its sound effects itself, into a ring of samples the
 * engine keeps (`engine/snd_ein.c`); a processor node asks it for them as it needs them. The music
 * was the CD's audio tracks; here it is `track<NN>.ogg` of the game's music folder, played by an
 * audio element through the same output, at the CD Music Volume of Quake's options.
 */

/** Frames the effects are asked for at a time: about 43 ms at 48 kHz, inside the 100 ms Quake mixes ahead. */
const MIX_FRAMES = 2048;

/** What the engine calls (`engine/cd_ein.c`); handed to the Emscripten module as `einMusic`. */
export type MusicSink = {
  play(track: number, looping: boolean): void;
  stop(): void;
  pause(paused: boolean): void;
  volume(level: number): void;
};

/** The game's audio: the effects once they can be pulled, the music, and the controls the page has. */
export type Sound = {
  context: AudioContext;
  /** Pull the effects from `render`, which fills `left` and `right` with the next samples. */
  effects(render: (left: Float32Array, right: Float32Array) => void): void;
  /** The music of the game whose tracks are in `folder`, or silence for none. */
  music(folder: string | undefined): MusicSink;
  muted(): boolean;
  setMuted(muted: boolean): void;
  /** Hold everything while the page is hidden, and go on when it shows again. */
  hold(held: boolean): void;
  close(): void;
};

/**
 * Open the game's audio. Call it from the click that starts the game: a browser lets a page make
 * sound only after the person has done something on it.
 */
export function openSound(): Sound {
  const context = new AudioContext();
  const master = context.createGain();
  master.connect(context.destination);
  let processor: ScriptProcessorNode | undefined;
  let track: HTMLAudioElement | undefined;
  // Whether Quake has the music paused, which the page's holding must not undo.
  let paused = false;
  const musicGain = context.createGain();
  musicGain.connect(master);

  const stopTrack = () => {
    if (!track) return;
    track.pause();
    track.removeAttribute('src');
    track.load();
    track = undefined;
  };

  return {
    context,
    effects(render) {
      // A ScriptProcessorNode runs on the page's own thread, where the engine is: an AudioWorklet
      // would need the engine on the audio thread too.
      processor = context.createScriptProcessor(MIX_FRAMES, 0, 2);
      processor.onaudioprocess = (event) => render(event.outputBuffer.getChannelData(0), event.outputBuffer.getChannelData(1));
      processor.connect(master);
    },
    music(folder) {
      return {
        play(number, looping) {
          stopTrack();
          paused = false;
          if (!folder) return;
          const audio = new Audio(fileUrl(`${folder}/track${String(number).padStart(2, '0')}.ogg`));
          audio.loop = looping;
          // A track the game has no file for, or one the browser cannot play, is silence.
          audio.onerror = () => {
            if (track === audio) stopTrack();
          };
          context.createMediaElementSource(audio).connect(musicGain);
          track = audio;
          void audio.play().catch(() => undefined);
        },
        stop: stopTrack,
        pause(pause) {
          paused = pause;
          if (pause) track?.pause();
          else void track?.play().catch(() => undefined);
        },
        volume(level) {
          musicGain.gain.value = level;
        },
      };
    },
    muted: () => master.gain.value === 0,
    setMuted(muted) {
      master.gain.value = muted ? 0 : 1;
    },
    hold(held) {
      if (held) {
        void context.suspend();
        track?.pause();
      } else {
        void context.resume();
        if (!paused) void track?.play().catch(() => undefined);
      }
    },
    close() {
      stopTrack();
      if (processor) {
        processor.onaudioprocess = null;
        processor.disconnect();
      }
      void context.close();
    },
  };
}
