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
// cd_ein.c -- the CD player for the EiN page, as Quake's cd_ein.c is.
// Quake 2 played its music from the CD's audio tracks; here the page plays
// the track's file from the game's music folder (ui/quake/sound.ts, handed
// to the Emscripten module as `einMusic`). Quake 2's options have no music
// volume, only CD Music on or off (cd_nocd): off stops the track, and on
// again plays the level's.

#include <emscripten.h>

#include "client/client.h"

static cvar_t *cd_nocd;

// The track playing, and whether it loops, to play again when the music
// is turned back on.
static int playing = 0;
static qboolean loops = false;

EM_JS(void, js_music_play, (int track, int looping), {
	if (Module.einMusic) Module.einMusic.play(track, !!looping);
});

EM_JS(void, js_music_stop, (void), {
	if (Module.einMusic) Module.einMusic.stop();
});

EM_JS(void, js_music_pause, (int paused), {
	if (Module.einMusic) Module.einMusic.pause(!!paused);
});

void CDAudio_Play(int track, qboolean looping)
{
	playing = track;
	loops = looping;
	if (cd_nocd->value)
		return;
	js_music_play(track, looping);
}

void CDAudio_Stop(void)
{
	playing = 0;
	js_music_stop();
}

void CDAudio_Activate(qboolean active)
{
	js_music_pause(!active);
}

// Each frame: CD Music turned off stops the track, and on plays it again.
void CDAudio_Update(void)
{
	if (!cd_nocd->modified)
		return;
	cd_nocd->modified = false;
	if (cd_nocd->value)
		js_music_stop();
	else if (playing)
		js_music_play(playing, loops);
}

int CDAudio_Init(void)
{
	cd_nocd = Cvar_Get("cd_nocd", "0", CVAR_ARCHIVE);
	cd_nocd->modified = false;
	return 0;
}

void CDAudio_Shutdown(void)
{
	js_music_stop();
}
