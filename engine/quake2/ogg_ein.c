/*
Copyright (C) 2005 Stuart Dalton
Copyright (C) 2010-2013 Yamagi Burmeister
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
// ogg_ein.c -- Yamagi Quake II's music for the EiN page, in place of
// sound/ogg.c: the page plays the track's file from the game's music
// folder, whatever its format (ui/quake/engine.ts, handed to the
// Emscripten module as `einMusic`), at the music volume of the game's
// options (ogg_volume); the Options menu's music line (ogg_enable) turns
// it off and on. Sound effects kept as Ogg Vorbis are still decoded here
// (OGG_LoadAsWav), as ogg.c does.

#include <emscripten.h>

#include "../src/client/header/client.h"
#include "../src/client/sound/header/local.h"
#include "../src/client/sound/header/vorbis.h"

#define STB_VORBIS_NO_PUSHDATA_API
#include "../src/client/sound/header/stb_vorbis.h"

static cvar_t *ogg_enabled;
static cvar_t *ogg_volume;
static ogg_status_t ogg_status = STOP;
static qboolean ogg_started = false;

// The track playing or paused, to play again when the music is turned
// back on or the client restarts.
static int ogg_track = 0;
static int ogg_saved_track = 0;

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

int
OGG_Status(void)
{
	return ogg_status;
}

// The page knows the game's tracks.
void
OGG_InitTrackList(void)
{
}

// Plays the CD track `track`, a number, looping, as the level's music
// does; 0 stops the music.
void
OGG_PlayTrack(const char *track, qboolean cdtrack, qboolean immediate)
{
	int number;

	if (sound_started == SS_NOT || !ogg_started)
	{
		return;
	}

	number = (int)strtol(track, (char **)NULL, 10);

	if (number <= 0)
	{
		OGG_Stop();
		return;
	}

	ogg_track = number;
	ogg_status = PLAY;
	js_music_play(number, 1);
}

void
OGG_Stop(void)
{
	if (ogg_status == STOP)
	{
		return;
	}

	ogg_status = STOP;
	js_music_stop();
}

static void
OGG_TogglePlayback(void)
{
	if (ogg_status == PLAY)
	{
		ogg_status = PAUSE;
		js_music_pause(1);
	}
	else if (ogg_status == PAUSE)
	{
		ogg_status = PLAY;
		js_music_pause(0);
	}
}

// Each sound frame: the music volume follows the options.
void
OGG_Stream(void)
{
	if (!ogg_started || !ogg_volume->modified)
	{
		return;
	}

	ogg_volume->modified = false;
	js_music_volume(ogg_volume->value < 0 ? 0 : ogg_volume->value > 1 ? 1 : ogg_volume->value);
}

// The 'ogg' command, as ogg.c's: the menus pause the music with it.
static void
OGG_Cmd(void)
{
	if (Cmd_Argc() < 2)
	{
		Com_Printf("ogg play <track> | stop | toggle\n");
		return;
	}

	if (Q_stricmp(Cmd_Argv(1), "play") == 0 && Cmd_Argc() == 3)
	{
		OGG_PlayTrack(Cmd_Argv(2), false, true);
	}
	else if (Q_stricmp(Cmd_Argv(1), "stop") == 0)
	{
		OGG_Stop();
	}
	else if (Q_stricmp(Cmd_Argv(1), "toggle") == 0)
	{
		OGG_TogglePlayback();
	}
	else
	{
		Com_Printf("ogg play <track> | stop | toggle\n");
	}
}

void
OGG_SaveState(void)
{
	ogg_saved_track = (ogg_enabled->value == 1 && ogg_status == PLAY) ? ogg_track : 0;
}

void
OGG_RecoverState(void)
{
	if (ogg_enabled->value == 1 && ogg_saved_track)
	{
		OGG_PlayTrack(va("%d", ogg_saved_track), true, true);
	}
}

void
OGG_Init(void)
{
	Cvar_Get("ogg_pausewithgame", "0", CVAR_ARCHIVE);
	ogg_volume = Cvar_Get("ogg_volume", "0.7", CVAR_ARCHIVE);
	ogg_enabled = Cvar_Get("ogg_enable", "1", CVAR_ARCHIVE);

	if (ogg_enabled->value != 1)
	{
		return;
	}

	Cmd_AddCommand("ogg", OGG_Cmd);

	ogg_status = STOP;
	ogg_volume->modified = true;
	ogg_started = true;
}

void
OGG_Shutdown(void)
{
	if (!ogg_started)
	{
		return;
	}

	OGG_Stop();
	Cmd_RemoveCommand("ogg");
	ogg_started = false;
}

void
OGG_LoadAsWav(char *filename, wavinfo_t *info, void **buffer)
{
	void * temp_buffer = NULL;
	int size = FS_LoadFile(filename, &temp_buffer);
	short *final_buffer = NULL;
	stb_vorbis * ogg2wav_file = NULL;
	int res = 0;

	if (!temp_buffer)
	{
		/* no such file */
		return;
	}

	/* load vorbis file from memory */
	ogg2wav_file = stb_vorbis_open_memory(temp_buffer, size, &res, NULL);
	if (!res && ogg2wav_file->channels > 0)
	{
		int read_samples = 0;

		/* fill in wav structure */
		info->rate = ogg2wav_file->sample_rate;
		info->width = 2;
		info->channels = ogg2wav_file->channels;
		info->loopstart = -1;
		/* return length * channels */
		info->samples = stb_vorbis_stream_length_in_samples(ogg2wav_file) * info->channels;
		info->dataofs = 0;

		/* alloc memory for uncompressed wav */
		final_buffer = Z_Malloc(info->samples * sizeof(short));

		/* load sampleas to buffer */
		read_samples = stb_vorbis_get_samples_short_interleaved(
			ogg2wav_file, info->channels, final_buffer,
			info->samples);

		if (read_samples > 0)
		{
			/* fix sample list size*/
			if ((read_samples * info->channels) != info->samples)
			{
				Com_DPrintf("%s: incorrect size: %d != %d\n",
					filename, info->samples, read_samples * info->channels);

				info->samples = read_samples * info->channels;
			}

			/* copy to final result */
			*buffer = final_buffer;
		}
		else
		{
			/* something is going wrong */
			Z_Free(final_buffer);
			final_buffer = NULL;
		}

	}

	if (ogg2wav_file)
	{
		stb_vorbis_close(ogg2wav_file);
	}

	FS_FreeFile(temp_buffer);
}
