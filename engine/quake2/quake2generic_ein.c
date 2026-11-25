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
// quake2generic_ein.c -- quake2generic's platform layer for the EiN page,
// as quakegeneric_ein.c is Quake's: no SDL, no window and no loop of its
// own. The page writes the game's paks into Emscripten's in-memory file
// system under /baseq2, calls ein_start once, then ein_tick from
// requestAnimationFrame, copies the frame from ein_screen onto its canvas
// whenever ein_frames moves on, and hands over keys with ein_key, already
// in Quake 2's key codes, and the mouse's movement with ein_mouse. The
// frame is the software renderer's, at the size of the video mode the
// player chose (sw_mode), so ein_width and ein_height can change between
// frames. The game's saves and config.cfg are files in /baseq2 too: the
// page writes the player's there before ein_start and hears from ein_wrote
// when Quake 2 has written a save slot or config.cfg. Sound is snd_ein.c,
// the music cd_ein.c.

#include <stdint.h>
#include <stdlib.h>
#include <sys/stat.h>

#include <emscripten.h>

#include "ref_soft/r_local.h"
#include "quake2.h"
#include "quakegeneric.h"

// cl_main.c's, which no header declares.
void CL_WriteConfiguration(void);
void Cbuf_AddText(char *text);

// The frame: the renderer's palette indexes, and the same as 0xAABBGGRR
// words, R first in memory, as a canvas's ImageData has its bytes.
static unsigned char *pixels = NULL;
static uint32_t *screen = NULL;
static uint32_t palette[256];
static int width = 0;
static int height = 0;

// How many frames the game has finished: the page blits when it moves.
static uint32_t frames = 0;

// The mouse's movement since the game last asked.
static int mouse_dx = 0;
static int mouse_dy = 0;

// When the last tick ran, in milliseconds.
static int last_tick = 0;

int SWimp_Init(void *hInstance, void *wndProc)
{
	return true;
}

void SWimp_Shutdown(void)
{
	free(pixels);
	free(screen);
	pixels = NULL;
	screen = NULL;
}

// A new video mode: a frame of its size, which the renderer draws into.
rserr_t SWimp_SetMode(int *pwidth, int *pheight, int mode, qboolean fullscreen)
{
	if (!ri.Vid_GetModeInfo(pwidth, pheight, mode))
		return rserr_invalid_mode;
	SWimp_Shutdown();
	width = *pwidth;
	height = *pheight;
	pixels = calloc(width * height, 1);
	screen = calloc(width * height, sizeof(uint32_t));
	vid.buffer = pixels;
	vid.rowbytes = width;
	ri.Vid_NewWindow(width, height);
	return rserr_ok;
}

// The renderer's palette: four bytes an entry, R, G, B and one unused.
void SWimp_SetPalette(const unsigned char *pal)
{
	int i;

	if (!pal)
		return;
	for (i = 0; i < 256; i++)
		palette[i] = 0xff000000u | (pal[i * 4 + 2] << 16) | (pal[i * 4 + 1] << 8) | pal[i * 4];
}

void SWimp_BeginFrame(float camera_separation)
{
}

void SWimp_EndFrame(void)
{
	int i;

	for (i = 0; i < width * height; i++)
		screen[i] = palette[pixels[i]];
	frames++;
}

void SWimp_AppActivate(qboolean active)
{
}

int QG_Milliseconds(void)
{
	static double start = 0;

	if (!start)
		start = emscripten_get_now();
	return (int) (emscripten_get_now() - start);
}

void QG_GetMouseDiff(int *dx, int *dy)
{
	*dx = mouse_dx;
	*dy = mouse_dy;
	mouse_dx = mouse_dy = 0;
}

// The page has the pointer lock, and gives the game the mouse's movement
// only while it does.
void QG_CaptureMouse(void)
{
}

void QG_ReleaseMouse(void)
{
}

void QG_Mkdir(const char *path)
{
	mkdir(path, 0777);
}

// Quake 2 has written the file or folder at `path` (files.patch calls
// this): config.cfg, or a save slot's folder, for the page to keep.
EM_JS(void, ein_wrote, (const char *path), {
	if (Module.einWrote) Module.einWrote(UTF8ToString(path));
});

// Start the game on the paks in /baseq2. `argc` and `argv` are its command
// line, from the page; `commands` run after default.cfg and config.cfg. It
// returns once the game is set up; ein_tick runs it.
EMSCRIPTEN_KEEPALIVE
void ein_start(int argc, char **argv, const char *commands)
{
	Quake2_Init(argc, argv);
	Cbuf_AddText((char *) commands);
	last_tick = Quake2_Milliseconds();
}

// Run the game for the time since the last tick, and draw a frame. Quake
// 2 counts whole milliseconds, so a tick within the same one waits.
EMSCRIPTEN_KEEPALIVE
void ein_tick(void)
{
	int now = Quake2_Milliseconds();

	if (now - last_tick < 1)
		return;
	Quake2_Frame(now - last_tick);
	last_tick = now;
}

// A key went down (`pressed` 1) or up (0); `key` is a Quake 2 key code.
EMSCRIPTEN_KEEPALIVE
void ein_key(int pressed, int key)
{
	Quake2_SendKey(key, pressed ? true : false);
}

// The mouse moved by `dx` and `dy` pixels.
EMSCRIPTEN_KEEPALIVE
void ein_mouse(int dx, int dy)
{
	mouse_dx += dx;
	mouse_dy += dy;
}

// Write config.cfg now, as Quit does, so the player's settings are kept
// when the page stops the game without it.
EMSCRIPTEN_KEEPALIVE
void ein_write_config(void)
{
	CL_WriteConfiguration();
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
