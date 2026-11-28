/*
Copyright (C) 1999-2005 Id Software, Inc.
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
// net_ein.c -- Quake 3's network for EiN, in place of net_ip.c, as Quake
// 2's net_ein.c is: IP datagrams handed to the page or the server's worker
// (Module.einNet, the games module's lib/net.ts), which carries them over
// EiN's socket nodes. A game on its own talks to its own server through
// net_chan.c's loopback, not through here. Nothing here opens a real
// socket: an address is the fake one the network layer gives each end,
// 10.66.x.y, and a port says which of an end's sockets a datagram is for.
// Quake 3 has one socket, the server's and the client's alike, at net_port
// (PORT_SERVER unless set); netchan's qport tells clients apart as it does
// behind a NAT. There are no names to look up and no LAN to broadcast on.

#include <emscripten.h>

#include "qcommon/q_shared.h"
#include "qcommon/qcommon.h"

static cvar_t *net_enabled;
static cvar_t *net_port;
static cvar_t *net_dropsim;

// The socket's port, once NET_Init opened it.
static int port = 0;

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

static unsigned int NET_IpOf(const netadr_t *a)
{
	return ((unsigned int) a->ip[0] << 24) | (a->ip[1] << 16) | (a->ip[2] << 8) | a->ip[3];
}

/*
=============
Sys_StringToAdr

An address as numbers, a.b.c.d: net_chan.c's NET_StringToAdr has taken
"localhost" and the port off already.
=============
*/
qboolean Sys_StringToAdr( const char *s, netadr_t *a, netadrtype_t family ) {
	unsigned int ip[4];
	char rest;

	if ( family == NA_IP6 )
		return qfalse;
	if ( sscanf( s, "%u.%u.%u.%u%c", &ip[0], &ip[1], &ip[2], &ip[3], &rest ) != 4 )
		return qfalse;
	if ( ip[0] > 255 || ip[1] > 255 || ip[2] > 255 || ip[3] > 255 )
		return qfalse;
	memset( a, 0, sizeof( *a ) );
	a->type = NA_IP;
	a->ip[0] = ip[0];
	a->ip[1] = ip[1];
	a->ip[2] = ip[2];
	a->ip[3] = ip[3];
	return qtrue;
}

/*
===================
NET_CompareBaseAdrMask

Compare without port, and up to the bit number given in netmask.
===================
*/
qboolean NET_CompareBaseAdrMask( netadr_t a, netadr_t b, int netmask )
{
	byte cmpmask;
	int curbyte;

	if ( a.type != b.type )
		return qfalse;

	if ( a.type == NA_LOOPBACK )
		return qtrue;

	if ( a.type != NA_IP )
	{
		Com_Printf( "NET_CompareBaseAdr: bad address type\n" );
		return qfalse;
	}

	if ( netmask < 0 || netmask > 32 )
		netmask = 32;

	curbyte = netmask >> 3;

	if ( curbyte && memcmp( a.ip, b.ip, curbyte ) )
		return qfalse;

	netmask &= 0x07;
	if ( netmask )
	{
		cmpmask = (1 << netmask) - 1;
		cmpmask <<= 8 - netmask;

		return ( a.ip[curbyte] & cmpmask ) == ( b.ip[curbyte] & cmpmask );
	}
	return qtrue;
}

/*
===================
NET_CompareBaseAdr

Compares without the port
===================
*/
qboolean NET_CompareBaseAdr( netadr_t a, netadr_t b )
{
	return NET_CompareBaseAdrMask( a, b, -1 );
}

const char *NET_AdrToString( netadr_t a )
{
	static char s[NET_ADDRSTRMAXLEN];

	if ( a.type == NA_LOOPBACK )
		Com_sprintf( s, sizeof( s ), "loopback" );
	else if ( a.type == NA_BOT )
		Com_sprintf( s, sizeof( s ), "bot" );
	else if ( a.type == NA_IP )
		Com_sprintf( s, sizeof( s ), "%d.%d.%d.%d", a.ip[0], a.ip[1], a.ip[2], a.ip[3] );
	else
		s[0] = 0;

	return s;
}

