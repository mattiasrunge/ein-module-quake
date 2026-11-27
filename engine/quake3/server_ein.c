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
// server_ein.c -- the platform layer of Quake 3's dedicated server, which
// EiN runs in a worker of the module's quake-server service, as Quake 2's
// server_ein.c is: no client, no renderer and no sound (null/ stands in
// for them). The worker writes the game's pk3s into Emscripten's in-memory
// file system, calls ein_start once with a command line that sets the
// folders and starts a map, then ein_tick every few milliseconds; the
// players' datagrams come and go through net_ein.c. ein_status answers who
// plays, for the service to write into the server's server.json.

#include <emscripten.h>

#include "server/server.h"

int Sys_Main(int argc, char **argv);

// The server's own configuration, q3config_server.cfg, is the worker's to
// forget: there is no player to keep it for.
void Sys_Wrote(const char *path)
{
}

// Start the server on the pk3s in the game's folder; `argc` and `argv`
// are its command line, from the worker.
EMSCRIPTEN_KEEPALIVE
void ein_start(int argc, char **argv)
{
	Sys_Main(argc, argv);
}

// Run a server frame, when one is due.
EMSCRIPTEN_KEEPALIVE
void ein_tick(void)
{
	Com_Frame();
}

// Appends `text` to `out` as a JSON string, its quotes and backslashes
// escaped, anything below a space and Quake 3's colour codes (^1) left out.
static void json_string(char *out, int size, const char *text)
{
	int length = strlen(out);

	if (length < size - 1)
		out[length++] = '"';
	for (; *text && length < size - 3; text++)
	{
		if (Q_IsColorString(text))
		{
			text++;
			continue;
		}
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
// {"map":"oa_dm1","players":[{"name":…,"frags":…,"ping":…,"address":"10.66.0.2"}]},
// a player's address being the one the network layer gave them. Bots are
// not players: a game only they play is a game nobody plays.
EMSCRIPTEN_KEEPALIVE
const char *ein_status(void)
{
	static char status[8192];
	int i;
	qboolean first = qtrue;
	client_t *cl;
	netadr_t *a;

	strcpy(status, "{\"map\":");
	json_string(status, sizeof(status), Cvar_VariableString("mapname"));
	strcat(status, ",\"players\":[");
	for (i = 0; svs.clients && i < sv_maxclients->integer; i++)
	{
		cl = &svs.clients[i];
		a = &cl->netchan.remoteAddress;
		if (cl->state < CS_CONNECTED || a->type != NA_IP || strlen(status) > sizeof(status) - 256)
			continue;
		strcat(status, first ? "{\"name\":" : ",{\"name\":");
		json_string(status, sizeof(status), cl->name);
		sprintf(status + strlen(status), ",\"frags\":%d,\"ping\":%d,\"address\":\"%d.%d.%d.%d\"}",
			cl->state == CS_ACTIVE ? SV_GameClientNum(i)->persistant[PERS_SCORE] : 0,
			cl->ping, a->ip[0], a->ip[1], a->ip[2], a->ip[3]);
		first = qfalse;
	}
	strcat(status, "]}");
	return status;
}
