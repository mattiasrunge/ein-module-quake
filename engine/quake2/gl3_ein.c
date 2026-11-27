/*
Copyright (C) 2016 Daniel Gibson
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
// gl3_ein.c -- the OpenGL ES 3 renderer's context for the EiN page, in
// place of gl3_sdl.c: the WebGL 2 context of the worker's canvas, which
// the platform layer makes and keeps (GLimp_WebGLContext, glimp_ein.c),
// with OpenGL ES 3.0's functions loaded through glad from Emscripten's
// WebGL. A frame drawn is the canvas's, which the worker hands the page
// (GLimp_GLFrame).

#include <emscripten.h>
#include <emscripten/html5.h>

#include "../src/client/refresh/gl3/header/local.h"

// glimp_ein.c's.
qboolean GLimp_WebGLContext(void);
void GLimp_GLFrame(void);

qboolean IsHighDPIaware = false;

void GL3_EndFrame(void)
{
	if (gl3config.useBigVBO)
	{
		// I think this is a good point to orphan the VBO and get a fresh one
		GL3_BindVAO(gl3state.vao3D);
		GL3_BindVBO(gl3state.vbo3D);
		glBufferData(GL_ARRAY_BUFFER, gl3state.vbo3Dsize, NULL, GL_STREAM_DRAW);
		gl3state.vbo3DcurOffset = 0;
	}

	GLimp_GLFrame();
}

// The page draws each frame the browser asks for: no swap interval.
qboolean GL3_IsVsyncActive(void)
{
	return false;
}

void GL3_SetVsync(void)
{
}

// The context has 8 stencil bits (glimp_ein.c), for the shadows.
int GL3_PrepareForWindow(void)
{
	gl3config.stencil = true;
	return 0;
}

int GL3_InitContext(void *win)
{
	if (!GLimp_WebGLContext())
	{
		Com_Printf("GL3_InitContext(): this browser has no WebGL 2\n");
		return false;
	}

	if (!gladLoadGLES2Loader((void *)emscripten_webgl_get_proc_address))
	{
		Com_Printf("GL3_InitContext(): ERROR: loading OpenGL function pointers failed!\n");
		return false;
	}
	else if (GLVersion.major < 3)
	{
		Com_Printf("GL3_InitContext(): ERROR: glad only got GL version %d.%d!\n", GLVersion.major, GLVersion.minor);
		return false;
	}

	Com_Printf("Successfully loaded OpenGL function pointers using glad, got version %d.%d!\n", GLVersion.major, GLVersion.minor);

	gl3config.debug_output = false;
	gl3config.anisotropic = GLAD_GL_EXT_texture_filter_anisotropic != 0;
	gl3config.major_version = GLVersion.major;
	gl3config.minor_version = GLVersion.minor;

	return true;
}

void GL3_GetDrawableSize(int *width, int *height)
{
	emscripten_get_canvas_element_size("!canvas", width, height);
}

// The context is kept for the next time the renderer starts.
void GL3_ShutdownContext(void)
{
}

// No SDL (glimp_ein.c's GLimp_GetFrameworkVersion).
int GL3_GetSDLVersion(void)
{
	return 0;
}
