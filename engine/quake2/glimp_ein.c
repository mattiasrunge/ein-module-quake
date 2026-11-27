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
// glimp_ein.c -- Yamagi Quake II's video for the EiN page, in place of
// vid/glimp_sdl2.c: no window, but the frames the worker hands the page.
// The OpenGL ES 3 renderer (gl3_ein.c) draws with WebGL 2 on the canvas
// the engine was given (Module.canvas, an OffscreenCanvas of the worker,
// which Emscripten finds as "!canvas"), the size of the video mode; the
// software renderer hands over its frame of B, G, R, A bytes
// (GLimp_SoftFrame, soft.patch), which is kept here as R, G, B, A bytes,
// as a canvas's ImageData has them. After each tick the worker looks at
// ein_frames: when a frame was drawn since, ein_gl says which renderer drew
// it, and for the software one ein_screen, ein_width and ein_height are the
// frame. There is no window to go fullscreen: the page shows the frame
// fullscreen when vid_fullscreen asks for it (ein_fullscreen,
// quake2_ein.c).

#include <stdint.h>
#include <stdlib.h>

#include <emscripten.h>
#include <emscripten/html5.h>

#include "../src/client/header/client.h"
#include "../src/client/vid/header/ref.h"

float glimp_refreshRate = -1.0f;

// The WebGL 2 context, made once and kept: a canvas has one context, which
// switching renderers and video modes keeps. Whether it could be made: 0
// not tried yet, 1 made, -1 this browser has no WebGL 2.
static EMSCRIPTEN_WEBGL_CONTEXT_HANDLE context = 0;
static int webgl2 = 0;

// Whether a renderer's graphics are up, to shut down before a new mode.
static qboolean graphics_up = false;

// How many frames the renderers have finished, and whether the last was
// drawn with WebGL.
static unsigned int frames = 0;
static int gl_frame = 0;

// The software renderer's last frame, R, G, B, A bytes.
static uint32_t *screen = NULL;
static int screen_width = 0;
static int screen_height = 0;

// The canvas the page gave the engine, by the name Emscripten's WebGL and
// canvas functions find it under.
EM_JS(int, ein_canvas, (void), {
	if (!Module.canvas) return 0;
	specialHTMLTargets["!canvas"] = Module.canvas;
	return 1;
});

// The size the page shows the game at, in the screen's pixels: what r_mode
// -2 (the Video menu's auto) draws at, as it draws at the desktop's size
// elsewhere.
EM_JS(void, ein_display, (int *width, int *height), {
	var size = Module.einDisplay ? Module.einDisplay() : { width: 1280, height: 720 };
	HEAP32[width >> 2] = size.width;
	HEAP32[height >> 2] = size.height;
});

// Makes the WebGL 2 context current, making it the first time; false when
// the browser has none (the game then draws with the software renderer).
qboolean GLimp_WebGLContext(void)
{
	EmscriptenWebGLContextAttributes attributes;

	if (webgl2 == 0)
	{
		webgl2 = -1;

		if (ein_canvas())
		{
			emscripten_webgl_init_context_attributes(&attributes);
			attributes.majorVersion = 2;
			attributes.minorVersion = 0;
			attributes.alpha = EM_FALSE;
			attributes.depth = EM_TRUE;
			attributes.stencil = EM_TRUE;
			attributes.antialias = EM_FALSE;
			attributes.premultipliedAlpha = EM_FALSE;
			attributes.preserveDrawingBuffer = EM_FALSE;
			attributes.powerPreference = EM_WEBGL_POWER_PREFERENCE_HIGH_PERFORMANCE;
			context = emscripten_webgl_create_context("!canvas", &attributes);

			if (context > 0)
			{
				webgl2 = 1;
			}
		}

		if (webgl2 < 0)
		{
			Com_Printf("This browser has no WebGL 2: the game draws with the software renderer.\n");
		}
	}

	if (webgl2 < 0)
	{
		return false;
	}

	emscripten_webgl_make_context_current(context);
	return true;
}

