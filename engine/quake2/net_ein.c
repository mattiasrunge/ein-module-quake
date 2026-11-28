/*
Copyright (C) 1997-2001 Id Software, Inc.
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
// net_ein.c -- Yamagi Quake II's network for EiN, in place of
// backends/unix/network.c: the loopback, for a game on its own, and IP
// datagrams handed to the page or the server's worker (Module.einNet,
// lib/net.ts), which carries them over EiN's stream nodes. Nothing here opens a real socket: an address is the fake
// one the network layer gives each end, 10.66.x.y, and a port says which
// of an end's sockets a datagram is for. The server listens on
// PORT_SERVER, a client on PORT_CLIENT; netchan's qport tells clients
// apart as it does behind a NAT.

#include <stdint.h>

#include <emscripten.h>

#include "../src/common/header/common.h"

/*
=============================================================================

LOOPBACK BUFFERS FOR LOCAL PLAYER

=============================================================================
*/

#define	MAX_LOOPBACK	4

typedef struct
{
	byte	data[MAX_MSGLEN];
	int		datalen;
} loopmsg_t;

typedef struct
{
	loopmsg_t	msgs[MAX_LOOPBACK];
	int			get, send;
} loopback_t;

netadr_t	net_local_adr;
loopback_t	loopbacks[2];

static qboolean NET_GetLoopPacket(netsrc_t sock, netadr_t* net_from, sizebuf_t* net_message)
{
	int		i;
	loopback_t* loop;

	loop = &loopbacks[sock];

	if (loop->send - loop->get > MAX_LOOPBACK)
		loop->get = loop->send - MAX_LOOPBACK;

	if (loop->get >= loop->send)
		return false;

	i = loop->get & (MAX_LOOPBACK - 1);
	loop->get++;

	memcpy(net_message->data, loop->msgs[i].data, loop->msgs[i].datalen);
	net_message->cursize = loop->msgs[i].datalen;
	*net_from = net_local_adr;
	return true;
}

static void NET_SendLoopPacket(netsrc_t sock, int length, void* data, netadr_t to)
{
	int		i;
	loopback_t* loop;

	loop = &loopbacks[sock ^ 1];

	i = loop->send & (MAX_LOOPBACK - 1);
	loop->send++;

	memcpy(loop->msgs[i].data, data, length);
	loop->msgs[i].datalen = length;
}

/*
=============================================================================

DATAGRAMS, THROUGH THE PAGE OR THE SERVER'S WORKER

=============================================================================
*/

// Opens the socket at `port`: datagrams for it are kept until read.
EM_JS(void, ein_net_open, (int port), {
	if (Module.einNet) Module.einNet.open(port);
});

// Sends `length` bytes at `data` from the socket at `from` to the address
// `ip` (a.b.c.d as one big-endian number) and its port `to`.
EM_JS(void, ein_net_send, (int from, unsigned int ip, int to, const void *data, int length), {
	if (Module.einNet) Module.einNet.send(from, ip >>> 0, to, HEAPU8.slice(data, data + length));
});

// The next datagram for the socket at `port`: its bytes into `data`, at
// most `max`, and who sent it into `ip` and `from`. Answers its length,
// or -1 when none is waiting; a longer one than `max` is dropped.
EM_JS(int, ein_net_recv, (int port, unsigned int *ip, int *from, void *data, int max), {
	if (!Module.einNet) return -1;
	for (;;) {
		var packet = Module.einNet.recv(port);
		if (!packet) return -1;
		if (packet.data.length > max) continue;
		HEAPU8.set(packet.data, data);
		HEAPU32[ip >> 2] = packet.ip;
		HEAP32[from >> 2] = packet.port;
		return packet.data.length;
	}
});

// Each side's socket: the server's and a client's port.
static int NET_PortOf(netsrc_t sock)
{
	return sock == NS_SERVER ? PORT_SERVER : PORT_CLIENT;
}

static unsigned int NET_IpOf(netadr_t *a)
{
	return ((unsigned int) a->ip[0] << 24) | (a->ip[1] << 16) | (a->ip[2] << 8) | a->ip[3];
}

// -------------