const char *NET_AdrToStringwPort( netadr_t a )
{
	static char s[NET_ADDRSTRMAXLEN];

	if ( a.type == NA_IP )
		Com_sprintf( s, sizeof( s ), "%s:%hu", NET_AdrToString( a ), BigShort( a.port ) );
	else
		Q_strncpyz( s, NET_AdrToString( a ), sizeof( s ) );

	return s;
}

qboolean NET_CompareAdr( netadr_t a, netadr_t b )
{
	if ( !NET_CompareBaseAdr( a, b ) )
		return qfalse;

	return a.type != NA_IP || a.port == b.port;
}

qboolean NET_IsLocalAddress( netadr_t adr ) {
	return adr.type == NA_LOOPBACK;
}

/*
==================
Sys_SendPacket

A broadcast, which the server browser's search for local servers sends,
goes to 255.255.255.255: the page's network passes it to every server of
the game, and each answers from an address of its own.
==================
*/
void Sys_SendPacket( int length, const void *data, netadr_t to ) {
	if ( !port )
		return;
	if ( to.type == NA_BROADCAST )
		ein_net_send( port, 0xffffffff, BigShort( to.port ) & 0xffff, data, length );
	else if ( to.type == NA_IP )
		ein_net_send( port, NET_IpOf( &to ), BigShort( to.port ) & 0xffff, data, length );
}

/*
==================
Sys_IsLANAddress

LAN clients will have their rate var ignored: every address here is one
the network layer gave, 10.66.x.y.
==================
*/
qboolean Sys_IsLANAddress( netadr_t adr ) {
	return adr.type == NA_LOOPBACK || adr.type == NA_IP;
}

void Sys_ShowIP( void ) {
	Com_Printf( "IP: given by EiN\n" );
}

void NET_JoinMulticast6( void ) {
}

void NET_LeaveMulticast6( void ) {
}

/*
====================
NET_Config
====================
*/
void NET_Config( qboolean enableNetworking ) {
	if ( enableNetworking && !port )
	{
		port = net_port->integer;
		ein_net_open( port );
	}
}

/*
====================
NET_Init
====================
*/
void NET_Init( void ) {
	net_enabled = Cvar_Get( "net_enabled", "1", CVAR_LATCH | CVAR_ARCHIVE );
	net_port = Cvar_Get( "net_port", va( "%i", PORT_SERVER ), CVAR_LATCH );
	net_dropsim = Cvar_Get( "net_dropsim", "", CVAR_TEMP );
	NET_Config( qtrue );
	Cmd_AddCommand( "net_restart", NET_Restart_f );
}

void NET_Shutdown( void ) {
}

/*
====================
NET_Sleep

Handle the datagrams waiting, without waiting for more: the page or the
server's worker calls again soon.
====================
*/
void NET_Sleep( int msec ) {
	byte bufData[MAX_MSGLEN + 1];
	netadr_t from;
	msg_t netmsg;
	unsigned int ip;
	int sender, length;

	if ( !port )
		return;

	for ( ;; )
	{
		MSG_Init( &netmsg, bufData, sizeof( bufData ) );
		length = ein_net_recv( port, &ip, &sender, netmsg.data, netmsg.maxsize );
		if ( length < 0 )
			return;

		// net_dropsim percent of incoming datagrams are dropped.
		if ( net_dropsim->value > 0.0f && net_dropsim->value <= 100.0f &&
			rand() < (int) ( ( (double) RAND_MAX ) / 100.0 * (double) net_dropsim->value ) )
			continue;

		memset( &from, 0, sizeof( from ) );
		from.type = NA_IP;
		from.ip[0] = ip >> 24;
		from.ip[1] = ip >> 16;
		from.ip[2] = ip >> 8;
		from.ip[3] = ip;
		from.port = BigShort( sender );
		netmsg.readcount = 0;
		netmsg.cursize = length;

		if ( com_sv_running->integer )
			Com_RunAndTimeServerPacket( &from, &netmsg );
		else
			CL_PacketEvent( from, &netmsg );
	}
}

void NET_Restart_f( void ) {
}
