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
// server_ein.c -- the platform layer of Yamagi Quake II's dedicated server
// (its DEDICATED_ONLY build, in place of backends/unix/main.c), which EiN
// runs in a worker of the module's quake-server service: no client, no
// renderer and no sound. The worker writes the game's paks into
// Emscripten's in-memory file system under /baseq2, calls ein_start once
// with a command line that starts a map, then ein_tick every few
// milliseconds; the players' datagrams come and go through net_ein.c.
// ein_status answers who plays, for the service to write into the
// server's server.json.

#include <stdint.h>
#include <stdlib.h>

#include <emscripten.h>

#include "../src/server/header/server.h"

// frame.c's (main.patch).
void Qcommon_Tick(void);

// A save was written (files.patch tells the page then): the page's
// business, which a server has no page for.
void ein_wrote(const char *path)
{
}

// Start the server on the paks in /baseq2, which is where it writes too
// (portable); `argc` and `argv` are its command line, from the worker.
EMSCRIPTEN_KEEPALIVE
void ein_start(int argc, char **argv)
{
	is_portable = true;
	Q_strlcpy(datadir, "/", sizeof(datadir));
	Qcommon_Init(argc, argv);
}

// Run the server for the time since the last tick; its frame runs when
// it is due.
EMSCRIPTEN_KEEPALIVE
void ein_tick(void)
{
	Qcommon_Tick();
}

// Appends `text` to `out` as a JSON string, its quotes and backslashes
// escaped and anything below a space left out.
static void json_string(char *out, int size, const char *text)
{
	int length = strlen(out);

	if (length < size - 1)
		out[length++] = '"';
	for (; *text && length < size - 3; text++)
	{
		if ((unsigned char) *text < ' ')
			continue;
		if (*text == '"' || *text == '\\')
			out[length++] = '\\';
		out[length++] = *text;
	}
	out[length++] = '"';
	out[length] = 0;
}

// What the server is playing and who is in it, as JSON:
// {"map":"q2dm1","players":[{"name":…,"frags":…,"ping":…,"address":"10.66.0.2"}]},
// a player's address being the one the network layer gave them; the
// player in a client's slot is the edict after the world's.
EMSCRIPTEN_KEEPALIVE
const char *ein_status(void)
{
	static char status[8192];
	int i;
	qboolean first = true;
	client_t *cl;
	netadr_t *a;

	strcpy(status, "{\"map\":");
	json_string(status, sizeof(status), sv.name);
	strcat(status, ",\"players\":[");
	for (i = 0; svs.clients && i < maxclients->value; i++)
	{
		cl = &svs.clients[i];
		if (cl->state < cs_connected || strlen(status) > sizeof(status) - 256)
			continue;
		a = &cl->netchan.remote_address;
		strcat(status, first ? "{\"name\":" : ",{\"name\":");
		json_string(status, sizeof(status), cl->name);
		sprintf(status + strlen(status), ",\"frags\":%d,\"ping\":%d,\"address\":\"%d.%d.%d.%d\"}",
			cl->state == cs_spawned && EDICT_NUM(i + 1)->client ? EDICT_NUM(i + 1)->client->ps.stats[STAT_FRAGS] : 0,
			cl->ping, a->ip[0], a->ip[1], a->ip[2], a->ip[3]);
		first = false;
	}
	strcat(status, "]}");
	return status;
}
