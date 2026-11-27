/*
Copyright (C) 2026 The ein-module-quake authors

This program is free software; you can redistribute it and/or
modify it under the terms of the GNU General Public License
as published by the Free Software Foundation; either version 2
of the License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.

See the GNU General Public License for more details.

*/
// quake2_ein.c -- Yamagi Quake II's entry for the EiN page, in place of
// backends/unix/main.c: no SDL, no window and no loop of its own. It runs
// in the module's worker (ui/quake/engine-worker.ts), which puts the
// game's paks into Emscripten's file system under /baseq2, read from EiN
// as the game asks, calls ein_start once, then ein_tick for each of the
// page's animation frames, and hands the page each frame drawn since
// (glimp_ein.c). Keys come with ein_key, already in Yamagi's key codes,
// the characters they type with ein_char, the mouse's movement with
// ein_mouse (input_ein.c). The game's saves and config.cfg are files in
// /baseq2 too: the worker writes the player's there before ein_start and
// hears from ein_wrote when the game has written a save slot or
// config.cfg. Sound is the game's own mixer, which the page plays (the
// patched sound/sdl.c), the music the page's (ogg_ein.c). After each tick
// the worker asks ein_menu whether the page is to give the mouse back, and
// ein_fullscreen whether to show the frame fullscreen, which the Video
// menu sets; ein_set_fullscreen tells the game the browser left
// fullscreen itself.

#include <string.h>

#include <emscripten.h>

#include "../src/client/header/client.h"
#include "../src/client/header/keyboard.h"

// frame.c's (main.patch) and cl_main.c's, which no header declares.
void Qcommon_Tick(void);
void CL_WriteConfiguration(void);

// Quake 2 has written the file or folder at `path` (files.patch calls
// this): config.cfg, or a save slot's folder, for the page to keep.
EM_JS(void, ein_wrote, (const char *path), {
	if (Module.einWrote) Module.einWrote(UTF8ToString(path));
});

// Start the game on the paks in /baseq2, which is where it writes too: the
// file system's root is its data directory, and nothing is kept elsewhere
// (portable). `argc` and `argv` are its command line, from the page;
// `commands` run once it has started, after default.cfg and config.cfg. It
// returns once the game is set up; ein_tick runs it.
EMSCRIPTEN_KEEPALIVE
void ein_start(int argc, char **argv, const char *commands)
{
	is_portable = true;
	Q_strlcpy(datadir, "/", sizeof(datadir));
	Qcommon_Init(argc, argv);
	// Not kept in config.cfg: a browser goes fullscreen only on a key or a
	// click, so a game starts in the page.
	Cvar_FullSet("vid_fullscreen", "0", 0);
	Cbuf_AddText((char *)commands);
}

// Run the game for the time since the last tick, and draw a frame when one
// is due.
EMSCRIPTEN_KEEPALIVE
void ein_tick(void)
{
	Qcommon_Tick();
}

// A key went down (`pressed` 1) or up (0); `key` is a Yamagi key code. The
// console's key, the one left of 1, comes as '`' and opens the console
// whatever the layout makes of it, as the game's own input does. The
// characters a key types come with ein_char.
EMSCRIPTEN_KEEPALIVE
void ein_key(int pressed, int key)
{
	if (key == '`')
	{
		Key_Event(K_CONSOLE, pressed != 0, true);
		return;
	}

	Key_Event(key, pressed != 0, key < K_SPACE || key >= K_BACKSPACE);
}

// A character typed, for the console and the menus' fields.
EMSCRIPTEN_KEEPALIVE
void ein_char(int character)
{
	if (character >= ' ' && character <= '~' && character != '`')
	{
		Char_Event(character);
	}
}

// Leave the server the game is connected to, telling it so: the page does
// before it stops a game played on a server, so the server need not wait
// for the player to time out.
EMSCRIPTEN_KEEPALIVE
void ein_disconnect(void)
{
	CL_Disconnect();
}

// Write config.cfg now, as Quit does, so the player's settings are kept
// when the page stops the game without it.
EMSCRIPTEN_KEEPALIVE
void ein_write_config(void)
{
	CL_WriteConfiguration();
}

// Whether a menu or the console is up, which the player works without the
// mouse: the page gives it back while one is.
EMSCRIPTEN_KEEPALIVE
int ein_menu(void)
{
	return cls.key_dest == key_menu || cls.key_dest == key_console;
}

// Whether the player wants the frame shown fullscreen (the Video menu).
EMSCRIPTEN_KEEPALIVE
int ein_fullscreen(void)
{
	return vid_fullscreen && vid_fullscreen->value != 0;
}

// Fullscreen on (1) or off (0): what the page does when the browser leaves
// fullscreen without the game, or on F11.
EMSCRIPTEN_KEEPALIVE
void ein_set_fullscreen(int on)
{
	Cvar_SetValue("vid_fullscreen", on ? 1 : 0);
}
