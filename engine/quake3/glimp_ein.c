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
// glimp_ein.c -- Quake 3's OpenGL for the EiN page, in place of
// sdl_glimp.c and sdl_gamma.c: a WebGL 2 context, OpenGL ES 3.0 to the
// OpenGL 2 renderer, on the canvas the page gave the engine (Module.canvas,
// which Emscripten finds as "!canvas"). The page never shows that canvas: it
// draws it onto its own after each frame. The frame is the size of the
// video mode the player chose (r_mode), or with r_mode -2 the size the page
// shows the game at (Module.einDisplay), and the canvas takes that size.
// There is no window to go fullscreen or to minimise: the page shows the
// frame fullscreen when r_fullscreen asks for it (ein_fullscreen).

#include <emscripten.h>
#include <emscripten/html5.h>

#include "renderercommon/tr_common.h"
#include "sys/sys_local.h"

int qglMajorVersion, qglMinorVersion;
int qglesMajorVersion, qglesMinorVersion;

void (APIENTRYP qglActiveTextureARB) (GLenum texture);
void (APIENTRYP qglClientActiveTextureARB) (GLenum texture);
void (APIENTRYP qglMultiTexCoord2fARB) (GLenum target, GLfloat s, GLfloat t);

void (APIENTRYP qglLockArraysEXT) (GLint first, GLsizei count);
void (APIENTRYP qglUnlockArraysEXT) (void);

#define GLE(ret, name, ...) name##proc * qgl##name = NULL;
QGL_1_1_PROCS;
QGL_1_1_FIXED_FUNCTION_PROCS;
QGL_DESKTOP_1_1_PROCS;
QGL_DESKTOP_1_1_FIXED_FUNCTION_PROCS;
QGL_ES_1_1_PROCS;
QGL_ES_1_1_FIXED_FUNCTION_PROCS;
QGL_1_3_PROCS;
QGL_1_5_PROCS;
QGL_2_0_PROCS;
QGL_3_0_PROCS;
QGL_ARB_occlusion_query_PROCS;
QGL_ARB_framebuffer_object_PROCS;
QGL_ARB_vertex_array_object_PROCS;
QGL_EXT_direct_state_access_PROCS;
#undef GLE

// The context, made once: a canvas has one WebGL context, which a video
// restart keeps.
static EMSCRIPTEN_WEBGL_CONTEXT_HANDLE context = 0;

// The canvas the page gave the engine, by the name Emscripten's WebGL and
// canvas functions find it under.
EM_JS(void, ein_canvas, (void), {
	specialHTMLTargets["!canvas"] = Module.canvas;
});

// The size the page shows the game at, in the screen's pixels: what r_mode
// -2 draws at, as it draws at the desktop's size elsewhere.
EM_JS(void, ein_display, (int *width, int *height), {
	var size = Module.einDisplay ? Module.einDisplay() : { width: 1280, height: 720 };
	HEAP32[width >> 2] = size.width;
	HEAP32[height >> 2] = size.height;
});

// The two of SDL's functions the OpenGL 2 renderer looks up extensions
// with (tr_extensions.c), answered from WebGL: no SDL is linked.
void *SDL_GL_GetProcAddress(const char *name)
{
	return emscripten_webgl_get_proc_address(name);
}

int SDL_GL_ExtensionSupported(const char *extension)
{
	GLint count = 0;
	int i;

	qglGetIntegerv(GL_NUM_EXTENSIONS, &count);
	for (i = 0; i < count; i++)
	{
		if (!strcmp((const char *) qglGetStringi(GL_EXTENSIONS, i), extension))
			return 1;
	}
	return 0;
}

static void APIENTRY GLimp_GLES_ClearDepth( GLclampd depth ) {
	qglClearDepthf( depth );
}

static void APIENTRY GLimp_GLES_DepthRange( GLclampd near_val, GLclampd far_val ) {
	qglDepthRangef( near_val, far_val );
}

static void APIENTRY GLimp_GLES_DrawBuffer( GLenum mode ) {
	// unsupported
}

static void APIENTRY GLimp_GLES_PolygonMode( GLenum face, GLenum mode ) {
	// unsupported
}

