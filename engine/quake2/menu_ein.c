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
// menu_ein.c -- what the EiN page asks of Quake 2's client that the
// platform layer, quake2generic_ein.c, cannot see beside the renderer's
// headers: whether a menu or the console is up.

#include <emscripten.h>

#include "client/client.h"

// Whether a menu or the console is up, which the player works without the
// mouse: the page gives it back while one is.
EMSCRIPTEN_KEEPALIVE
int ein_menu(void)
{
	return cls.key_dest == key_menu || cls.key_dest == key_console;
}
