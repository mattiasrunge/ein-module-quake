import { Box, Text } from '@mantine/core';
import { homePath } from '@ein/paths';
import { fileUrl } from '@ein/ui/lib';
import { currentUser } from '@ein/ui/signals';
import type { Kept, Written } from '@games/adapter';
import { useEffect, useSyncExternalStore } from 'react';
import type { EngineName, Game } from '../../lib/api.ts';
import { bindsOf, CONFIG, wheelBinds } from './binds.ts';

/**
 * The keyboard and the mouse a Quake game is played with, drawn with the player's binds on them:
 * the keys they move, jump and run with, and what the mouse's buttons and wheel do. The binds are
 * the game's own, which the player changes in its menu, so the drawing only shows them: they are
 * read from the player's configuration in their saves folder of the game, and again each time the
 * game writes it.
 */

/** The binds of a player who has not played the game yet: the game's default.cfg, with the module's WASD (`engine.ts`, `quake3.ts`). */
const DEFAULTS: Record<EngineName, Record<string, string>> = {
  quake: { W: '+forward', S: '+back', A: '+moveleft', D: '+moveright', SPACE: '+jump', SHIFT: '+speed', MOUSE1: '+attack', MOUSE2: '+forward', MOUSE3: '+mlook' },
  quake2: { W: '+forward', S: '+back', A: '+moveleft', D: '+moveright', SPACE: '+moveup', SHIFT: '+speed', MOUSE1: '+attack', MOUSE2: '+forward', MOUSE3: '+mlook' },
  quake3: { W: '+forward', S: '+back', A: '+moveleft', D: '+moveright', SPACE: '+moveup', SHIFT: '+speed', MOUSE1: '+attack', MOUSE2: '+strafe', MOUSE3: '+zoom' },
};

/** Where each game's menu has its keys, which the player changes them in. */
const MENU: Record<EngineName, string> = { quake: 'Options › Customize controls', quake2: 'Options › Customize controls', quake3: 'Setup › Controls' };

/** What a command does, as the drawing names it; a command not here is named as it is. */
const ACTIONS: Record<string, string> = {
  '+attack': 'Fire',
  '+forward': 'Forward',
  '+back': 'Back',
  '+moveleft': 'Left',
  '+moveright': 'Right',
  '+jump': 'Jump',
  '+moveup': 'Jump',
  '+movedown': 'Crouch',
  '+speed': 'Run',
  '+strafe': 'Strafe',
  '+mlook': 'Look',
  '+klook': 'Key look',
  '+zoom': 'Zoom',
  '+button2': 'Use item',
  '+left': 'Turn left',
  '+right': 'Turn right',
  '+lookup': 'Look up',
  '+lookdown': 'Look down',
  'centerview': 'Center view',
  'impulse 10': 'Next weapon',
  'impulse 12': 'Prev weapon',
  'weapnext': 'Next weapon',
  'weapprev': 'Prev weapon',
};

const actionOf = (command: string): string => ACTIONS[command.toLowerCase()] ?? command;

/** Each game's configuration, by the game's id: its text, `null` when the player has none yet. */
const configs = new Map<string, string | null>();
const loading = new Set<string>();
const listeners = new Set<() => void>();

const setConfig = (id: string, config: string | null) => {
  configs.set(id, config);
  listeners.forEach((listener) => listener());
};

/** Read the player's configuration of `game` from their saves folder of it (the games module's `~/.quake/<game>`), once a page. */
function loadConfig(game: Game) {
  const username = currentUser.value?.username;
  if (!username || configs.has(game.id) || loading.has(game.id)) return;
  loading.add(game.id);
  fetch(fileUrl(`${homePath(username)}/.quake/${game.id}/${CONFIG[game.family]}`))
    .then(async (response) => response.ok ? await response.text() : null, () => null)
    .then((config) => setConfig(game.id, config))
    .finally(() => loading.delete(game.id));
}

/** The game started with the player's files `kept`: its configuration among them, or none. */
export function heardKept(game: Game, kept: Kept[]) {
  const config = kept.find((file) => file.name === CONFIG[game.family]);
  setConfig(game.id, config ? new TextDecoder().decode(config.data) : null);
}

