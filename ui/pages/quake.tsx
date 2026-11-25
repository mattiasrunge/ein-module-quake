import { ActionIcon, Box, Loader, Menu, Paper, ScrollArea, Stack, Text, Tooltip, UnstyledButton } from '@mantine/core';
import { EntityDetailHeader, TablerIcon } from '@ein/ui/components';
import { usePhone } from '@ein/ui/hooks';
import { formatBytes, shq } from '@ein/ui/lib';
import { addToQueue, currentUser, execCommand, notify, uploadBatchDone } from '@ein/ui/signals';
import { useCallback, useEffect, useRef, useState } from 'react';
import { titlePicture } from '../quake/conback.ts';
import { type Engine, quitted, startEngine } from '../quake/engine.ts';
import { deleteGame, type Game, GAMES, listGames } from '../quake/games.ts';
import { K_MWHEELDOWN, K_MWHEELUP, mouseKey, quakeKey } from '../quake/keys.ts';
import { useGameLoop } from '../quake/loop.ts';
import { keeper, loadKept, savesFolder } from '../quake/saves.ts';
import { openSound, type Sound } from '../quake/sound.ts';

export const handle = { fullBleed: true, title: 'Quake', pattern: 'mixed' };

/** Where the game is: waiting for the click that starts it, loading, playing, or stopped by an error. */
type State =
  | { kind: 'idle' }
  | { kind: 'loading'; game: Game }
  | { kind: 'running'; game: Game }
  | { kind: 'error'; message: string };

/** How many of Quake's last printed lines an error shows, since `Sys_Error` prints its reason before it exits. */
const LOG_TAIL = 6;

/** The browser remembers the game last chosen and whether the sound was off. */
const CHOSEN_KEY = 'quake.game';
const MUTED_KEY = 'quake.muted';

const remembered = (key: string): string | null => {
  try {
    return globalThis.localStorage.getItem(key);
  } catch {
    return null;
  }
};

const remember = (key: string, value: string) => {
  try {
    globalThis.localStorage.setItem(key, value);
  } catch {
    // A browser that keeps nothing chooses again next time.
  }
};

/** The bar's round buttons: finger-sized on a phone, as the app header's are. */
const BAR_BUTTON = { size: 36, icon: 22 };

/**
 * The module's page: the games there are in a box at the left, as Chat's recent chats are, and the
 * game beside them. A click on a game plays it, which is also the click a browser wants before a
 * page may make sound. A folder of paks dropped anywhere on the page is uploaded into `GAMES` as a
 * game. A click on the running game hands it the mouse (the browser's pointer lock), which looks
 * around and fires; while the game has the mouse or the focus it takes every key it knows before the
 * shell does. A game saved from Quake's menu, and the player's settings, are kept in their home
 * (`savesFolder`), and Load lists the saves next time. Add music uploads the files picked into the
 * chosen game's own music folder, where it plays them for the CD's tracks.
 */
