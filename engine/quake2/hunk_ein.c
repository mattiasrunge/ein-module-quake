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
// hunk_ein.c -- the renderers' model memory for EiN, in place of
// backends/unix/shared/hunk.c, which reserves the most a model can take
// with mmap and gives back the rest with mremap, which WebAssembly's
// memory has no use for. Here a hunk is one block of the most it can take,
// which the renderers reckon from the model's file; a model's pointers
// point into it, so it never moves.

#include <stdlib.h>

#include "../src/common/header/common.h"

static byte *membase;
static size_t maxhunksize;
static size_t curhunksize;

void *
Hunk_Begin(int maxsize)
{
	// plus 32 bytes for cacheline
	maxhunksize = maxsize + sizeof(size_t) + 32;
	curhunksize = 0;
	membase = malloc(maxhunksize);

	if (membase == NULL)
	{
		Sys_Error("unable to allocate %d bytes", maxsize);
	}

	*((size_t *)membase) = curhunksize;

	return membase + sizeof(size_t);
}

void *
Hunk_Alloc(int size)
{
	byte *buf;

	// round to cacheline
	size = (size + 31) & ~31;

	if (curhunksize + size > maxhunksize)
	{
		Sys_Error("%s: overflow %d > %d", __func__, (int)(curhunksize + size), (int)maxhunksize);
	}

	buf = membase + sizeof(size_t) + curhunksize;
	curhunksize += size;
	return buf;
}

int
Hunk_End(void)
{
	*((size_t *)membase) = curhunksize + sizeof(size_t);
	return curhunksize;
}

void
Hunk_Free(void *base)
{
	if (base)
	{
		free(((byte *)base) - sizeof(size_t));
	}
}