/** The game wrote `written`: its configuration among them, the binds the player changed in its menu. */
export function heardWritten(game: Game, written: Written) {
  const config = written.files.find((file) => file.name === CONFIG[game.family]);
  if (config) setConfig(game.id, new TextDecoder().decode(config.data));
}

/** The player's configuration of `game`, rendering again as the game writes it; undefined while it is read. */
function useConfig(game: Game): string | null | undefined {
  useEffect(() => loadConfig(game), [game]);
  return useSyncExternalStore((listener) => (listeners.add(listener), () => listeners.delete(listener)), () => configs.get(game.id));
}

/** The command of each key the game plays with: the player's configuration's, or the defaults without one, and the wheel as the game is started with it (`wheelBinds`). */
function bindsFor(family: EngineName, config: string | null | undefined): Map<string, string> {
  const binds = config ? bindsOf(config) : new Map(Object.entries(DEFAULTS[family]));
  for (const [key, command] of bindsOf(wheelBinds(family, config ?? undefined).join('\n'))) binds.set(key, command);
  return binds;
}

/** Whether a key's name is the mouse's or a joystick's, not the keyboard's. */
const pointing = (key: string): boolean => /^(MOUSE|MWHEEL|JOY|AUX)/.test(key);

/** How usual a key is for an action, the most usual first: a letter, Space or a modifier before an arrow, an arrow before the rest (Quake's Enter jumps as Space does). */
const usual = (key: string): number => key.length === 1 || /^(SPACE|SHIFT|CTRL|ALT)$/.test(key) ? 0 : key.endsWith('ARROW') ? 1 : 2;

/** The keyboard's keys bound to `commands`, the most usual first: Quake's jump is `+jump`, Quake II's and Quake 3's `+moveup`. */
function keysOf(binds: Map<string, string>, commands: string[]): string[] {
  const keys = [...binds].filter(([key, bound]) => !pointing(key) && commands.includes(bound.toLowerCase())).map(([key]) => key);
  return keys.sort((a, b) => usual(a) - usual(b));
}

/** A key's name short enough for a key cap: `W`, `↑` for UPARROW, `⇧` for SHIFT. */
function keyLabel(key: string): string {
  const named: Record<string, string> = {
    UPARROW: '↑',
    DOWNARROW: '↓',
    LEFTARROW: '←',
    RIGHTARROW: '→',
    SPACE: 'Space',
    SHIFT: '⇧',
    CTRL: 'Ctrl',
    ALT: 'Alt',
    ENTER: '⏎',
    TAB: '⇥',
    BACKSPACE: '⌫',
    ESCAPE: 'Esc',
    SEMICOLON: ';',
    PGUP: 'PgUp',
    PGDN: 'PgDn',
  };
  return named[key] ?? key.replace(/^KP_/, 'N').slice(0, 4);
}

/** A key's name in full, for a tooltip: `W`, `up arrow`, `Shift`. */
function keyName(key: string): string {
  const arrow = /^(UP|DOWN|LEFT|RIGHT)ARROW$/.exec(key);
  if (arrow) return `${arrow[1].toLowerCase()} arrow`;
  return key.length === 1 ? key : key[0] + key.slice(1).toLowerCase();
}

/** A key cap at `x`,`y`, `w` wide: the player's key for the action on it, the action's name under it, dim when no key does it. */
function Cap({ x, y, w, action, keys }: { x: number; y: number; w: number; action: string; keys: string[] }) {
  const label = keys.length ? keyLabel(keys[0]) : '—';
  const size = label.length > 2 ? 9 : 13;
  return (
    <g data-quake-pad-key={action} opacity={keys.length ? 1 : 0.5}>
      <title>{keys.length ? `${action}: ${keys.map(keyName).join(' or ')}` : `${action}: no key`}</title>
      <rect x={x} y={y} width={w} height={24} rx={4} fill='#2b2b30' stroke='#55555e' strokeWidth={1.5} />
      <text
        x={x + w / 2}
        y={y + 12}
        dy='0.36em'
        textAnchor='middle'
        fontSize={size}
        fontWeight={700}
        fill='#fff'
        style={{ fontFamily: 'var(--mantine-font-family-monospace)' }}
      >
        {label}
      </text>
      <Name x={x + w / 2} y={y + 33}>{action}</Name>
    </g>
  );
}

