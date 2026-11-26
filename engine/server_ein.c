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
// server_ein.c -- the platform layer of Quake's dedicated server, which EiN
// runs in a worker of the module's quake-server service, in place of
// quakegeneric_ein.c: no frame, keys or mouse, and quakegeneric's null
// sound and CD in place of the page's. The worker writes the game's paks
// into Emscripten's in-memory file system under /id1, calls ein_start once
// with a command line that has -dedicated and starts a map, then ein_tick
// every few milliseconds; the players' datagrams come and go through
// net_ein.c. ein_status answers who plays, for the service to write into
// the server's server.json.

#include <stdlib.h>

#include <emscripten.h>

#include "quakedef.h"
#include "quakegeneric.h"

// The megabytes Quake's own allocator gets: a server loads no pictures or
// sounds, only the map and the models it precaches.
#define HEAP 48

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
}

void QG_DrawFrame(void *pixels)
{
}

int QG_GetKey(int *down, int *key)
{
	return 0;
}

void QG_GetMouseMove(int *x, int *y)
{
	*x = *y = 0;
}

void QG_GetJoyAxes(float *axes)
{
}

// Saving a game or writing config.cfg tells the page (files.patch), which a
// server has none of.
void ein_wrote(const char *path)
{
}

// Start the server on the paks in /id1; `argc` and `argv` are its command
// line, from the worker.
EMSCRIPTEN_KEEPALIVE
void ein_start(int argc, char **argv)
{
	static quakeparms_t parms;

	parms.memsize = HEAP * 1024 * 1024;
	parms.membase = malloc(parms.memsize);
	parms.basedir = ".";

	COM_InitArgv(argc, argv);
	parms.argc = com_argc;
	parms.argv = com_argv;

	isDedicated = true;
	Host_Init(&parms);
	last_tick = emscripten_get_now() / 1000.0;
}

// Run the server for the time since the last tick.
EMSCRIPTEN_KEEPALIVE
void ein_tick(void)
{
	double now = emscripten_get_now() / 1000.0;

	Host_Frame(now - last_tick);
	last_tick = now;
}

// Appends `text` to `out` as a JSON string, its quotes and backslashes
// escaped and anything below a space left out (Quake's coloured letters
// above 127 lose their colour).
static void json_string(char *out, int size, const char *text)
{
	int length = strlen(out);

	if (length < size - 1)
		out[length++] = '"';
	for (; *text && length < size - 3; text++)
	{
		unsigned char c = *text & 0x7f;

		if (c < ' ')
			continue;
		if (c == '"' || c == '\\')
			out[length++] = '\\';
		out[length++] = c;
	}
	out[length++] = '"';
	out[length] = 0;
}

// What the server is playing and who is in it, as JSON, as Quake 2's
// server_ein.c answers it: {"map":"e1m1","players":[{"name":…,"frags":…,
// "ping":…,"address":"10.66.0.2"}]}, a player's address being the one the
// network layer gave them.
EMSCRIPTEN_KEEPALIVE
const char *ein_status(void)
{
	static char status[8192];
	int i, j;
	float ping;
	qboolean first = true;
	client_t *cl;
	unsigned char *a;

	strcpy(status, "{\"map\":");
	json_string(status, sizeof(status), sv.name);
	strcat(status, ",\"players\":[");
	for (i = 0; svs.clients && i < svs.maxclients; i++)
	{
		cl = &svs.clients[i];
		if (!cl->active || !cl->netconnection || strlen(status) > sizeof(status) - 256)
			continue;
		ping = 0;
		for (j = 0; j < NUM_PING_TIMES; j++)
			ping += cl->ping_times[j];
		a = cl->netconnection->addr.sa_data;
		strcat(status, first ? "{\"name\":" : ",{\"name\":");
		json_string(status, sizeof(status), cl->name);
		sprintf(status + strlen(status), ",\"frags\":%d,\"ping\":%d,\"address\":\"%d.%d.%d.%d\"}",
			cl->edict ? (int) cl->edict->v.frags : 0, (int) (ping / NUM_PING_TIMES * 1000), a[2], a[3], a[4], a[5]);
		first = false;
	}
	strcat(status, "]}");
	return status;
}