// Whether the OpenGL ES 3 renderer can draw here (vid.c's renderer list).
qboolean GLimp_HasWebGL2(void)
{
	return GLimp_WebGLContext();
}

// The OpenGL ES 3 renderer finished a frame on the canvas (gl3_ein.c).
void GLimp_GLFrame(void)
{
	frames++;
	gl_frame = 1;
}

// The software renderer finished a frame: `pixels` of B, G, R, A bytes,
// kept as R, G, B, A.
void GLimp_SoftFrame(const uint32_t *pixels, int width, int height)
{
	int i;

	if (width != screen_width || height != screen_height)
	{
		free(screen);
		screen = malloc(width * height * sizeof(uint32_t));
		screen_width = width;
		screen_height = height;
	}

	for (i = 0; i < width * height; i++)
	{
		uint32_t pixel = pixels[i];
		screen[i] = (pixel & 0xff00ff00u) | ((pixel >> 16) & 0xffu) | ((pixel & 0xffu) << 16);
	}

	frames++;
	gl_frame = 0;
}

qboolean GLimp_Init(void)
{
	// The page draws each frame the browser asks for: no vertical sync to
	// wait for, which would cap the frame rate below it.
	Cvar_Get("r_vsync", "0", CVAR_ARCHIVE);
	return true;
}

void GLimp_Shutdown(void)
{
	GLimp_ShutdownGraphics();
}

// A video mode: the canvas takes its size, and the renderer its context,
// which it is handed a window it never looks into for.
qboolean GLimp_InitGraphics(int fullscreen, int *pwidth, int *pheight)
{
	if (graphics_up)
	{
		re.ShutdownContext();
		graphics_up = false;
	}

	if (re.PrepareForWindow() == -1)
	{
		return false;
	}

	if (webgl2 > 0)
	{
		emscripten_set_canvas_element_size("!canvas", *pwidth, *pheight);
	}

	if (!re.InitContext((void *)1))
	{
		return false;
	}

	viddef.width = *pwidth;
	viddef.height = *pheight;
	graphics_up = true;

	Com_Printf("Drawable size: %ix%i\n", viddef.width, viddef.height);

	return true;
}

void GLimp_ShutdownGraphics(void)
{
	graphics_up = false;
}

// The page has the pointer lock.
void GLimp_GrabInput(qboolean grab)
{
}

float GLimp_GetRefreshRate(void)
{
	if (glimp_refreshRate <= 0)
	{
		glimp_refreshRate = 60;
	}

	return glimp_refreshRate;
}

qboolean GLimp_GetDesktopMode(int *pwidth, int *pheight)
{
	ein_display(pwidth, pheight);
	return true;
}

const char **GLimp_GetDisplayIndices(void)
{
	return NULL;
}

int GLimp_GetNumVideoDisplays(void)
{
	return 1;
}

int GLimp_GetWindowDisplayIndex(void)
{
	return 0;
}

// No framework: the renderers say 0 too (gl3_ein.c, soft.patch).
int GLimp_GetFrameworkVersion(void)
{
	return 0;
}

// How many frames have been drawn, for the worker to hand over each new one.
EMSCRIPTEN_KEEPALIVE
unsigned int ein_frames(void)
{
	return frames;
}

// Whether the last frame was drawn on the canvas with WebGL, rather than
// left in ein_screen by the software renderer.
EMSCRIPTEN_KEEPALIVE
int ein_gl(void)
{
	return gl_frame;
}

EMSCRIPTEN_KEEPALIVE
uint32_t *ein_screen(void)
{
	return screen;
}

EMSCRIPTEN_KEEPALIVE
int ein_width(void)
{
	return screen_width;
}

EMSCRIPTEN_KEEPALIVE
int ein_height(void)
{
	return screen_height;
}
