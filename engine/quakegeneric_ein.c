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
// quakegeneric_ein.c -- quakegeneric's platform layer for the EiN page:
// no SDL, no window and no loop of its own. It runs in the module's worker
// (ui/quake/engine-worker.ts), which drives the game: it puts the game's
// paks into Emscripten's file system under /id1, read from EiN as the game
// asks, calls ein_start once, then ein_tick for each of the page's animation
// frames, hands the page the frame from ein_screen whenever ein_frames
// moves on, and hands over keys with ein_key, already in Quake's key codes,
// and the mouse's movement with ein_mouse. The frame is the size of
// the mode the player chose (vid_null.c), so ein_width and ein_height can
// change between frames. The game's saves and config.cfg are files in /id1
// too: the worker writes the player's there before ein_start and hears from
// ein_wrote when Quake has written one. Sound is snd_ein.c, the music
// cd_ein.c, which the page plays. After each tick the worker asks
// ein_menu whether to give the mouse back, and ein_fullscreen whether to
// show the frame fullscreen, which Video Options sets; ein_set_fullscreen
// tells the game the browser left fullscreen itself.

#include <stdint.h>
#include <stdlib.h>

#include <emscripten.h>

#include "quakedef.h"
#include "quakegeneric.h"

// host.c's, which quakedef.h does not declare.
void Host_WriteConfiguration(void);

// vid_null.c's: whether the frame is shown fullscreen.
extern cvar_t vid_fullscreen;

// Keys the page handed over that the game has not read yet. A frame
// reads them all, so this only needs to hold one frame's worth.
#define KEY_QUEUE_SIZE 64

static uint16_t key_queue[KEY_QUEUE_SIZE];
static unsigned int key_write = 0;
static unsigned int key_read = 0;

// The mouse's movement since the game last asked.
static int mouse_dx = 0;
static int mouse_dy = 0;

// The frame as 0xAABBGGRR words, R first in memory, as a canvas's
// ImageData has its bytes, and its size.
static uint32_t *screen = NULL;
static uint32_t palette[256];
static int width = 0;
static int height = 0;

// How many frames the game has finished: the page blits when it moves.
static uint32_t frames = 0;

// When the last tick ran, in seconds.
static double last_tick = 0;

void QG_Init(void)
{
}

void QG_Quit(void)
{
}

void QG_SetPalette(unsigned char pal[768])
{
	int i;

	for (i = 0; i < 256; i++)
		palette[i] = 0xff000000u | (pal[i * 3 + 2] << 16) | (pal[i * 3 + 1] << 8) | pal[i * 3];
}

// The renderer's frame, at vid's size: the mode's.
void QG_DrawFrame(void *pixels)
{
	const unsigned char *indexes = pixels;
	int i;

	if (vid.width != width || vid.height != height)
	{
		width = vid.width;
		height = vid.height;
		free(screen);
		screen = malloc(width * height * sizeof(uint32_t));
	}
	for (i = 0; i < width * height; i++)
		screen[i] = palette[indexes[i]];
	frames++;
}

int QG_GetKey(int *down, int *key)
{
	uint16_t data;

	if (key_read == key_write)
		return 0;
	data = key_queue[key_read];
	key_read = (key_read + 1) % KEY_QUEUE_SIZE;
	*down = data >> 8;
	*key = data & 0xff;
	return 1;
}

void QG_GetMouseMove(int *x, int *y)
{
	*x = mouse_dx;
	*y = mouse_dy;
	mouse_dx = mouse_dy = 0;
}

void QG_GetJoyAxes(float *axes)
{
}

// Quake has written the file at `path` (files.patch calls this): a
// saved game or config.cfg, for the page to keep.
EM_JS(void, ein_wrote, (const char *path), {
	if (Module.einWrote) Module.einWrote(UTF8ToString(path));
});

// Start the game on the paks in /id1. `argc` and `argv` are its command
// line, from the page; `heap` is the megabytes Quake's own allocator gets;
// `commands` run after quake.rc and config.cfg, which a command line's
// +commands cannot do for a command that itself starts with +, such as
// +mlook. It returns once the game is set up; ein_tick runs it.
EMSCRIPTEN_KEEPALIVE
void ein_start(int argc, char **argv, int heap, const char *commands)
{
	static quakeparms_t parms;

	parms.memsize = heap * 1024 * 1024;
	parms.membase = malloc(parms.memsize);
	parms.basedir = ".";

	COM_InitArgv(argc, argv);
	parms.argc = com_argc;
	parms.argv = com_argv;

	Host_Init(&parms);
	Cbuf_AddText((char *) commands);
	last_tick = emscripten_get_now() / 1000.0;
}

// Run the game for the time since the last tick, and draw a frame.
EMSCRIPTEN_KEEPALIVE
void ein_tick(void)
{
	double now = emscripten_get_now() / 1000.0;

	Host_Frame(now - last_tick);
	last_tick = now;
}

// A key went down (`pressed` 1) or up (0); `key` is a Quake key code. A
// full queue drops the key rather than overwrite one not yet read.
EMSCRIPTEN_KEEPALIVE
void ein_key(int pressed, int key)
{
	unsigned int next = (key_write + 1) % KEY_QUEUE_SIZE;

	if (next == key_read)
		return;
	key_queue[key_write] = (uint16_t) (((pressed ? 1 : 0) << 8) | (key & 0xff));
	key_write = next;
}

// The mouse moved by `dx` and `dy` pixels.
EMSCRIPTEN_KEEPALIVE
void ein_mouse(int dx, int dy)
{
	mouse_dx += dx;
	mouse_dy += dy;
}

// Leave the server the game is connected to, telling it so: the page
// does before it stops a game played on a server, so the server need not
// wait for the player to time out.
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
	Host_WriteConfiguration();
}

// Whether a menu or the console is up, which the player works without
// the mouse.
EMSCRIPTEN_KEEPALIVE
int ein_menu(void)
{
	return key_dest == key_menu || key_dest == key_console;
}

// Whether the player wants the frame shown fullscreen.
EMSCRIPTEN_KEEPALIVE
int ein_fullscreen(void)
{
	return vid_fullscreen.value != 0;
}

// Fullscreen on (1) or off (0): what the page does when the browser
// leaves fullscreen without the game, or on F11.
EMSCRIPTEN_KEEPALIVE
void ein_set_fullscreen(int on)
{
	Cvar_SetValue("vid_fullscreen", on ? 1 : 0);
}

EMSCRIPTEN_KEEPALIVE
uint32_t *ein_screen(void)
{
	return screen;
}

EMSCRIPTEN_KEEPALIVE
int ein_width(void)
{
	return width;
}

EMSCRIPTEN_KEEPALIVE
int ein_height(void)
{
	return height;
}

EMSCRIPTEN_KEEPALIVE
uint32_t ein_frames(void)
{
	return frames;
}
