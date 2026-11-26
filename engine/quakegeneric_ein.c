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
// no SDL, no window and no loop of its own. The page drives the game: it
// writes the game's paks into Emscripten's in-memory file system under
// /id1, calls ein_start once, then ein_tick from requestAnimationFrame,
// copies the frame from ein_screen onto its canvas whenever ein_frames
// moves on, and hands over keys with ein_key, already in Quake's key
// codes, and the mouse's movement with ein_mouse. The game's saves and
// config.cfg are files in /id1 too: the page writes the player's there
// before ein_start and hears from ein_wrote when Quake has written one.
// Sound is snd_ein.c, the music cd_ein.c.

#include <stdint.h>
#include <stdlib.h>

#include <emscripten.h>

#include "quakedef.h"
#include "quakegeneric.h"

// host.c's, which quakedef.h does not declare.
void Host_WriteConfiguration(void);

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
// ImageData has its bytes.
static uint32_t screen[QUAKEGENERIC_RES_X * QUAKEGENERIC_RES_Y];
static uint32_t palette[256];

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

void QG_DrawFrame(void *pixels)
{
	const unsigned char *indexes = pixels;
	int i;

	for (i = 0; i < QUAKEGENERIC_RES_X * QUAKEGENERIC_RES_Y; i++)
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

EMSCRIPTEN_KEEPALIVE
uint32_t *ein_screen(void)
{
	return screen;
}

EMSCRIPTEN_KEEPALIVE
int ein_width(void)
{
	return QUAKEGENERIC_RES_X;
}

EMSCRIPTEN_KEEPALIVE
int ein_height(void)
{
	return QUAKEGENERIC_RES_Y;
}

EMSCRIPTEN_KEEPALIVE
uint32_t ein_frames(void)
{
	return frames;
}
