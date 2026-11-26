/*
Copyright (C) 1996-1997 Id Software, Inc.
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
// net_ein.c -- Quake's network for EiN, laid out as id's net_bsd.c lays
// out Unix's: the loopback, for a game on its own, and id's datagram
// driver (net_dgrm.c) over a LAN driver whose UDP is the page's or the
// server's worker's (Module.einNet, lib/net.ts), carried over EiN's
// stream nodes. Nothing here opens a real socket: a socket is the port the
// network layer opened for it, and an address the fake one it gives each
// end, 10.66.x.y. Its functions are id's net_udp.c's.

#include <emscripten.h>

#include "quakedef.h"
#include "net_loop.h"
#include "net_dgrm.h"

net_driver_t net_drivers[MAX_NET_DRIVERS] =
{
	{
	"Loopback",
	false,
	Loop_Init,
	Loop_Listen,
	Loop_SearchForHosts,
	Loop_Connect,
	Loop_CheckNewConnections,
	Loop_GetMessage,
	Loop_SendMessage,
	Loop_SendUnreliableMessage,
	Loop_CanSendMessage,
	Loop_CanSendUnreliableMessage,
	Loop_Close,
	Loop_Shutdown
	}
	,
	{
	"Datagram",
	false,
	Datagram_Init,
	Datagram_Listen,
	Datagram_SearchForHosts,
	Datagram_Connect,
	Datagram_CheckNewConnections,
	Datagram_GetMessage,
	Datagram_SendMessage,
	Datagram_SendUnreliableMessage,
	Datagram_CanSendMessage,
	Datagram_CanSendUnreliableMessage,
	Datagram_Close,
	Datagram_Shutdown
	}
};

int net_numdrivers = 2;

static int EIN_Init (void);
static void EIN_Shutdown (void);
static void EIN_Listen (qboolean state);
static int EIN_OpenSocket (int port);
static int EIN_CloseSocket (int socket);
static int EIN_Connect (int socket, struct qsockaddr *addr);
static int EIN_CheckNewConnections (void);
static int EIN_Read (int socket, byte *buf, int len, struct qsockaddr *addr);
static int EIN_Write (int socket, byte *buf, int len, struct qsockaddr *addr);
static int EIN_Broadcast (int socket, byte *buf, int len);
static char *EIN_AddrToString (struct qsockaddr *addr);
static int EIN_StringToAddr (char *string, struct qsockaddr *addr);
static int EIN_GetSocketAddr (int socket, struct qsockaddr *addr);
static int EIN_GetNameFromAddr (struct qsockaddr *addr, char *name);
static int EIN_GetAddrFromName (char *name, struct qsockaddr *addr);
static int EIN_AddrCompare (struct qsockaddr *addr1, struct qsockaddr *addr2);
static int EIN_GetSocketPort (struct qsockaddr *addr);
static int EIN_SetSocketPort (struct qsockaddr *addr, int port);

net_landriver_t	net_landrivers[MAX_NET_DRIVERS] =
{
	{
	"UDP",
	false,
	0,
	EIN_Init,
	EIN_Shutdown,
	EIN_Listen,
	EIN_OpenSocket,
	EIN_CloseSocket,
	EIN_Connect,
	EIN_CheckNewConnections,
	EIN_Read,
	EIN_Write,
	EIN_Broadcast,
	EIN_AddrToString,
	EIN_StringToAddr,
	EIN_GetSocketAddr,
	EIN_GetNameFromAddr,
	EIN_GetAddrFromName,
	EIN_AddrCompare,
	EIN_GetSocketPort,
	EIN_SetSocketPort
	}
};

int net_numlandrivers = 1;

// Opens the socket at `port`, or at a free one when it is 0; answers its
// port, or -1 when there is no network to open it on.
EM_JS(int, ein_net_open, (int port), {
	return Module.einNet ? Module.einNet.open(port) : -1;
});

EM_JS(void, ein_net_close, (int port), {
	if (Module.einNet) Module.einNet.close(port);
});

// How many datagrams wait for the socket at `port`.
EM_JS(int, ein_net_waiting, (int port), {
	return Module.einNet ? Module.einNet.waiting(port) : 0;
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

// An address as a sockaddr_in lays it out: the port in network order,
// then the four bytes of the address.
#define AF_EIN 2

static void SetAddr (struct qsockaddr *addr, unsigned int ip, int port)
{
	Q_memset(addr, 0, sizeof(*addr));
	addr->sa_family = AF_EIN;
	addr->sa_data[0] = port >> 8;
	addr->sa_data[1] = port;
	addr->sa_data[2] = ip >> 24;
	addr->sa_data[3] = ip >> 16;
	addr->sa_data[4] = ip >> 8;
	addr->sa_data[5] = ip;
}

static unsigned int IpOf (struct qsockaddr *addr)
{
	return ((unsigned int) addr->sa_data[2] << 24) | (addr->sa_data[3] << 16) | (addr->sa_data[4] << 8) | addr->sa_data[5];
}

static int net_acceptsocket = -1;	// socket for fielding new connections
static int net_controlsocket;

// This end's address, which nothing here knows: the server tells a client
// only the port it opened for it, and a client's address is the one the
// server sees it from.
#define MY_ADDRESS 0

static int EIN_Init (void)
{
	struct qsockaddr addr;
	char *colon;

	if (COM_CheckParm ("-noudp"))
		return -1;

	if ((net_controlsocket = EIN_OpenSocket (0)) == -1)
		return -1;

	EIN_GetSocketAddr (net_controlsocket, &addr);
	Q_strcpy(my_tcpip_address, EIN_AddrToString (&addr));
	colon = Q_strrchr (my_tcpip_address, ':');
	if (colon)
		*colon = 0;

	tcpipAvailable = true;
	return net_controlsocket;
}

static void EIN_Shutdown (void)
{
	EIN_Listen (false);
	EIN_CloseSocket (net_controlsocket);
}

static void EIN_Listen (qboolean state)
{
	if (state)
	{
		if (net_acceptsocket == -1)
			net_acceptsocket = EIN_OpenSocket (net_hostport);
		return;
	}
	if (net_acceptsocket == -1)
		return;
	EIN_CloseSocket (net_acceptsocket);
	net_acceptsocket = -1;
}

static int EIN_OpenSocket (int port)
{
	return ein_net_open (port);
}

static int EIN_CloseSocket (int socket)
{
	ein_net_close (socket);
	return 0;
}

static int EIN_Connect (int socket, struct qsockaddr *addr)
{
	return 0;
}

static int EIN_CheckNewConnections (void)
{
	if (net_acceptsocket == -1)
		return -1;
	return ein_net_waiting (net_acceptsocket) > 0 ? net_acceptsocket : -1;
}

static int EIN_Read (int socket, byte *buf, int len, struct qsockaddr *addr)
{
	unsigned int ip;
	int from;
	int length = ein_net_recv (socket, &ip, &from, buf, len);

	if (length < 0)
		return 0;
	SetAddr (addr, ip, from);
	return length;
}

static int EIN_Write (int socket, byte *buf, int len, struct qsockaddr *addr)
{
	ein_net_send (socket, IpOf (addr), EIN_GetSocketPort (addr), buf, len);
	return len;
}

// A broadcast, which the menus' search for games sends, reaches nobody:
// there is no network to broadcast on, only the one server a player
// joined.
static int EIN_Broadcast (int socket, byte *buf, int len)
{
	return len;
}

static char *EIN_AddrToString (struct qsockaddr *addr)
{
	static char buffer[22];
	unsigned int ip = IpOf (addr);

	sprintf(buffer, "%d.%d.%d.%d:%d", (ip >> 24) & 0xff, (ip >> 16) & 0xff, (ip >> 8) & 0xff, ip & 0xff, EIN_GetSocketPort (addr));
	return buffer;
}

// An address as numbers, a.b.c.d with :port or without, which takes
// Quake's own port: the network has no names to look up.
static int EIN_StringToAddr (char *string, struct qsockaddr *addr)
{
	unsigned int ip[4], port = net_hostport;
	int found = sscanf(string, "%u.%u.%u.%u:%u", &ip[0], &ip[1], &ip[2], &ip[3], &port);

	if (found != 4 && found != 5)
		return -1;
	if (ip[0] > 255 || ip[1] > 255 || ip[2] > 255 || ip[3] > 255 || port > 65535)
		return -1;
	SetAddr (addr, (ip[0] << 24) | (ip[1] << 16) | (ip[2] << 8) | ip[3], port);
	return 0;
}

static int EIN_GetSocketAddr (int socket, struct qsockaddr *addr)
{
	SetAddr (addr, MY_ADDRESS, socket);
	return 0;
}

static int EIN_GetNameFromAddr (struct qsockaddr *addr, char *name)
{
	Q_strcpy (name, EIN_AddrToString (addr));
	return 0;
}

static int EIN_GetAddrFromName (char *name, struct qsockaddr *addr)
{
	return EIN_StringToAddr (name, addr);
}

static int EIN_AddrCompare (struct qsockaddr *addr1, struct qsockaddr *addr2)
{
	if (addr1->sa_family != addr2->sa_family)
		return -1;
	if (IpOf (addr1) != IpOf (addr2))
		return -1;
	if (EIN_GetSocketPort (addr1) != EIN_GetSocketPort (addr2))
		return 1;
	return 0;
}

static int EIN_GetSocketPort (struct qsockaddr *addr)
{
	return (addr->sa_data[0] << 8) | addr->sa_data[1];
}

static int EIN_SetSocketPort (struct qsockaddr *addr, int port)
{
	addr->sa_data[0] = port >> 8;
	addr->sa_data[1] = port;
	return 0;
}