/** An action's name in the drawing. */
function Name({ x, y, anchor = 'middle', children }: { x: number; y: number; anchor?: 'start' | 'middle' | 'end'; children: string }) {
  return (
    <text
      x={x}
      y={y}
      textAnchor={anchor}
      fontSize={8}
      fontWeight={700}
      fill='#c4c4d0'
      style={{ letterSpacing: 0.4, paintOrder: 'stroke', stroke: 'rgba(0,0,0,0.55)', strokeWidth: 2.5 }}
    >
      {children.toUpperCase()}
    </text>
  );
}

/** The mouse at `x`,`y`: what its buttons do on them, and its wheel's two ways and its click under them. */
function Mouse({ x, y, binds }: { x: number; y: number; binds: Map<string, string> }) {
  const w = 86;
  const h = 116;
  const mid = x + w / 2;
  const button = (key: string) => binds.get(key) ? actionOf(binds.get(key)!) : '';
  const wheel = (key: string) => binds.get(key) ? actionOf(binds.get(key)!) : 'nothing';
  const click = button('MOUSE3');
  return (
    <g data-quake-pad-mouse>
      <title>
        {`Left button: ${button('MOUSE1') || 'nothing'}. Right button: ${button('MOUSE2') || 'nothing'}. Wheel up: ${wheel('MWHEELUP')}, down: ${wheel('MWHEELDOWN')}.`}
      </title>
      <rect x={x} y={y} width={w} height={h} rx={40} fill='#1f1f23' stroke='#55555e' strokeWidth={1.5} />
      <path d={`M ${x} ${y + 50} H ${x + w} M ${mid} ${y} V ${y + 50}`} stroke='#55555e' strokeWidth={1.5} />
      <rect x={mid - 5} y={y + 12} width={10} height={24} rx={5} fill='#55555e' />
      <Name x={x + 21} y={y + 32}>{button('MOUSE1')}</Name>
      <Name x={x + w - 21} y={y + 32}>{button('MOUSE2')}</Name>
      <Name x={mid} y={y + 66}>{`▲ ${wheel('MWHEELUP')}`}</Name>
      <Name x={mid} y={y + 79}>{`▼ ${wheel('MWHEELDOWN')}`}</Name>
      {click && <Name x={mid} y={y + 95}>{`● ${click}`}</Name>}
    </g>
  );
}

/**
 * The keys and the mouse `game` is played with, the player's binds on them. An `editable` one, in
 * the Keys dialog, says under it where in the game's menu they are changed.
 */
export function QuakePad({ game, editable }: { game: Game; editable: boolean }) {
  const family = game.family;
  const binds = bindsFor(family, useConfig(game));
  const keys = (...commands: string[]) => keysOf(binds, commands);
  return (
    <Box data-quake-pad style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      <svg viewBox='0 0 320 124' width='100%' style={{ display: 'block', overflow: 'visible', filter: 'drop-shadow(0 4px 10px rgba(0,0,0,0.45))' }}>
        <Cap x={78} y={2} w={34} action='Forward' keys={keys('+forward')} />
        <Cap x={40} y={42} w={34} action='Left' keys={keys('+moveleft')} />
        <Cap x={78} y={42} w={34} action='Back' keys={keys('+back')} />
        <Cap x={116} y={42} w={34} action='Right' keys={keys('+moveright')} />
        <Cap x={0} y={82} w={60} action='Run' keys={keys('+speed')} />
        <Cap x={66} y={82} w={118} action='Jump' keys={keys(family === 'quake' ? '+jump' : '+moveup')} />
        <Mouse x={222} y={4} binds={binds} />
      </svg>
      {editable && (
        <Text size='xs' c='gray.3' ta='center' data-quake-pad-hint>
          The keys are changed in the game, in {MENU[family]}.
        </Text>
      )}
    </Box>
  );
}