void NET_Init(void)
{
	memset(&net_local_adr, 0, sizeof(netadr_t));
	memset(loopbacks, 0, sizeof(loopbacks));
	ein_net_open(PORT_SERVER);
	ein_net_open(PORT_CLIENT);
}

void NET_Shutdown(void)
{
}

void NET_Config(qboolean multiplayer)
{
}

qboolean NET_GetPacket(netsrc_t sock, netadr_t* net_from, sizebuf_t* net_message)
{
	unsigned int ip;
	int from, length;

	if (NET_GetLoopPacket(sock, net_from, net_message))
		return true;

	length = ein_net_recv(NET_PortOf(sock), &ip, &from, net_message->data, net_message->maxsize);
	if (length < 0)
		return false;

	memset(net_from, 0, sizeof(*net_from));
	net_from->type = NA_IP;
	net_from->ip[0] = ip >> 24;
	net_from->ip[1] = ip >> 16;
	net_from->ip[2] = ip >> 8;
	net_from->ip[3] = ip;
	net_from->port = BigShort(from);
	net_message->cursize = length;
	return true;
}

// A broadcast, which the menus' server search sends, goes to
// 255.255.255.255: the page's network passes it to every server of the
// game, and each answers from an address of its own.
void NET_SendPacket(netsrc_t sock, int length, void* data, netadr_t to)
{
	if (to.type == NA_LOOPBACK)
	{
		NET_SendLoopPacket(sock, length, data, to);
		return;
	}
	if (to.type == NA_BROADCAST)
	{
		ein_net_send(NET_PortOf(sock), 0xffffffff, BigShort(to.port) & 0xffff, data, length);
		return;
	}
	if (to.type == NA_IP)
	{
		ein_net_send(NET_PortOf(sock), NET_IpOf(&to), BigShort(to.port) & 0xffff, data, length);
		return;
	}
}

qboolean NET_CompareAdr(netadr_t a, netadr_t b)
{
	if (a.type != b.type)
		return false;
	if (a.type == NA_LOOPBACK)
		return true;
	return a.ip[0] == b.ip[0] && a.ip[1] == b.ip[1] && a.ip[2] == b.ip[2] && a.ip[3] == b.ip[3] && a.port == b.port;
}

qboolean NET_CompareBaseAdr(netadr_t a, netadr_t b)
{
	if (a.type != b.type)
		return false;

	if (a.type == NA_LOOPBACK)
		return true;

	if (a.type == NA_IP)
	{
		if (a.ip[0] == b.ip[0] && a.ip[1] == b.ip[1] && a.ip[2] == b.ip[2] && a.ip[3] == b.ip[3])
			return true;
	}

	return false;
}

qboolean NET_IsLocalAddress(netadr_t adr)
{
	return adr.type == NA_LOOPBACK;
}

char* NET_AdrToString(netadr_t a)
{
	static	char	s[64];

	if (a.type == NA_LOOPBACK)
		Com_sprintf(s, sizeof(s), "loopback");
	else
		Com_sprintf(s, sizeof(s), "%i.%i.%i.%i:%i", a.ip[0], a.ip[1], a.ip[2], a.ip[3], BigShort(a.port) & 0xffff);

	return s;
}

// "localhost", or an address as numbers, a.b.c.d with :port or without:
// the network has no names to look up.
qboolean NET_StringToAdr(const char* s, netadr_t* a)
{
	unsigned int ip[4], port = 0;
	char rest;
	int found;

	memset(a, 0, sizeof(*a));
	if (!strcmp(s, "localhost"))
	{
		a->type = NA_LOOPBACK;
		return true;
	}

	found = sscanf(s, "%u.%u.%u.%u:%u%c", &ip[0], &ip[1], &ip[2], &ip[3], &port, &rest);
	if (found != 4 && found != 5)
		return false;
	if (ip[0] > 255 || ip[1] > 255 || ip[2] > 255 || ip[3] > 255 || port > 65535)
		return false;
	a->type = NA_IP;
	a->ip[0] = ip[0];
	a->ip[1] = ip[1];
	a->ip[2] = ip[2];
	a->ip[3] = ip[3];
	a->port = BigShort(port);
	return true;
}

void NET_Sleep(int msec)
{
}
