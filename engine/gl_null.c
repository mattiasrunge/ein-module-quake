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
// gl_null.c -- the dedicated server's WebGL renderer: none. The engine's
// hooks (webgl.patch) are linked to these, and gl_drawing is never set.

#include "quakedef.h"
#include "gl_ein.h"

qboolean	gl_drawing;
qboolean	gl_failed = true;

void GL_Register (void)
{
}

void GL_RenderView (void)
{
}

void GL_NewMap (void)
{
}

void GL_Particle (particle_t *p)
{
}

qboolean GL_EndFrame (void)
{
	return false;
}