// OpenGL ES 3.0's functions, as sdl_glimp.c looks them up for an OpenGL ES
// context.
static void GLimp_GetProcAddresses( void ) {
	const char *version;

#define GLE( ret, name, ... ) qgl##name = (name##proc *) SDL_GL_GetProcAddress("gl" #name); \
	if ( qgl##name == NULL ) { \
		ri.Error( ERR_FATAL, "Missing OpenGL function gl" #name ); \
	}

	GLE(const GLubyte *, GetString, GLenum name)

	version = (const char *)qglGetString( GL_VERSION );
	sscanf( version, "OpenGL ES %d.%d", &qglesMajorVersion, &qglesMinorVersion );
	qglMajorVersion = qglMinorVersion = 0;

	QGL_1_1_PROCS;
	QGL_ES_1_1_PROCS;
	QGL_1_3_PROCS;
	QGL_1_5_PROCS;
	QGL_2_0_PROCS;
	QGL_3_0_PROCS;

	qglClearDepth = GLimp_GLES_ClearDepth;
	qglDepthRange = GLimp_GLES_DepthRange;
	qglDrawBuffer = GLimp_GLES_DrawBuffer;
	qglPolygonMode = GLimp_GLES_PolygonMode;

#undef GLE
}

void GLimp_Init( qboolean fixedFunction )
{
	EmscriptenWebGLContextAttributes attributes;
	GLint count = 0;
	int i;

	if ( fixedFunction )
		ri.Error( ERR_FATAL, "GLimp_Init: WebGL has no fixed function pipeline" );

	ri.Printf( PRINT_ALL, "Initializing OpenGL display\n" );

	if ( !context )
	{
		emscripten_webgl_init_context_attributes( &attributes );
		attributes.majorVersion = 2;
		attributes.minorVersion = 0;
		attributes.alpha = EM_FALSE;
		attributes.depth = EM_TRUE;
		attributes.stencil = EM_TRUE;
		attributes.antialias = EM_FALSE;
		attributes.premultipliedAlpha = EM_FALSE;
		attributes.preserveDrawingBuffer = EM_FALSE;
		attributes.powerPreference = EM_WEBGL_POWER_PREFERENCE_HIGH_PERFORMANCE;
		ein_canvas();
		context = emscripten_webgl_create_context( "!canvas", &attributes );
		if ( context <= 0 )
			ri.Error( ERR_FATAL, "GLimp_Init: this browser has no WebGL 2" );
	}
	emscripten_webgl_make_context_current( context );

	ri.Printf( PRINT_ALL, "...setting mode %d:", r_mode->integer );
	if ( r_mode->integer == -2 || !R_GetModeInfo( &glConfig.vidWidth, &glConfig.vidHeight, &glConfig.windowAspect, r_mode->integer ) )
	{
		ein_display( &glConfig.vidWidth, &glConfig.vidHeight );
		glConfig.windowAspect = (float) glConfig.vidWidth / glConfig.vidHeight;
	}
	ri.Printf( PRINT_ALL, " %d %d\n", glConfig.vidWidth, glConfig.vidHeight );
	emscripten_set_canvas_element_size( "!canvas", glConfig.vidWidth, glConfig.vidHeight );

	GLimp_GetProcAddresses();

	glConfig.colorBits = 24;
	glConfig.depthBits = 24;
	glConfig.stencilBits = 8;
	glConfig.displayFrequency = 60;
	glConfig.isFullscreen = r_fullscreen->integer != 0;
	glConfig.stereoEnabled = qfalse;
	glConfig.driverType = GLDRV_ICD;
	glConfig.hardwareType = GLHW_GENERIC;
	// The page has no gamma ramp to set: brightness is the renderer's own.
	glConfig.deviceSupportsGamma = qfalse;

	Q_strncpyz( glConfig.vendor_string, (char *) qglGetString( GL_VENDOR ), sizeof( glConfig.vendor_string ) );
	Q_strncpyz( glConfig.renderer_string, (char *) qglGetString( GL_RENDERER ), sizeof( glConfig.renderer_string ) );
	Q_strncpyz( glConfig.version_string, (char *) qglGetString( GL_VERSION ), sizeof( glConfig.version_string ) );

	glConfig.extensions_string[0] = 0;
	qglGetIntegerv( GL_NUM_EXTENSIONS, &count );
	for ( i = 0; i < count; i++ )
	{
		if ( i > 0 )
			Q_strcat( glConfig.extensions_string, sizeof( glConfig.extensions_string ), " " );
		Q_strcat( glConfig.extensions_string, sizeof( glConfig.extensions_string ), (char *) qglGetStringi( GL_EXTENSIONS, i ) );
	}

	// S3TC, when the player asks for compressed textures and the GPU has it.
	glConfig.textureCompression = TC_NONE;
	if ( r_ext_compressed_textures->integer && SDL_GL_ExtensionSupported( "GL_EXT_texture_compression_s3tc" ) )
		glConfig.textureCompression = TC_S3TC_ARB;

	ri.Cvar_Get( "r_availableModes", "", CVAR_ROM );

	ri.IN_Init( NULL );
}

void GLimp_Shutdown( void )
{
	ri.IN_Shutdown();
}

// The browser shows what was drawn once the page's frame ends.
void GLimp_EndFrame( void )
{
}

void GLimp_Minimize( void )
{
}

void GLimp_LogComment( char *comment )
{
}

void GLimp_SetGamma( unsigned char red[256], unsigned char green[256], unsigned char blue[256] )
{
}
