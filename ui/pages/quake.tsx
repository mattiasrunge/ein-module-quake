import {
  ActionIcon,
  Box,
  Button,
  CopyButton,
  Group,
  Loader,
  Menu,
  Modal,
  NumberInput,
  Paper,
  ScrollArea,
  SegmentedControl,
  Select,
  Stack,
  Text,
  TextInput,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import { EntityDetailHeader, TablerIcon } from '@ein/ui/components';
import { usePhone, usePolledCommand } from '@ein/ui/hooks';
import { formatBytes, formatDateTime, shq } from '@ein/ui/lib';
import { addToQueue, currentUser, execCommand, notify, uploadBatchDone } from '@ein/ui/signals';
import { useCallback, useEffect, useRef, useState } from 'react';
import { titlePicture } from '../quake/conback.ts';
import { type Engine, quitted, startEngine } from '../quake/engine.ts';
import { deleteGame, ENGINE_TITLES, fetchGame, type Game, GAMES, listGames, type Offer, OFFERS } from '../quake/games.ts';
import { K_MWHEELDOWN, K_MWHEELUP, mouseKey, quakeKey } from '../quake/keys.ts';
import { DEFAULT_PLAYERS, defaultMap, MAX_PLAYERS } from '../../lib/games.ts';
import { useGameLoop } from '../quake/loop.ts';
import {
  acceptInvitation,
  type GameMode,
  hostServer,
  type Invite,
  invitedGame,
  inviteToServer,
  type Joined,
  joinServer,
  type Link,
  openLink,
  type Seat,
  type ServerInfo,
  SERVERS_COMMAND,
  stopServer,
} from '../quake/multiplayer.ts';
import { keeper, loadKept, savesFolder } from '../quake/saves.ts';
import { openSound, type Sound } from '../quake/sound.ts';

export const handle = { fullBleed: true, title: 'Quake', pattern: 'mixed' };

/**
 * Where the game is: waiting for the click that starts it, loading, playing, or stopped by an error.
 * A game played on a server someone hosts has its seat.
 */
type State =
  | { kind: 'idle' }
  | { kind: 'loading'; game: Game; online?: boolean }
  | { kind: 'running'; game: Game; seat?: Seat }
  | { kind: 'error'; game: Game; message: string };

/** How often the list of hosted games is asked for again. */
const SERVERS_POLL_MS = 3000;

/** How many of the game's last printed lines an error shows, since `Sys_Error` prints its reason before it exits. */
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
 * game beside them, Quake's or Quake 2's, each played by its own engine. A click on a game plays it, which is also the click a browser wants before a
 * page may make sound. A folder of paks dropped anywhere on the page is uploaded into `GAMES` as a
 * game. A click on the running game hands it the mouse (the browser's pointer lock), which looks
 * around and fires; while the game has the mouse or the focus it takes every key it knows before the
 * shell does. A game saved from the game's menu, and the player's settings, are kept in their home
 * (`savesFolder`), and Load lists the saves next time. Add music uploads the files picked into the
 * chosen game's own music folder, where it plays them for the CD's tracks.
 */
export default function Quake() {
  const phone = usePhone();
  const frame = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const engine = useRef<Engine | null>(null);
  const sound = useRef<Sound | null>(null);
  // The seat's streams, while a game is played on a server.
  const link = useRef<Link | null>(null);
  const log = useRef<string[]>([]);
  const [games, setGames] = useState<Game[] | null>(null);
  const [listError, setListError] = useState<string>();
  const [chosen, setChosen] = useState(() => remembered(CHOSEN_KEY));
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [fullscreen, setFullscreen] = useState(false);
  const [locked, setLocked] = useState(false);
  const [muted, setMuted] = useState(() => remembered(MUTED_KEY) === '1');

  // The game to offer: the one chosen last, else the first, Quake's shareware episode when it is there.
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

  // The offered games being fetched, by name: each is a command that runs as long as its download.
  const [fetching, setFetching] = useState<string[]>([]);
  const fetchOffer = useCallback(async (offer: Offer) => {
    setFetching((names) => [...names, offer.name]);
    try {
      await fetchGame(offer.name);
    } catch (error) {
      notify({ message: `${offer.title} was not fetched: ${error instanceof Error ? error.message : String(error)}`, color: 'red' });
    } finally {
      setFetching((names) => names.filter((name) => name !== offer.name));
      refresh();
    }
  }, [refresh]);

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
    // The player's settings are kept as Quit keeps them, when the game is still there to write them;
    // and a server is told the player has gone, before the streams to it close.
    try {
      engine.current?.writeConfig();
      if (link.current) engine.current?.disconnect();
    } catch {
      // A game that already ended wrote them when it did.
    }
    link.current?.close();
    link.current = null;
    engine.current = null;
    sound.current?.close();
    sound.current = null;
    if (document.pointerLockElement === frame.current) document.exitPointerLock();
  }, []);
  useEffect(() => stop, [stop]);
  // Closing or reloading the tab unmounts nothing, so the player's settings are written as the page
  // goes; the game runs on in a page brought back from the browser's cache.
  useEffect(() => {
    const onHide = () => {
      try {
        engine.current?.writeConfig();
      } catch {
        // A game that already ended wrote them when it did.
      }
    };
    globalThis.addEventListener('pagehide', onHide);
    return () => globalThis.removeEventListener('pagehide', onHide);
  }, []);

  /** Play `game`: on its own, or on a server someone hosts, in the seat `sit` takes there. */
  const play = useCallback(async (game: Game, sit?: () => Promise<Joined>) => {
    stop();
    setChosen(game.name);
    remember(CHOSEN_KEY, game.name);
    log.current = [];
    setState({ kind: 'loading', game, online: !!sit });
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
      const kept = folder ? await loadKept(folder, game.engine) : [];
      const joined = sit ? await sit() : undefined;
      const seat = joined && { ...joined.seat, title: game.title };
      const online = joined && seat ? await openLink(seat, joined.open) : undefined;
      if (sound.current !== audio) {
        online?.close();
        return;
      }
      link.current = online ?? null;
      const started = await startEngine({
        game,
        sound: audio,
        kept,
        ...(folder
          ? { onKeep: keeper(folder, (error) => notify({ message: `The game was not saved: ${error instanceof Error ? error.message : String(error)}`, color: 'red' })) }
          : {}),
        ...(online && seat ? { online: { network: online.network, address: seat.address, name: username ?? seat.seat } } : {}),
        log: (line) => {
          log.current = [...log.current.slice(-(LOG_TAIL - 1)), line];
          console.info(`[${game.engine}] ${line}`);
        },
      });
      // Another game was chosen while this one loaded.
      if (sound.current !== audio) return;
      engine.current = started;
      setState({ kind: 'running', game, seat });
      frame.current?.focus();
      // The server stopped, or the streams to it broke: the game has nobody to play with.
      void online?.ended.then((reason) => {
        if (link.current !== online) return;
        stop();
        setState({ kind: 'error', game, message: `The game on the server ${seat?.server} ended: ${reason}` });
      });
    } catch (error) {
      if (sound.current !== audio) return;
      stop();
      setState({ kind: 'error', game, message: describe(error, log.current) });
    }
  }, [muted, stop]);

  const remove = useCallback(async (game: Game) => {
    if (!globalThis.confirm(`Delete ${game.title} (${game.name})? Everyone who plays here loses it.`)) return;
    if (state.kind !== 'idle' && state.game.name === game.name) {
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

  // The games people host, asked for again every few seconds.
  const servers = usePolledCommand<ServerInfo[]>(SERVERS_COMMAND, true, SERVERS_POLL_MS);
  const [hosting, setHosting] = useState(false);
  const failed = (what: string) => (error: unknown) => notify({ message: `${what}: ${error instanceof Error ? error.message : String(error)}`, color: 'red' });
  const join = useCallback((server: ServerInfo) => {
    const game = games?.find((found) => found.name === server.game);
    if (game) void play(game, async () => ({ seat: await joinServer(server.id) }));
  }, [games, play]);
  // A game on another EiN, which its invitation's link opens, played with the game here that the link names.
  const joinInvited = useCallback((link: string) => {
    const invited = invitedGame(link);
    const game = invited && (games?.find((found) => found.name === invited.game && found.engine === invited.engine) ??
      games?.find((found) => found.engine === invited.engine && found.maps.includes(invited.map)));
    if (!invited) return failed('The invitation was not taken')(new Error('the link does not say which game it is for: it ends in #<engine>:<game>:<map>'));
    if (!game) {
      return failed('The invitation was not taken')(new Error(`there is no ${invited.engine === 'quake2' ? 'Quake II' : 'Quake'} game here with the map ${invited.map}`));
    }
    void play(game, () => acceptInvitation(link, invited));
  }, [games, play]);
  const [invite, setInvite] = useState<Invite>();
  const inviteGuest = useCallback((server: ServerInfo) => {
    inviteToServer(server.id).then(setInvite, failed('Nobody was invited'));
  }, []);
  // The one who hosts a game plays in it, from the click that hosted it.
  const host = useCallback((game: Game, map: string, maxPlayers: number, mode: GameMode) => {
    setHosting(false);
    void play(game, async () => {
      const server = await hostServer(game.name, map, maxPlayers, mode);
      void servers.refetch();
      return { seat: await joinServer(server.id) };
    });
  }, [play, servers.refetch]);
  const stopHosted = useCallback((server: ServerInfo) => {
    if (!globalThis.confirm(`Stop ${server.startedBy}'s game of ${server.title} on ${server.map}? Everyone in it is dropped.`)) return;
    // Whoever stops the game they play in leaves it first, rather than be told it stopped.
    if (state.kind === 'running' && state.seat?.server === server.id) {
      stop();
      setState({ kind: 'idle' });
    }
    stopServer(server.id).catch(failed('The game was not stopped')).finally(() => void servers.refetch());
  }, [state, stop, servers.refetch]);

  useGameLoop(state.kind === 'running' ? engine.current : null, canvas, (error) => {
    // The game has ended: it wrote its settings itself on Quit, and can write nothing after an error.
    engine.current = null;
    stop();
    // Quit from the game's menu leaves the page as it was before Play.
    if (quitted(error)) setState({ kind: 'idle' });
    else if (state.kind === 'running') setState({ kind: 'error', game: state.game, message: describe(error, log.current) });
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

  const list = {
    games,
    servers: servers.data ?? [],
    playingOn: state.kind === 'running' ? state.seat?.server : undefined,
    onJoin: join,
    onJoinInvited: joinInvited,
    onInvite: inviteGuest,
    onHost: () => setHosting(true),
    onStop: stopHosted,
    error: listError,
    active: state.kind === 'loading' || state.kind === 'running' ? state.game.name : selected?.name,
    onPlay: play,
    // Fetching takes curl, which EiN lets only the administrator run.
    canFetch: currentUser.value?.admin === true,
    fetching,
    onFetch: fetchOffer,
  };

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
        eyebrow={shown ? ENGINE_TITLES[shown.engine] : undefined}
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
      <InviteDialog invite={invite} onClose={() => setInvite(undefined)} />
      <HostDialog opened={hosting} games={games ?? []} chosen={selected} onClose={() => setHosting(false)} onHost={host} />
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
          {/* 4:3, as large as fits beside the line under it; the game's frame is 640 by 480 unless a Quake 2 player chose another mode. */}
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
                    <Text c='red.5' fw={600}>{state.game.title} stopped</Text>
                    <Text c='gray.3' size='sm' style={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>{state.message}</Text>
                  </Stack>
                )}
                {state.kind === 'loading'
                  ? (
                    <Stack align='center' gap={6}>
                      <Loader color='orange' />
                      {state.online && <Text c='gray.4' size='sm'>Joining the game…</Text>}
                    </Stack>
                  )
                  : selected
                  ? (
                    <UnstyledButton onClick={() => void play(selected)} data-quake-play style={{ textAlign: 'center' }}>
                      <Stack align='center' gap={6}>
                        <TablerIcon name='player-play' size={56} color='var(--mantine-color-orange-6)' />
                        <Text c='gray.3' fw={600}>{state.kind === 'error' ? 'Play again' : 'Play'} {selected.title}</Text>
                      </Stack>
                    </UnstyledButton>
                  )
                  : (
                    <Text c='gray.4' ta='center' size='sm'>
                      {games ? 'No games yet. Fetch a free one from the list of games, or drop a folder with pak0.pak on the page.' : ''}
                    </Text>
                  )}
              </Stack>
            )}
          </Box>
          {!fullscreen && (
            <Text c='dimmed' size='xs' ta='center' lineClamp={2} maw={960}>
              {state.kind === 'running' && state.seat ? `On ${state.seat.server}, ${state.seat.title} on ${state.seat.map}. ` : ''}
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
  /** The games people host here, and the one played on now, by id. */
  servers: ServerInfo[];
  playingOn?: string;
  onJoin: (server: ServerInfo) => void;
  /** Join a game on another EiN with its invitation's link. */
  onJoinInvited: (link: string) => void;
  onInvite: (server: ServerInfo) => void;
  onHost: () => void;
  onStop: (server: ServerInfo) => void;
  error?: string;
  /** The game playing, loading, or chosen to play next. */
  active?: string;
  onPlay: (game: Game) => void;
  /** The offered games being fetched, by name. */
  fetching: string[];
  onFetch: (offer: Offer) => void;
  /** Whether this person may fetch, which only an administrator may. */
  canFetch: boolean;
};

/**
 * The games, each a row that plays it, and after them the offered games not here yet, each with a
 * button that fetches it. In the pane beside the game (`onDelete`, which gives each game a button
 * that deletes it) a game's row is its title art with its title under it; in the phone's menu, its
 * title alone. `onPick` hears a game chosen.
 */
function GameList(
  { games, servers, playingOn, onJoin, onJoinInvited, onInvite, onHost, onStop, error, active, onPlay, onDelete, onPick, fetching, onFetch, canFetch }: ListProps & {
    onDelete?: (game: Game) => void;
    onPick?: () => void;
  },
) {
  if (error) return <Text size='sm' c='red' p='sm'>{error}</Text>;
  if (!games) return <Loader size='sm' m='sm' />;
  const offers = OFFERS.filter((offer) => !games.some((game) => game.name === offer.name));
  return (
    <Stack gap='md'>
      {games.length === 0
        ? (
          <Text size='sm' c='dimmed' p='sm' pb={0}>
            No games yet. Fetch one of the free ones below, or drop a folder with your own pak0.pak on the page.
          </Text>
        )
        : <Games games={games} active={active} onPlay={onPlay} onDelete={onDelete} onPick={onPick} />}
      {games.length > 0 && (
        <Servers
          games={games}
          servers={servers}
          playingOn={playingOn}
          onJoin={(server) => {
            onPick?.();
            onJoin(server);
          }}
          onJoinInvited={(link) => {
            onPick?.();
            onJoinInvited(link);
          }}
          onInvite={onInvite}
          onHost={() => {
            onPick?.();
            onHost();
          }}
          onStop={onStop}
          inset={!onDelete}
        />
      )}
      {offers.length > 0 && (
        <Stack gap='xs' px={onDelete ? 0 : 'xs'} pb='xs'>
          <Text size='xs' c='dimmed' fw={600} tt='uppercase'>Free to fetch</Text>
          {offers.map((offer) => (
            <Stack key={offer.name} gap={4} data-quake-offer={offer.name}>
              <Text size='sm'>{offer.title}</Text>
              <Text size='xs' c='dimmed'>{offer.about}</Text>
              {canFetch
                ? (
                  <Button
                    size='xs'
                    variant='light'
                    color='orange'
                    leftSection={<TablerIcon name='download' size={14} />}
                    loading={fetching.includes(offer.name)}
                    onClick={() => onFetch(offer)}
                    style={{ alignSelf: 'flex-start' }}
                  >
                    Fetch · {formatBytes(offer.download)}
                  </Button>
                )
                : <Text size='xs' c='dimmed' fs='italic'>An administrator can fetch it.</Text>}
            </Stack>
          ))}
        </Stack>
      )}
    </Stack>
  );
}

/**
 * The games people host here, each with who plays in it and a button that joins it, or stops it
 * for the one who hosted it and an administrator; and a button that hosts one. A game whose folder is
 * not here cannot be joined from here.
 */
function Servers({ games, servers, playingOn, onJoin, onJoinInvited, onInvite, onHost, onStop, inset }:
  & Pick<ListProps, 'servers' | 'playingOn' | 'onJoin' | 'onJoinInvited' | 'onInvite' | 'onHost' | 'onStop'>
  & { games: Game[]; inset: boolean }) {
  const user = currentUser.value;
  const [link, setLink] = useState('');
  return (
    <Stack gap='xs' px={inset ? 'xs' : 0} pb='xs' data-quake-servers>
      <Group justify='space-between' gap='xs' wrap='nowrap'>
        <Text size='xs' c='dimmed' fw={600} tt='uppercase'>Multiplayer</Text>
        <Button size='compact-xs' variant='light' color='orange' leftSection={<TablerIcon name='server' size={14} />} onClick={onHost} disabled={!user} data-quake-host>
          Host
        </Button>
      </Group>
      {servers.length === 0 && <Text size='xs' c='dimmed'>Nobody hosts a game now. Host one, and everyone here can join it.</Text>}
      {servers.map((server) => {
        const here = games.some((game) => game.name === server.game);
        const mine = server.startedBy === user?.username || user?.admin === true;
        return (
          <Stack key={server.id} gap={2} data-quake-server={server.id}>
            <Text size='sm' truncate fw={server.id === playingOn ? 600 : 400}>{server.title} · {server.map}</Text>
            <Text size='xs' c='dimmed' truncate>
              {server.startedBy}'s · {server.mode === 'coop' ? 'cooperative' : 'deathmatch'} · {server.players.length}/{server.maxPlayers} playing
            </Text>
            {server.players.length > 0 && <Text size='xs' c='dimmed' lineClamp={2}>{server.players.map((player) => `${player.name} ${player.frags}`).join(', ')}</Text>}
            {server.state === 'failed' && <Text size='xs' c='red'>{server.error}</Text>}
            <Group gap='xs'>
              {server.state === 'running' && server.id !== playingOn && (
                <Button
                  size='compact-xs'
                  variant='light'
                  disabled={!here || !user}
                  onClick={() => onJoin(server)}
                  data-quake-join={server.id}
                >
                  Join
                </Button>
              )}
              {server.state === 'starting' && <Text size='xs' c='dimmed'>Starting…</Text>}
              {server.state === 'running' && user && <Button size='compact-xs' variant='subtle' onClick={() => onInvite(server)} data-quake-invite={server.id}>Invite</Button>}
              {mine && server.state !== 'failed' && (
                <Button size='compact-xs' variant='subtle' color='red' onClick={() => onStop(server)} data-quake-stop={server.id}>Stop</Button>
              )}
              {!here && <Text size='xs' c='dimmed'>{server.game} is not here to play</Text>}
            </Group>
          </Stack>
        );
      })}
      <Group gap='xs' wrap='nowrap'>
        <TextInput
          size='xs'
          style={{ flex: 1 }}
          placeholder='Invitation link from another EiN'
          value={link}
          onChange={(event) => setLink(event.currentTarget.value)}
          data-quake-invitation
        />
        <Button size='compact-xs' variant='light' disabled={!link.trim()} onClick={() => onJoinInvited(link)} data-quake-join-invited>Join</Button>
      </Group>
    </Stack>
  );
}

/** A guest's invitation, to pass on: the link opens their seat in the game, played with their own EiN's copy of it. */
function InviteDialog({ invite, onClose }: { invite?: Invite; onClose: () => void }) {
  return (
    <Modal opened={!!invite} onClose={onClose} title='Invite someone from another EiN' centered>
      {invite && (
        <Stack gap='sm'>
          <Text size='sm'>
            Send this link to someone on another EiN. On their Quake page they paste it under Multiplayer and join {invite.title} on {invite.map}{' '}
            with their own copy of the game. It lets one guest in, until {formatDateTime(invite.expires)}.
          </Text>
          <Group gap='xs' wrap='nowrap'>
            <TextInput style={{ flex: 1 }} readOnly value={invite.link} onFocus={(event) => event.currentTarget.select()} data-quake-invite-link />
            <CopyButton value={invite.link}>
              {({ copied, copy }) => <Button variant='light' onClick={copy}>{copied ? 'Copied' : 'Copy'}</Button>}
            </CopyButton>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}

/** Host a game: which, on which map, how, and for how many; the game chosen in the list is the first offered. */
function HostDialog({ opened, games, chosen, onClose, onHost }: {
  opened: boolean;
  games: Game[];
  chosen?: Game;
  onClose: () => void;
  onHost: (game: Game, map: string, maxPlayers: number, mode: GameMode) => void;
}) {
  const [name, setName] = useState<string | null>(null);
  const [map, setMap] = useState<string | null>(null);
  const [mode, setMode] = useState<GameMode>('deathmatch');
  const [maxPlayers, setMaxPlayers] = useState<number>(DEFAULT_PLAYERS);
  const game = games.find((found) => found.name === name) ?? chosen ?? games[0];
  useEffect(() => {
    if (opened) setName(chosen?.name ?? games[0]?.name ?? null);
  }, [opened]);
  useEffect(() => setMap(game ? defaultMap(game.maps) ?? null : null), [game?.name]);
  return (
    <Modal opened={opened} onClose={onClose} title='Host a game' centered>
      <Stack gap='sm'>
        <Select label='Game' data={games.map((found) => ({ value: found.name, label: found.title }))} value={game?.name ?? null} onChange={setName} allowDeselect={false} />
        <Select label='Map' data={game?.maps ?? []} value={map} onChange={setMap} searchable allowDeselect={false} />
        <SegmentedControl
          value={mode}
          onChange={(value) => setMode(value as GameMode)}
          data={[{ value: 'deathmatch', label: 'Deathmatch' }, { value: 'coop', label: 'Cooperative' }]}
        />
        <NumberInput label='Players' min={2} max={MAX_PLAYERS} value={maxPlayers} onChange={(value) => setMaxPlayers(Number(value) || DEFAULT_PLAYERS)} />
        <Text size='xs' c='dimmed'>
          EiN runs the game until you stop it or nobody has played for five minutes. Everyone here who has the game can join it from this list.
        </Text>
        <Group justify='flex-end'>
          <Button variant='default' onClick={onClose}>Cancel</Button>
          <Button color='orange' disabled={!game || !map} onClick={() => game && map && onHost(game, map, maxPlayers, mode)} data-quake-host-start>Host and play</Button>
        </Group>
      </Stack>
    </Modal>
  );
}

/** The games' rows: `GameList`'s. */
function Games({ games, active, onPlay, onDelete, onPick }: Pick<ListProps, 'active' | 'onPlay'> & {
  games: Game[];
  onDelete?: (game: Game) => void;
  onPick?: () => void;
}) {
  const detail = (game: Game) => `${game.name} · ${ENGINE_TITLES[game.engine]} · ${formatBytes(game.size)} · ${game.music ? 'music' : 'no music'}`;
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

/** A game's title art at 8:5, the shape of Quake's console background, Quake 2's 4:3 one cut to it, or a dark tile when it has none to show. */
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
        ? <img src={picture} alt='' style={{ width: '100%', height: '100%', objectFit: 'cover', imageRendering: 'pixelated', display: 'block' }} />
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

/** An error and the last lines the game printed, which say why when the game itself gave up. */
function describe(error: unknown, lines: string[]): string {
  // The game ends with exit(1) when it gives up (`Sys_Error`); Emscripten throws its own ExitStatus,
  // not an Error, and the lines before it say why.
  const exit = error as { name?: string; status?: number } | null;
  const message = error instanceof Error ? error.message : exit?.name === 'ExitStatus' ? `The game exited with status ${exit.status}` : String(error);
  return [message, ...lines].join('\n');
}
