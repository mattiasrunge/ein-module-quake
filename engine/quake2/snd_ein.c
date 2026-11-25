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
// snd_ein.c -- the sound card for the EiN page, as Quake's snd_ein.c is.
// Quake 2's own mixer (snd_dma.c, snd_mix.c) paints a ring of 16-bit
// stereo samples ahead of where the card plays; here the page plays it: a
// Web Audio node calls ein_audio_render for what it needs next, which
// hands over the samples from the play position on, clears them behind
// it, and moves the position on. The rate is the page's, set by
// ein_audio_rate before the game starts.

#include <stdint.h>
#include <string.h>

#include <emscripten.h>

#include "client/client.h"
#include "client/snd_loc.h"

// The ring, in frames of two samples: about 0.7 s at 48 kHz, well over
// what Quake 2 mixes ahead (s_mixahead).
#define RING_FRAMES 32768

static int16_t ring[RING_FRAMES * 2];
static int rate = 48000;

// The page's sample rate, which Quake 2 mixes at; before ein_start.
EMSCRIPTEN_KEEPALIVE
void ein_audio_rate(int samplerate)
{
	rate = samplerate;
}

qboolean SNDDMA_Init(void)
{
	memset(ring, 0, sizeof(ring));
	dma.channels = 2;
	dma.samplebits = 16;
	dma.speed = rate;
	dma.samples = RING_FRAMES * 2;
	dma.submission_chunk = 1;
	dma.samplepos = 0;
	dma.buffer = (byte *) ring;
	return true;
}

// Where the page plays, in samples (two to a frame).
int SNDDMA_GetDMAPos(void)
{
	return dma.samplepos;
}

void SNDDMA_Shutdown(void)
{
}

void SNDDMA_BeginPainting(void)
{
}

void SNDDMA_Submit(void)
{
}

// Copy the next `count` frames into `out`, interleaved, and move the
// play position past them. What is copied is cleared, so if Quake 2 falls
// behind the page plays silence rather than the ring's last lap.
EMSCRIPTEN_KEEPALIVE
void ein_audio_render(int16_t *out, int count)
{
	int frame = dma.samplepos / 2;
	int i;

	for (i = 0; i < count; i++)
	{
		out[i * 2] = ring[frame * 2];
		out[i * 2 + 1] = ring[frame * 2 + 1];
		ring[frame * 2] = ring[frame * 2 + 1] = 0;
		frame = (frame + 1) % RING_FRAMES;
	}
	dma.samplepos = frame * 2;
}
