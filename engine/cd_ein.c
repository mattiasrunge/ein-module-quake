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
// cd_ein.c -- the CD player for the EiN page. Quake played its music
// from the CD's audio tracks; here the page plays track<NN>.ogg from the
// game's music folder (ui/quake/sound.ts, handed to the Emscripten module
// as `einMusic`), at the CD Music Volume of Quake's options (bgmvolume).

#include <emscripten.h>

#include "quakedef.h"

static float music_volume = -1;

EM_JS(void, js_music_play, (int track, int looping), {
	if (Module.einMusic) Module.einMusic.play(track, !!looping);
});

EM_JS(void, js_music_stop, (void), {
	if (Module.einMusic) Module.einMusic.stop();
});

EM_JS(void, js_music_pause, (int paused), {
	if (Module.einMusic) Module.einMusic.pause(!!paused);
});

EM_JS(void, js_music_volume, (float level), {
	if (Module.einMusic) Module.einMusic.volume(level);
});

void CDAudio_Play(byte track, qboolean looping)
{
	js_music_play(track, looping);
}

void CDAudio_Stop(void)
{
	js_music_stop();
}

void CDAudio_Pause(void)
{
	js_music_pause(1);
}

void CDAudio_Resume(void)
{
	js_music_pause(0);
}

// Each frame: hand a changed CD Music Volume to the page.
void CDAudio_Update(void)
{
	if (bgmvolume.value != music_volume)
	{
		music_volume = bgmvolume.value;
		js_music_volume(music_volume < 0 ? 0 : music_volume > 1 ? 1 : music_volume);
	}
}

int CDAudio_Init(void)
{
	return 0;
}

void CDAudio_Shutdown(void)
{
	js_music_stop();
}
