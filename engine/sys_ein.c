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
// sys_ein.c -- the system driver for the EiN page, quakegeneric's
// sys_null.c with a clock that runs, and Quit and errors that end the
// game: exit() throws Emscripten's ExitStatus out of ein_tick, which the
// page reads.

#include <errno.h>
#include <sys/stat.h>

#include <emscripten.h>

#include "quakedef.h"

qboolean isDedicated;

#define MAX_HANDLES 10
FILE *sys_handles[MAX_HANDLES];

static int findhandle(void)
{
	int i;

	for (i = 1; i < MAX_HANDLES; i++)
		if (!sys_handles[i])
			return i;
	Sys_Error("out of handles");
	return -1;
}

static int filelength(FILE *f)
{
	int pos, end;

	pos = ftell(f);
	fseek(f, 0, SEEK_END);
	end = ftell(f);
	fseek(f, pos, SEEK_SET);
	return end;
}

int Sys_FileOpenRead(char *path, int *hndl)
{
	FILE *f;
	int i = findhandle();

	f = fopen(path, "rb");
	if (!f)
	{
		*hndl = -1;
		return -1;
	}
	sys_handles[i] = f;
	*hndl = i;
	return filelength(f);
}

int Sys_FileOpenWrite(char *path)
{
	FILE *f;
	int i = findhandle();

	f = fopen(path, "wb");
	if (!f)
		Sys_Error("Error opening %s: %s", path, strerror(errno));
	sys_handles[i] = f;
	return i;
}

void Sys_FileClose(int handle)
{
	fclose(sys_handles[handle]);
	sys_handles[handle] = NULL;
}

void Sys_FileSeek(int handle, int position)
{
	fseek(sys_handles[handle], position, SEEK_SET);
}

int Sys_FileRead(int handle, void *dest, int count)
{
	return fread(dest, 1, count, sys_handles[handle]);
}

int Sys_FileWrite(int handle, void *data, int count)
{
	return fwrite(data, 1, count, sys_handles[handle]);
}

int Sys_FileTime(char *path)
{
	FILE *f = fopen(path, "rb");

	if (f)
	{
		fclose(f);
		return 1;
	}
	return -1;
}

void Sys_mkdir(char *path)
{
	mkdir(path, 0777);
}

void Sys_MakeCodeWriteable(unsigned long startaddr, unsigned long length)
{
}

void Sys_Error(char *error, ...)
{
	va_list argptr;

	printf("Sys_Error: ");
	va_start(argptr, error);
	vprintf(error, argptr);
	va_end(argptr);
	printf("\n");
	exit(1);
}

void Sys_Printf(char *fmt, ...)
{
	va_list argptr;

	va_start(argptr, fmt);
	vprintf(fmt, argptr);
	va_end(argptr);
}

// Quit writes config.cfg, as Quake does, and ends the game.
void Sys_Quit(void)
{
	Host_Shutdown();
	exit(0);
}

double Sys_FloatTime(void)
{
	return emscripten_get_now() / 1000.0;
}

char *Sys_ConsoleInput(void)
{
	return NULL;
}

void Sys_Sleep(void)
{
}

void Sys_SendKeyEvents(void)
{
}

void Sys_HighFPPrecision(void)
{
}

void Sys_LowFPPrecision(void)
{
}