export default function Quake() {
  const phone = usePhone();
  const frame = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const engine = useRef<Engine | null>(null);
  const sound = useRef<Sound | null>(null);
  const log = useRef<string[]>([]);
  const [games, setGames] = useState<Game[] | null>(null);
  const [listError, setListError] = useState<string>();
  const [chosen, setChosen] = useState(() => remembered(CHOSEN_KEY));
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [fullscreen, setFullscreen] = useState(false);
  const [locked, setLocked] = useState(false);
  const [muted, setMuted] = useState(() => remembered(MUTED_KEY) === '1');

  // The game to offer: the one chosen last, else the first, the shareware episode when it is there.
  const selected = games?.find((game) => game.name === chosen) ?? games?.[0];
  const [cover, setCover] = useState<string>();
  // What the header names: the game playing or loading, else the one Play would start.
  const shown = state.kind === 'loading' || state.kind === 'running' ? state.game : selected;

  // The header shows the title art of the game chosen, and keeps the last one while the next is read.
  useEffect(() => {
    if (!selected) return;
    let current = true;
    void titlePicture(selected).then((picture) => {
      if (current && picture) setCover(picture);
    });
    return () => {
      current = false;
    };
  }, [selected?.name, selected?.size]);

  const refresh = useCallback(() => {
    listGames().then((found) => {
      setGames(found);
      setListError(undefined);
    }).catch((error) => setListError(error instanceof Error ? error.message : String(error)));
  }, []);
  useEffect(refresh, [refresh]);
  // Uploads land in the games folder: a game dropped on the page, or music added to one.
  useEffect(() =>
    uploadBatchDone.subscribe((batch) => {
      if (batch?.dirs.some((dir) => dir === GAMES || dir.startsWith(`${GAMES}/`))) refresh();
    }), [refresh]);

  const musicInput = useRef<HTMLInputElement>(null);
  const addMusic = (files: File[]) => {
    if (!selected || files.length === 0) return;
    const folder = `${GAMES}/${selected.name}/music`;
    // The folder is made when the files go, so a game gets one only when it has music.
    const target = async () => {
      await execCommand(`mkdir -p ${shq(folder)}`);
      return folder;
    };
    addToQueue(files, target, { label: `${selected.title}'s music` });
  };

  const stop = useCallback(() => {
    // The player's settings are kept as Quit keeps them, when the game is still there to write them.
    try {
      engine.current?.writeConfig();
    } catch {
      // A game that already ended wrote them when it did.
    }
    engine.current = null;
    sound.current?.close();
    sound.current = null;
    if (document.pointerLockElement === frame.current) document.exitPointerLock();
  }, []);
  useEffect(() => stop, [stop]);

  const play = useCallback(async (game: Game) => {
    stop();
    setChosen(game.name);
    remember(CHOSEN_KEY, game.name);
    log.current = [];
    setState({ kind: 'loading', game });
    frame.current?.focus();
    // Opened in the click, before anything is awaited: a browser lets a page make sound only then.
    const audio = openSound();
    audio.setMuted(muted);
    sound.current = audio;
    try {
      // Someone signed in plays with their saves and settings of this game; without an account they
      // last as long as the page.
      const username = currentUser.value?.username;
      const folder = username ? savesFolder(username, game.name) : undefined;
      const kept = folder ? await loadKept(folder) : [];
      const started = await startEngine({
        game,
        sound: audio,
        kept,
        ...(folder
          ? { onKeep: keeper(folder, (error) => notify({ message: `The game was not saved: ${error instanceof Error ? error.message : String(error)}`, color: 'red' })) }
          : {}),
        log: (line) => {
          log.current = [...log.current.slice(-(LOG_TAIL - 1)), line];
          console.info(`[quake] ${line}`);
        },
      });
      // Another game was chosen while this one loaded.
      if (sound.current !== audio) return;
      engine.current = started;
      setState({ kind: 'running', game });
      frame.current?.focus();
    } catch (error) {
      if (sound.current !== audio) return;
      stop();
      setState({ kind: 'error', message: describe(error, log.current) });
    }
  }, [muted, stop]);

  const remove = useCallback(async (game: Game) => {
    if (!globalThis.confirm(`Delete ${game.title} (${game.name})? Everyone who plays here loses it.`)) return;
    if (state.kind !== 'idle' && state.kind !== 'error' && state.game.name === game.name) {
      stop();
      setState({ kind: 'idle' });
    }
    try {
      await deleteGame(game.name);
    } catch (error) {
      setListError(error instanceof Error ? error.message : String(error));
    }
    refresh();
  }, [state, stop, refresh]);

  useGameLoop(state.kind === 'running' ? engine.current : null, canvas, (error) => {
    // The game has ended: it wrote its settings itself on Quit, and can write nothing after an error.
    engine.current = null;
    stop();
    // Quit from Quake's menu leaves the page as it was before Play.
    if (quitted(error)) setState({ kind: 'idle' });
    else setState({ kind: 'error', message: describe(error, log.current) });
  });

  // A hidden page draws no frames, so the game stands still; its sound and music wait with it.
  useEffect(() => {
    const onVisibility = () => sound.current?.hold(document.hidden);
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  // Keys and the mouse, in the capture phase on the window so the shell's own listeners (on the
  // document, and the window's bubbling phase) never see them while the game has the focus or the mouse.
  useEffect(() => {
    if (state.kind !== 'running') return;
    const node = frame.current;
    const held = new Set<number>();
    const captured = () => !!node && document.pointerLockElement === node;
    const focused = () => captured() || (!!node && node.contains(document.activeElement));
    const press = (pressed: boolean, key: number) => {
      if (pressed) held.add(key);
      else held.delete(key);
      engine.current?.key(pressed, key);
    };
    const onKey = (event: KeyboardEvent) => {
      if (!engine.current || !focused() || event.metaKey) return;
      const key = quakeKey(event.code);
      if (key === undefined) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const pressed = event.type === 'keydown';
      if (pressed && event.repeat) return;
      press(pressed, key);
    };
    // The first click hands the game the mouse; after that the buttons are the game's.
    const onMouseDown = (event: MouseEvent) => {
      if (!node?.contains(event.target as Node)) return;
      if (!captured()) {
        node.focus();
        void Promise.resolve(node.requestPointerLock()).catch(() => undefined);
        return;
      }
      const key = mouseKey(event.button);
      if (key === undefined) return;
      event.preventDefault();
      press(true, key);
    };
    const onMouseUp = (event: MouseEvent) => {
      const key = mouseKey(event.button);
      if (key !== undefined && held.has(key)) press(false, key);
    };
    const onMouseMove = (event: MouseEvent) => {
      if (captured()) engine.current?.mouse(event.movementX, event.movementY);
    };
    const onWheel = (event: WheelEvent) => {
      if (!captured() || event.deltaY === 0) return;
      event.preventDefault();
      const key = event.deltaY < 0 ? K_MWHEELUP : K_MWHEELDOWN;
      engine.current?.key(true, key);
      engine.current?.key(false, key);
    };
    const onContextMenu = (event: MouseEvent) => {
      if (node?.contains(event.target as Node)) event.preventDefault();
    };
    // A key or button held while the game loses the focus or the mouse would never come up for it: let go of them all.
    const release = () => {
      for (const key of held) engine.current?.key(false, key);
      held.clear();
    };
    const onLockChange = () => {
      setLocked(captured());
      if (!captured()) release();
    };
    globalThis.addEventListener('keydown', onKey, { capture: true });
    globalThis.addEventListener('keyup', onKey, { capture: true });
    globalThis.addEventListener('mousedown', onMouseDown, { capture: true });
    globalThis.addEventListener('mouseup', onMouseUp, { capture: true });
    globalThis.addEventListener('mousemove', onMouseMove, { capture: true });
    globalThis.addEventListener('wheel', onWheel, { capture: true, passive: false });
    globalThis.addEventListener('contextmenu', onContextMenu, { capture: true });
    globalThis.addEventListener('blur', release);
    document.addEventListener('pointerlockchange', onLockChange);
    node?.addEventListener('focusout', release);
    return () => {
      globalThis.removeEventListener('keydown', onKey, { capture: true });
      globalThis.removeEventListener('keyup', onKey, { capture: true });
      globalThis.removeEventListener('mousedown', onMouseDown, { capture: true });
      globalThis.removeEventListener('mouseup', onMouseUp, { capture: true });
      globalThis.removeEventListener('mousemove', onMouseMove, { capture: true });
      globalThis.removeEventListener('wheel', onWheel, { capture: true });
      globalThis.removeEventListener('contextmenu', onContextMenu, { capture: true });
      globalThis.removeEventListener('blur', release);
      document.removeEventListener('pointerlockchange', onLockChange);
      node?.removeEventListener('focusout', release);
      setLocked(false);
    };
  }, [state]);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === frame.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else {
      void frame.current?.requestFullscreen().then(() => frame.current?.requestPointerLock()).catch(() => undefined);
    }
    frame.current?.focus();
  };

  const toggleMuted = () => {
    const next = !muted;
    setMuted(next);
    remember(MUTED_KEY, next ? '1' : '0');
    sound.current?.setMuted(next);
    frame.current?.focus();
  };

  const list = { games, error: listError, active: state.kind === 'loading' || state.kind === 'running' ? state.game.name : selected?.name, onPlay: play };

  return (
    <Paper
      radius={0}
      bg='var(--mrx-surface-base)'
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: 'calc(100dvh - var(--app-shell-header-offset, 48px))',
        minHeight: phone ? undefined : 420,
        overflow: 'hidden',
      }}
    >
      <EntityDetailHeader
        eyebrow={shown ? 'Quake' : undefined}
        title={shown?.title ?? 'Quake'}
        name='Quake'
        pattern='mixed'
        flowContent
        // The game's own title art, its console background, read out of its paks.
        coverArt={cover ? <img src={cover} alt='' style={{ width: '100%', height: '100%', objectFit: 'cover', imageRendering: 'pixelated' }} /> : undefined}
        controls={phone ? <GameMenu {...list} /> : undefined}
        actions={{
          upload: { path: GAMES, name: 'Quake', keepFolders: true },
          items: [
            { label: muted ? 'Sound on' : 'Sound off', icon: muted ? 'volume-off' : 'volume', onClick: toggleMuted, button: true, iconOnly: true, stays: true },
            { label: 'Fullscreen', icon: 'maximize', onClick: toggleFullscreen, disabled: state.kind !== 'running', button: true, iconOnly: true, stays: true },
            { label: selected ? `Add music to ${selected.title}` : 'Add music', icon: 'music', onClick: () => musicInput.current?.click(), disabled: !selected },
          ],
        }}
      />
      {/* The music's files: picked here, uploaded into the chosen game's music folder. */}
      <input
        ref={musicInput}
        type='file'
        accept='audio/*'
        multiple
        hidden
        onChange={(event) => {
          addMusic([...(event.currentTarget.files ?? [])]);
          event.currentTarget.value = '';
        }}
      />
      <Box style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <GamePane {...list} onDelete={remove} />
        <Box
          ref={frame}
          tabIndex={0}
          data-quake-state={state.kind}
          onMouseDown={() => frame.current?.focus()}
          p={fullscreen ? 0 : 'md'}
          style={{
            flex: 1,
            minWidth: 0,
            outline: 'none',
            containerType: 'size',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 'var(--mantine-spacing-xs)',
            background: fullscreen ? '#000' : undefined,
          }}
        >
          {/* 640 by 480, square pixels at 4:3, as large as fits beside the line under it. */}
          <Box
            pos='relative'
            style={{
              width: fullscreen ? 'min(100cqw, 133.333cqh)' : 'min(100cqw, calc((100cqh - 2.5rem) * 4 / 3))',
              aspectRatio: '4 / 3',
              background: '#000',
              flex: 'none',
            }}
          >
            <canvas
              ref={canvas}
              width={640}
              height={480}
              // The pointer would stand over the game's view; once the game has the mouse the browser hides it anyway.
              style={{ width: '100%', height: '100%', imageRendering: 'pixelated', display: 'block', cursor: state.kind === 'running' ? 'none' : undefined }}
            />
            {state.kind !== 'running' && (
              <Stack
                pos='absolute'
                inset={0}
                align='center'
                justify='center'
                gap='md'
                p='md'
                // While a game loads, and after it quit or stopped, its last frame stays dimmed behind.
                bg='rgba(0, 0, 0, 0.75)'
                style={{ overflow: 'auto' }}
              >
                {state.kind === 'error' && (
                  <Stack gap={4} maw={640} w='100%' data-quake-error>
                    <Text c='red.5' fw={600}>Quake stopped</Text>
                    <Text c='gray.3' size='sm' style={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>{state.message}</Text>
                  </Stack>
                )}
                {state.kind === 'loading'
                  ? <Loader color='orange' />
                  : selected
                  ? (
                    <UnstyledButton onClick={() => void play(selected)} data-quake-play style={{ textAlign: 'center' }}>
                      <Stack align='center' gap={6}>
                        <TablerIcon name='player-play' size={56} color='var(--mantine-color-orange-6)' />
                        <Text c='gray.3' fw={600}>{state.kind === 'error' ? 'Play again' : 'Play'} {selected.title}</Text>
                      </Stack>
                    </UnstyledButton>
                  )
                  : <Text c='gray.4' ta='center' size='sm'>{games ? 'No game data yet. Drop a folder with pak0.pak on the page.' : ''}</Text>}
              </Stack>
            )}
          </Box>
          {!fullscreen && (
            <Text c='dimmed' size='xs' ta='center' lineClamp={2} maw={960}>
              {state.kind === 'running' && !locked
                ? 'Click the game to give it the mouse and the keyboard. '
                : state.kind === 'running'
                ? 'Escape gives the mouse back. '
                : ''}
              The mouse looks and fires, WASD or the arrows move, Space jumps, Shift runs, Escape is the menu, ` the console.
            </Text>
          )}
        </Box>
      </Box>
    </Paper>
  );
}

type ListProps = {
  games: Game[] | null;
  error?: string;
  /** The game playing, loading, or chosen to play next. */
  active?: string;
  onPlay: (game: Game) => void;
};

/**
 * The games, each a row that plays it. In the pane beside the game (`onDelete`, which gives each a
 * button that deletes it) a row is the game's title art with its title under it; in the phone's
 * menu, its title alone. `onPick` hears a row chosen.
 */
function GameList({ games, error, active, onPlay, onDelete, onPick }: ListProps & { onDelete?: (game: Game) => void; onPick?: () => void }) {
  if (error) return <Text size='sm' c='red' p='sm'>{error}</Text>;
  if (!games) return <Loader size='sm' m='sm' />;
  if (games.length === 0) {
    return (
      <Text size='sm' c='dimmed' p='sm'>
        No games yet. The shareware episode and LibreQuake are fetched when the module is installed and show up here when they are in; drop a folder with your own pak0.pak on
        the page to add a game.
      </Text>
    );
  }
  const detail = (game: Game) => `${game.name} · ${formatBytes(game.size)} · ${game.music ? 'music' : 'no music'}`;
  return (
    <Stack gap={onDelete ? 'xs' : 2}>
      {games.map((game) => (
        <UnstyledButton
          key={game.name}
          onClick={() => {
            onPick?.();
            onPlay(game);
          }}
          data-quake-game={game.name}
          style={{
            padding: onDelete ? 6 : '8px 10px',
            borderRadius: 'var(--mantine-radius-md)',
            background: game.name === active ? 'var(--mrx-surface-raised)' : undefined,
            outline: game.name === active && onDelete ? '2px solid var(--mantine-color-orange-6)' : undefined,
            outlineOffset: -2,
          }}
        >
          {onDelete && (
            <Box pos='relative' mb={6}>
              <TitleArt game={game} />
              <Tooltip label='Delete game'>
                <ActionIcon
                  pos='absolute'
                  top={6}
                  right={6}
                  variant='filled'
                  color='dark'
                  size='sm'
                  component='span'
                  role='button'
                  onClick={(event) => {
                    event.stopPropagation();
                    onDelete(game);
                  }}
                  aria-label={`Delete ${game.name}`}
                >
                  <TablerIcon name='trash' size={14} />
                </ActionIcon>
              </Tooltip>
            </Box>
          )}
          <Text size='sm' truncate fw={game.name === active ? 600 : 400}>{game.title}</Text>
          <Text size='xs' c='dimmed' truncate>{detail(game)}</Text>
        </UnstyledButton>
      ))}
    </Stack>
  );
}

/** A game's title art at 8:5, the console background's shape, or a dark tile when it has none to show. */
function TitleArt({ game }: { game: Game }) {
  const [picture, setPicture] = useState<string | null>();
  useEffect(() => {
    let current = true;
    void titlePicture(game).then((found) => {
      if (current) setPicture(found ?? null);
    });
    return () => {
      current = false;
    };
  }, [game.name, game.size]);
  return (
    <Box
      style={{
        aspectRatio: '8 / 5',
        borderRadius: 'var(--mantine-radius-sm)',
        overflow: 'hidden',
        background: '#000',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {picture
        ? <img src={picture} alt='' style={{ width: '100%', height: '100%', imageRendering: 'pixelated', display: 'block' }} />
        : picture === null && <TablerIcon name='/usr/modules/quake/assets/icon.svg' size={40} color='var(--mantine-color-dark-3)' />}
    </Box>
  );
}

/** The games beside the game, in a bordered box in the page's margin as Chat's recent chats are. */
function GamePane(props: ListProps & { onDelete: (game: Game) => void }) {
  return (
    <Box w={300} h='100%' p='md' pr={0} style={{ flex: '0 0 300px', overflow: 'hidden' }} visibleFrom='sm'>
      <Paper h='100%' p='sm' radius='md' withBorder>
        <Stack gap='xs' h='100%'>
          <ScrollArea type='auto' scrollbars='y' offsetScrollbars='y' style={{ flex: 1, minHeight: 0 }}>
            <GameList {...props} />
          </ScrollArea>
          <Text size='xs' c='dimmed'>Drop a folder with a game's paks anywhere on the page to add it.</Text>
        </Stack>
      </Paper>
    </Box>
  );
}

/** On a phone, where there is no room for the box beside the game, the games are a menu in the bar. */
function GameMenu(props: ListProps) {
  const [opened, setOpened] = useState(false);
  return (
    <Menu shadow='md' width={320} position='bottom-end' opened={opened} onChange={setOpened}>
      <Menu.Target>
        <Tooltip label='Games'>
          <ActionIcon variant='subtle' size={BAR_BUTTON.size} aria-label='Games'>
            <TablerIcon name='list' size={BAR_BUTTON.icon} />
          </ActionIcon>
        </Tooltip>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>Games</Menu.Label>
        <ScrollArea.Autosize mah={420} type='auto' scrollbars='y' px={4} styles={{ content: { minWidth: 0 } }}>
          <GameList {...props} onPick={() => setOpened(false)} />
        </ScrollArea.Autosize>
      </Menu.Dropdown>
    </Menu>
  );
}

/** An error and the last lines Quake printed, which say why when the game itself gave up. */
function describe(error: unknown, lines: string[]): string {
  // Quake ends with exit(1) when it gives up (`Sys_Error`); Emscripten throws its own ExitStatus,
  // not an Error, and the lines before it say why.
  const exit = error as { name?: string; status?: number } | null;
  const message = error instanceof Error ? error.message : exit?.name === 'ExitStatus' ? `Quake exited with status ${exit.status}` : String(error);
  return [message, ...lines].join('\n');
}
