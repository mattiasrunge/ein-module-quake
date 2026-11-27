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
// quake3_ein.c -- ioquake3's platform layer for the EiN page, as
// quake2/quake2_ein.c is Quake 2's: no SDL and no loop of its own, and in
// place of sdl_input.c. It runs in a worker of the page's
// (ui/quake/engine-worker.ts), which puts the game's pk3s into Emscripten's
// file system, gives the engine a canvas to draw on (glimp_ein.c), calls
// ein_start once, then ein_tick for each of the page's animation frames, and
// hands the page what was drawn after each. Keys come with ein_key, already
// in Quake 3's key codes, the characters they type with ein_char, and the
// mouse's movement with ein_mouse; Quake 3's menus have a pointer of their
// own, which the mouse moves too. The player's q3config.cfg, and for id's
// whole game their CD key in q3key, are files in the game's folder of the
// home folder: the worker writes them there before ein_start and hears from
// ein_wrote when Quake 3 has written one. Sound is snd_ein.c, the network
// net_ein.c. After each tick the worker asks ein_menu whether the page is to
// give the mouse back, and ein_fullscreen whether to show the frame
// fullscreen, which the game's options set; ein_set_fullscreen tells the
// game the browser left fullscreen itself.

#include <emscripten.h>

#include "client/client.h"
#include "sys/sys_local.h"

int Sys_Main(int argc, char **argv);

// common.c's, which no header declares.
void Com_WriteConfigToFile(const char *filename);

// The file at `path`, the game's folder and a file in it
// (baseq3/q3config.cfg), was written.
EM_JS(void, ein_wrote, (const char *path), {
	if (Module.einWrote) Module.einWrote(UTF8ToString(path));
});

void Sys_Wrote(const char *path)
{
	ein_wrote(path);
}

// The page hands keys and the mouse over as they come (ein_key, ein_mouse),
// so there is nothing to read here.
void IN_Init(void *windowData)
{
}

void IN_Frame(void)
{
}

void IN_Shutdown(void)
{
}

void IN_Restart(void)
{
}

// Start the game on the pk3s in the game's folder. `argc` and `argv` are
// its command line, from the page, which sets the folders and runs the
// player's first commands. It returns once the game is set up; ein_tick
// runs it.
EMSCRIPTEN_KEEPALIVE
void ein_start(int argc, char **argv)
{
	Sys_Main(argc, argv);
}

// Run a frame, when one is due.
EMSCRIPTEN_KEEPALIVE
void ein_tick(void)
{
	Com_Frame();
}

// A key went down (`pressed` 1) or up (0); `key` is a Quake 3 key code.
EMSCRIPTEN_KEEPALIVE
void ein_key(int pressed, int key)
{
	Com_QueueEvent(0, SE_KEY, key, pressed ? qtrue : qfalse, 0, NULL);
}

// A key typed the character `character`, which the console and the menus'
// fields take.
EMSCRIPTEN_KEEPALIVE
void ein_char(int character)
{
	Com_QueueEvent(0, SE_CHAR, character, 0, 0, NULL);
}

// The mouse moved by `dx` and `dy` pixels.
EMSCRIPTEN_KEEPALIVE
void ein_mouse(int dx, int dy)
{
	Com_QueueEvent(0, SE_MOUSE, dx, dy, 0, NULL);
}

// Leave the server the game is connected to, telling it so: the page
// does before it stops a game played on a server, so the server need not
// wait for the player to time out.
EMSCRIPTEN_KEEPALIVE
void ein_disconnect(void)
{
	CL_Disconnect(qfalse);
}

// Write q3config.cfg now, as Quit does, so the player's settings are kept
// when the page stops the game without it.
EMSCRIPTEN_KEEPALIVE
void ein_write_config(void)
{
	Com_WriteConfigToFile(Q3CONFIG_CFG);
}

// Whether the player works the game without the mouse: the console is
// down, or a map is loading. Quake 3's menus have a pointer the mouse
// moves, so they keep it.
EMSCRIPTEN_KEEPALIVE
int ein_menu(void)
{
	return (Key_GetCatcher() & KEYCATCH_CONSOLE) || (clc.state != CA_DISCONNECTED && clc.state != CA_ACTIVE);
}

// Whether the player wants the frame shown fullscreen.
EMSCRIPTEN_KEEPALIVE
int ein_fullscreen(void)
{
	return Cvar_VariableIntegerValue("r_fullscreen") != 0;
}

// Fullscreen on (1) or off (0): what the page does when the browser
// leaves fullscreen without the game, or on F11. The page shows the frame
// as it is, so this needs no video restart, which r_fullscreen otherwise
// waits for.
EMSCRIPTEN_KEEPALIVE
void ein_set_fullscreen(int on)
{
	Cvar_Set2("r_fullscreen", on ? "1" : "0", qtrue);
}
