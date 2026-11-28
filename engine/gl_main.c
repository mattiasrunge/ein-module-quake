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
// gl_main.c -- the WebGL 2 renderer's context, its frame and its view.
//
// The context is a WebGL 2 one on the canvas the worker gave the engine
// (Module.canvas, an OffscreenCanvas, which Emscripten finds as
// "!canvas"), made the first time the player's renderer is WebGL; a
// browser without WebGL 2 leaves the software renderer drawing. The canvas
// is the frame's size, the mode's. The software renderer keeps drawing the
// 2D (menus, status bar, console) into vid.buffer, as it always has, and
// leaves the view's rectangle alone: there GL_RenderView fills it with 255,
// the 2D's transparent index, after drawing the 3D view into a framebuffer
// of its own. GL_EndFrame then puts vid.buffer's 2D over the view on the
// canvas, through the palette (gl_shaders.c's last pass), which the worker
// hands to the page.

#include <string.h>

#include <emscripten.h>
#include <emscripten/html5.h>

#include "gl_local.h"

qboolean	gl_drawing;
qboolean	gl_failed;
qboolean	gl_linear;
int			gl_width, gl_height;
float		gl_viewproj[16];
float		gl_xscale;
float		gl_curve[VID_GRADES];
int			gl_gen = 1;
int			gl_lightgen = 1;
int			gl_fullbrights = 224;

// How opaque the liquids are drawn, as QuakeSpasm has them: water half,
// and slime with it (r_slimealpha 0 follows r_wateralpha), lava and
// teleporters opaque. A map vised with its liquids opaque, as id's are,
// sees through them all the same (watervis_ein.c).
cvar_t		r_wateralpha = {"r_wateralpha", "0.5", true};
cvar_t		r_slimealpha = {"r_slimealpha", "0", true};
cvar_t		r_lavaalpha = {"r_lavaalpha", "1", true};
cvar_t		r_telealpha = {"r_telealpha", "1", true};

// Whether translucent liquids see through to what is behind them on a map
// vised with them opaque (watervis_ein.c); 0 draws only what the map's own
// visibility has, with holes where it stops.
cvar_t		r_watervis = {"r_watervis", "1", true};

// How many samples along the slope a linear texture takes on a surface
// seen at a slant (the browser's EXT_texture_filter_anisotropic), up to the
// graphics card's most; 1 is none.
cvar_t		gl_texture_anisotropy = {"gl_texture_anisotropy", "8", true};

// How the nearest look draws coloured light (a .lit's): 0 each colour
// through the colormap at its own light; 1 that put back on the palette's
// nearest colour, as the software engines with coloured light do.
cvar_t		r_litpalette = {"r_litpalette", "0", true};

// The palette's nearest colour the light falls on to each of 32 by 32 by
// 32 colours (r_litpalette 1).
static GLuint	rgbmap_texture;

// The linear look's samplers, mipmapped: repeating, and clamped at the
// edges for skins and sprites.
static GLuint	sampler_repeat, sampler_clamp;
static float	anisotropy_max, anisotropy_set = -1;

// The leaf GL_MarkLeaves marked from, whether through the liquids, and
// r_visframecount then.
static mleaf_t	*marked_leaf;
static qboolean	marked_through;
static int		marked_frame;

static EMSCRIPTEN_WEBGL_CONTEXT_HANDLE	context;
static qboolean	started, starting;

// The textures every frame uses: the palette, the colormaps (the engine's
// and the players'), the brightness' gamma table and the 2D.
static GLuint	palette_texture, colormap_texture, gamma_texture, overlay_texture;
static byte		gamma_uploaded[256];
static byte		colormaps_uploaded[MAX_SCOREBOARD][VID_GRADES * 256];

// The 3D view's framebuffer, as large as the frame.
static GLuint	scene_framebuffer, scene_texture, scene_depth;

// The view's rectangle of the last 3D view drawn, where vid.buffer's 255s
// are transparent, and whether it was under water.
static vrect_t	view_rect;
static qboolean	view_warped;

// The frustum's sides, from the view's matrix: a, b, c, d of a plane each,
// in front of which the view sees.
static float	frustum[4][4];

// view.c's gamma table, which no header declares.
extern byte		gammatable[256];

// The canvas the page gave the engine, by the name Emscripten's WebGL and
// canvas functions find it under; 0 when there is none.
EM_JS(int, gl_canvas, (void), {
	if (!Module.canvas) return 0;
	specialHTMLTargets["!canvas"] = Module.canvas;
	return 1;
});

void GL_Register (void)
{
	Cvar_RegisterVariable (&r_wateralpha);
	Cvar_RegisterVariable (&r_slimealpha);
	Cvar_RegisterVariable (&r_lavaalpha);
	Cvar_RegisterVariable (&r_telealpha);
	Cvar_RegisterVariable (&r_watervis);
	GLM_Register ();
	Cvar_RegisterVariable (&gl_texture_anisotropy);
	Cvar_RegisterVariable (&r_litpalette);
}

/*
=============
GL_LinearSampler

The linear look's sampler on the texture unit, clamped at the edges or
repeating; none (0) for the nearest look's texelFetch.
=============
*/
void GL_LinearSampler (int unit, qboolean clamp)
{
	glBindSampler (unit, !gl_linear ? 0 : clamp ? sampler_clamp : sampler_repeat);
}

static void GL_Anisotropy (void)
{
	float	value = gl_texture_anisotropy.value;

	if (value < 1)
		value = 1;
	if (value > anisotropy_max)
		value = anisotropy_max;
	if (value == anisotropy_set || anisotropy_max < 1)
		return;
	anisotropy_set = value;
	glSamplerParameterf (sampler_repeat, GL_TEXTURE_MAX_ANISOTROPY_EXT, value);
	glSamplerParameterf (sampler_clamp, GL_TEXTURE_MAX_ANISOTROPY_EXT, value);
}

//=============================================================================

void GL_MatMul (const float *a, const float *b, float *out)
{
	float	r[16];
	int		i, j;

	for (i = 0 ; i < 4 ; i++)
		for (j = 0 ; j < 4 ; j++)
			r[i * 4 + j] = a[0 * 4 + j] * b[i * 4 + 0] + a[1 * 4 + j] * b[i * 4 + 1]
				+ a[2 * 4 + j] * b[i * 4 + 2] + a[3 * 4 + j] * b[i * 4 + 3];
	memcpy (out, r, sizeof (r));
}

/*
=============
GL_EntityMatrix

The entity's model space to the view's clip space. An alias model's pitch
is the other way round, as R_AliasSetUpTransform has it.
=============
*/
void GL_EntityMatrix (entity_t *e, qboolean alias, float *out)
{
	GL_Matrix (e->origin, e->angles, alias, out);
}

// The same for a model at `origin`, turned by `angles`.
void GL_Matrix (vec3_t origin, vec3_t entangles, qboolean alias, float *out)
{
	vec3_t	angles, forward, right, up;
	float	model[16];

	VectorCopy (entangles, angles);
	if (alias)
		angles[PITCH] = -angles[PITCH];
	AngleVectors (angles, forward, right, up);
	model[0] = forward[0]; model[1] = forward[1]; model[2] = forward[2]; model[3] = 0;
	model[4] = -right[0]; model[5] = -right[1]; model[6] = -right[2]; model[7] = 0;
	model[8] = up[0]; model[9] = up[1]; model[10] = up[2]; model[11] = 0;
	model[12] = origin[0]; model[13] = origin[1]; model[14] = origin[2]; model[15] = 1;
	GL_MatMul (gl_viewproj, model, out);
}

/*
=============
GL_BoxOutside

Whether the box is wholly outside one of the frustum's sides.
=============
*/
qboolean GL_BoxOutside (vec3_t mins, vec3_t maxs)
{
	int		i;
	float	*p;

	for (i = 0 ; i < 4 ; i++)
	{
		p = frustum[i];
		if (p[0] * (p[0] > 0 ? maxs[0] : mins[0]) + p[1] * (p[1] > 0 ? maxs[1] : mins[1])
			+ p[2] * (p[2] > 0 ? maxs[2] : mins[2]) + p[3] < 0)
			return true;
	}
	return false;
}

glprogram_t *GL_UseProgram (glprogramid_t id)
{
	glUseProgram (gl_programs[id].id);
	return &gl_programs[id];
}

void GL_Bind (int unit, GLenum target, GLuint texture)
{
	glActiveTexture (GL_TEXTURE0 + unit);
	glBindTexture (target, texture);
}

/*
=============
GL_IndexTexture

A texture of 8-bit indexes, `levels` mip levels each half the last, read
with texelFetch.
=============
*/
GLuint GL_IndexTexture (int width, int height, int levels, byte **pixels)
{
	GLuint	texture;
	int		i;

	glGenTextures (1, &texture);
	GL_Bind (TU_TEXTURE, GL_TEXTURE_2D, texture);
	glTexStorage2D (GL_TEXTURE_2D, levels, GL_R8, width, height);
	for (i = 0 ; i < levels ; i++)
		glTexSubImage2D (GL_TEXTURE_2D, i, 0, 0, width >> i, height >> i, GL_RED, GL_UNSIGNED_BYTE, pixels[i]);
	glTexParameteri (GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, levels > 1 ? GL_NEAREST_MIPMAP_NEAREST : GL_NEAREST);
	glTexParameteri (GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
	glTexParameteri (GL_TEXTURE_2D, GL_TEXTURE_MAX_LEVEL, levels - 1);
	return texture;
}

/*
=============
GL_ColourTexture

The indexes' colours, for the linear look: filtered, mipmapped with
CT_MIPMAP, repeating with CT_REPEAT. Alpha is 0 where the texture is
transparent (CT_ZERO: index 0, a sky's front layer; CT_255: index 255, a
sprite's), and with CT_FULLBRIGHT 0 on fullbright texels and 1 on those
the light falls on.
=============
*/
GLuint GL_ColourTexture (int width, int height, byte *pixels, int flags)
{
	GLuint	texture;
	byte	*rgba, *pal;
	int		i, index, alpha;

	rgba = malloc (width * height * 4);
	for (i = 0 ; i < width * height ; i++)
	{
		index = pixels[i];
		pal = host_basepal + index * 3;
		alpha = 255;
		if (((flags & CT_ZERO) && index == 0) || ((flags & CT_255) && index == 255))
			alpha = 0;
		else if ((flags & CT_FULLBRIGHT) && index >= gl_fullbrights)
			alpha = 0;
		if (alpha || (flags & CT_FULLBRIGHT))
		{
			rgba[i * 4 + 0] = pal[0];
			rgba[i * 4 + 1] = pal[1];
			rgba[i * 4 + 2] = pal[2];
		}
		else
			rgba[i * 4 + 0] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = 0;
		rgba[i * 4 + 3] = alpha;
	}
	glGenTextures (1, &texture);
	GL_Bind (TU_TEXTURE, GL_TEXTURE_2D, texture);
	glTexImage2D (GL_TEXTURE_2D, 0, GL_RGBA8, width, height, 0, GL_RGBA, GL_UNSIGNED_BYTE, rgba);
	free (rgba);
	if (flags & CT_MIPMAP)
	{
		glGenerateMipmap (GL_TEXTURE_2D);
		glTexParameteri (GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR_MIPMAP_LINEAR);
	}
	else
		glTexParameteri (GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
	glTexParameteri (GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
	glTexParameteri (GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, (flags & CT_REPEAT) ? GL_REPEAT : GL_CLAMP_TO_EDGE);
	glTexParameteri (GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, (flags & CT_REPEAT) ? GL_REPEAT : GL_CLAMP_TO_EDGE);
	return texture;
}

/*
=============
GL_PlayerColormap

The colormap texture's block for an entity's colormap: 0 for the engine's,
a player's own (cl.scores[].translations, their colours) from 1, put on
the texture when it changed.
=============
*/
int GL_PlayerColormap (byte *colormap)
{
	int		i;

	if (colormap == vid.colormap || !cl.scores)
		return 0;
	for (i = 0 ; i < cl.maxclients && i < MAX_SCOREBOARD ; i++)
	{
		if (colormap != cl.scores[i].translations)
			continue;
		if (memcmp (colormaps_uploaded[i], colormap, sizeof (colormaps_uploaded[i])))
		{
			memcpy (colormaps_uploaded[i], colormap, sizeof (colormaps_uploaded[i]));
			GL_Bind (TU_COLORMAP, GL_TEXTURE_2D, colormap_texture);
			glTexSubImage2D (GL_TEXTURE_2D, 0, 0, (i + 1) * COLORMAP_ROWS, 256, COLORMAP_ROWS,
				GL_RED, GL_UNSIGNED_BYTE, colormap);
		}
		return i + 1;
	}
	return 0;
}

//=============================================================================

/*
=============
GL_Curve

Where the fullbright colours start, the colormap's last columns that are
the same in every row; and how bright each of its rows is against the
palette, over the colours the light falls on: the linear look's light, as
bright as the nearest look's.
=============
*/
static void GL_Curve (void)
{
	int		row, c, lit;
	double	sum, base;
	byte	*pal;

	for (gl_fullbrights = 256 ; gl_fullbrights > 0 ; gl_fullbrights--)
	{
		for (row = 0 ; row < VID_GRADES ; row++)
			if (vid.colormap[row * 256 + gl_fullbrights - 1] != gl_fullbrights - 1)
				break;
		if (row < VID_GRADES)
			break;
	}

	for (row = 0 ; row < VID_GRADES ; row++)
	{
		sum = base = 0;
		for (c = 0 ; c < gl_fullbrights ; c++)
		{
			pal = host_basepal + c * 3;
			base += pal[0] + pal[1] + pal[2];
			lit = vid.colormap[row * 256 + c];
			pal = host_basepal + lit * 3;
			sum += pal[0] + pal[1] + pal[2];
		}
		gl_curve[row] = base > 0 ? sum / base : 1;
	}
}

/*
=============
GL_RgbMap

The nearest of the palette's colours the light falls on (not its
fullbright ones) to the middle of each cell of a 32 cube of colours.
=============
*/
static void GL_RgbMap (void)
{
	byte	*map = malloc (32 * 32 * 32);
	int		r, g, b, c, d, best, bestd, dr, dg, db;
	byte	*pal;

	for (b = 0 ; b < 32 ; b++)
		for (g = 0 ; g < 32 ; g++)
			for (r = 0 ; r < 32 ; r++)
			{
				best = 0;
				bestd = 1 << 30;
				for (c = 0 ; c < gl_fullbrights ; c++)
				{
					pal = host_basepal + c * 3;
					dr = pal[0] - (r * 8 + 4);
					dg = pal[1] - (g * 8 + 4);
					db = pal[2] - (b * 8 + 4);
					d = dr * dr + dg * dg + db * db;
					if (d < bestd)
					{
						bestd = d;
						best = c;
					}
				}
				map[(b * 32 + g) * 32 + r] = best;
			}
	glGenTextures (1, &rgbmap_texture);
	GL_Bind (TU_RGBMAP, GL_TEXTURE_3D, rgbmap_texture);
	glTexStorage3D (GL_TEXTURE_3D, 1, GL_R8, 32, 32, 32);
	glTexSubImage3D (GL_TEXTURE_3D, 0, 0, 0, 0, 32, 32, 32, GL_RED, GL_UNSIGNED_BYTE, map);
	glTexParameteri (GL_TEXTURE_3D, GL_TEXTURE_MIN_FILTER, GL_NEAREST);
	glTexParameteri (GL_TEXTURE_3D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
	glTexParameteri (GL_TEXTURE_3D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
	glTexParameteri (GL_TEXTURE_3D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
	glTexParameteri (GL_TEXTURE_3D, GL_TEXTURE_WRAP_R, GL_CLAMP_TO_EDGE);
	free (map);
}

/*
=============
GL_Start

Makes the context and everything it keeps; false when the browser has no
WebGL 2, or it fails.
=============
*/
static qboolean GL_Start (void)
{
	EmscriptenWebGLContextAttributes	attributes;
	byte	rgba[256 * 4];
	int		i;

	if (!gl_canvas ())
	{
		Con_Printf ("WebGL: the engine has no canvas\n");
		return false;
	}
	emscripten_webgl_init_context_attributes (&attributes);
	attributes.majorVersion = 2;
	attributes.minorVersion = 0;
	attributes.alpha = EM_FALSE;
	attributes.depth = EM_FALSE;
	attributes.stencil = EM_FALSE;
	attributes.antialias = EM_FALSE;
	attributes.premultipliedAlpha = EM_FALSE;
	attributes.preserveDrawingBuffer = EM_FALSE;
	attributes.powerPreference = EM_WEBGL_POWER_PREFERENCE_HIGH_PERFORMANCE;
	context = emscripten_webgl_create_context ("!canvas", &attributes);
	if (context <= 0)
	{
		Con_Printf ("WebGL: this browser has no WebGL 2\n");
		return false;
	}
	emscripten_webgl_make_context_current (context);
	Con_Printf ("WebGL: %s, %s\n", (char *) glGetString (GL_VERSION), (char *) glGetString (GL_RENDERER));

	if (!GL_BuildPrograms ())
		return false;

	glPixelStorei (GL_UNPACK_ALIGNMENT, 1);

	for (i = 0 ; i < 256 ; i++)
	{
		rgba[i * 4 + 0] = host_basepal[i * 3 + 0];
		rgba[i * 4 + 1] = host_basepal[i * 3 + 1];
		rgba[i * 4 + 2] = host_basepal[i * 3 + 2];
		rgba[i * 4 + 3] = 255;
	}
	glGenTextures (1, &palette_texture);
	GL_Bind (TU_PALETTE, GL_TEXTURE_2D, palette_texture);
	glTexStorage2D (GL_TEXTURE_2D, 1, GL_RGBA8, 256, 1);
	glTexSubImage2D (GL_TEXTURE_2D, 0, 0, 0, 256, 1, GL_RGBA, GL_UNSIGNED_BYTE, rgba);

	glGenTextures (1, &colormap_texture);
	GL_Bind (TU_COLORMAP, GL_TEXTURE_2D, colormap_texture);
	glTexStorage2D (GL_TEXTURE_2D, 1, GL_R8, 256, COLORMAP_ROWS * COLORMAP_BLOCKS);
	glTexSubImage2D (GL_TEXTURE_2D, 0, 0, 0, 256, COLORMAP_ROWS, GL_RED, GL_UNSIGNED_BYTE, vid.colormap);
	memset (colormaps_uploaded, 0, sizeof (colormaps_uploaded));
	for (i = 0 ; i < MAX_SCOREBOARD ; i++)
		glTexSubImage2D (GL_TEXTURE_2D, 0, 0, (i + 1) * COLORMAP_ROWS, 256, COLORMAP_ROWS,
			GL_RED, GL_UNSIGNED_BYTE, colormaps_uploaded[i]);

	memcpy (gamma_uploaded, gammatable, sizeof (gamma_uploaded));
	glGenTextures (1, &gamma_texture);
	GL_Bind (TU_GAMMA, GL_TEXTURE_2D, gamma_texture);
	glTexStorage2D (GL_TEXTURE_2D, 1, GL_R8, 256, 1);
	glTexSubImage2D (GL_TEXTURE_2D, 0, 0, 0, 256, 1, GL_RED, GL_UNSIGNED_BYTE, gamma_uploaded);

	GL_Curve ();
	GL_RgbMap ();
	for (i = 0 ; i < P_COUNT ; i++)
	{
		if (gl_programs[i].u[UF_CURVE] < 0)
			continue;
		glUseProgram (gl_programs[i].id);
		glUniform1fv (gl_programs[i].u[UF_CURVE], VID_GRADES, gl_curve);
	}

	glGenSamplers (1, &sampler_repeat);
	glGenSamplers (1, &sampler_clamp);
	glSamplerParameteri (sampler_repeat, GL_TEXTURE_MIN_FILTER, GL_LINEAR_MIPMAP_LINEAR);
	glSamplerParameteri (sampler_repeat, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
	glSamplerParameteri (sampler_clamp, GL_TEXTURE_MIN_FILTER, GL_LINEAR_MIPMAP_LINEAR);
	glSamplerParameteri (sampler_clamp, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
	glSamplerParameteri (sampler_clamp, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
	glSamplerParameteri (sampler_clamp, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
	if (emscripten_webgl_enable_extension (context, "EXT_texture_filter_anisotropic"))
		glGetFloatv (GL_MAX_TEXTURE_MAX_ANISOTROPY_EXT, &anisotropy_max);

	glDepthFunc (GL_LEQUAL);
	started = true;
	return true;
}

/*
=============
GL_Resize

The canvas, the 3D view's framebuffer and the 2D's texture at the frame's
size, the mode's.
=============
*/
static void GL_Resize (void)
{
	if (vid.width == gl_width && vid.height == gl_height)
		return;
	gl_width = vid.width;
	gl_height = vid.height;
	emscripten_set_canvas_element_size ("!canvas", gl_width, gl_height);

	if (scene_framebuffer)
	{
		glDeleteFramebuffers (1, &scene_framebuffer);
		glDeleteTextures (1, &scene_texture);
		glDeleteRenderbuffers (1, &scene_depth);
		glDeleteTextures (1, &overlay_texture);
	}
	glGenTextures (1, &scene_texture);
	GL_Bind (TU_TEXTURE, GL_TEXTURE_2D, scene_texture);
	glTexStorage2D (GL_TEXTURE_2D, 1, GL_RGBA8, gl_width, gl_height);
	glTexParameteri (GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST);
	glTexParameteri (GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
	glGenRenderbuffers (1, &scene_depth);
	glBindRenderbuffer (GL_RENDERBUFFER, scene_depth);
	glRenderbufferStorage (GL_RENDERBUFFER, GL_DEPTH_COMPONENT24, gl_width, gl_height);
	glGenFramebuffers (1, &scene_framebuffer);
	glBindFramebuffer (GL_FRAMEBUFFER, scene_framebuffer);
	glFramebufferTexture2D (GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, scene_texture, 0);
	glFramebufferRenderbuffer (GL_FRAMEBUFFER, GL_DEPTH_ATTACHMENT, GL_RENDERBUFFER, scene_depth);
	glClearColor (0, 0, 0, 1);
	glClear (GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);
	glBindFramebuffer (GL_FRAMEBUFFER, 0);

	glGenTextures (1, &overlay_texture);
	GL_Bind (TU_SECOND, GL_TEXTURE_2D, overlay_texture);
	glTexStorage2D (GL_TEXTURE_2D, 1, GL_R8, gl_width, gl_height);
	glTexParameteri (GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST);
	glTexParameteri (GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);

	view_rect.width = view_rect.height = 0;
}

//=============================================================================

// Whether a liquid is drawn translucent this frame.
static qboolean GL_LiquidsTranslucent (void)
{
	return r_wateralpha.value < 1 || (r_slimealpha.value > 0 && r_slimealpha.value < 1)
		|| (r_lavaalpha.value > 0 && r_lavaalpha.value < 1) || (r_telealpha.value > 0 && r_telealpha.value < 1);
}

/*
=============
GL_MarkLeaves

Marks the leaves the view's leaf sees, as R_MarkLeaves does, and while a
liquid is translucent those it sees through them too (Mod_WaterPVS), on a
map vised with them opaque.
=============
*/
static void GL_MarkLeaves (void)
{
	qboolean	through = r_watervis.value && GL_LiquidsTranslucent ();
	mnode_t		*node;
	byte		*vis;
	int			i;

	if (r_viewleaf == marked_leaf && through == marked_through && r_visframecount == marked_frame)
		return;
	r_visframecount++;
	vis = through ? Mod_WaterPVS (r_viewleaf, cl.worldmodel) : Mod_LeafPVS (r_viewleaf, cl.worldmodel);
	for (i = 0 ; i < cl.worldmodel->numleafs ; i++)
	{
		if (!(vis[i >> 3] & (1 << (i & 7))))
			continue;
		for (node = (mnode_t *) &cl.worldmodel->leafs[i + 1] ; node && node->visframe != r_visframecount ; node = node->parent)
			node->visframe = r_visframecount;
	}
	marked_leaf = r_viewleaf;
	marked_through = through;
	marked_frame = r_visframecount;
}

/*
=============
GL_SetupView

The view as R_SetupFrame sets it up: the cheats a server with others
forbids, the light styles, the frame's count, the view's axes and its
leaf, whether it is under water, and the leaves its leaf sees; then its
matrices and frustum.
=============
*/
static void GL_SetupView (void)
{
	static float	oldbright, oldambient;
	float			view[16], proj[16];
	float			tanx, tany, znear = 1, zfar = 16384;
	int				i;

	if (cl.maxclients > 1)
	{
		Cvar_Set ("r_fullbright", "0");
		Cvar_Set ("r_ambient", "0");
	}
	r_refdef.ambientlight = r_ambient.value;
	if (r_refdef.ambientlight < 0)
		r_refdef.ambientlight = 0;
	if (r_fullbright.value != oldbright || r_ambient.value != oldambient)
	{
		oldbright = r_fullbright.value;
		oldambient = r_ambient.value;
		gl_lightgen++;
	}

	R_AnimateLight ();
	r_framecount++;

	VectorCopy (r_refdef.vieworg, modelorg);
	VectorCopy (r_refdef.vieworg, r_origin);
	AngleVectors (r_refdef.viewangles, vpn, vright, vup);

	r_oldviewleaf = r_viewleaf;
	r_viewleaf = Mod_PointInLeaf (r_origin, cl.worldmodel);
	r_dowarp = r_waterwarp.value && (r_viewleaf->contents <= CONTENTS_WATER);
	GL_MarkLeaves ();

	// The software renderer's projection: fov_x across the view, square
	// pixels; near enough that a surface the eye is close to, as water's
	// above a swimmer, is not cut away.
	tanx = r_refdef.horizontalFieldOfView / 2;
	tany = tanx * r_refdef.vrect.height / r_refdef.vrect.width;
	gl_xscale = r_refdef.vrect.width / r_refdef.horizontalFieldOfView;

	memset (proj, 0, sizeof (proj));
	proj[0] = 1 / tanx;
	proj[5] = 1 / tany;
	proj[10] = -(zfar + znear) / (zfar - znear);
	proj[11] = -1;
	proj[14] = -2 * zfar * znear / (zfar - znear);

	for (i = 0 ; i < 3 ; i++)
	{
		view[i * 4 + 0] = vright[i];
		view[i * 4 + 1] = vup[i];
		view[i * 4 + 2] = -vpn[i];
		view[i * 4 + 3] = 0;
	}
	view[12] = -DotProduct (vright, r_origin);
	view[13] = -DotProduct (vup, r_origin);
	view[14] = DotProduct (vpn, r_origin);
	view[15] = 1;
	GL_MatMul (proj, view, gl_viewproj);

	// left, right, bottom and top: the fourth row plus or minus the first or
	// the second
	for (i = 0 ; i < 4 ; i++)
	{
		frustum[0][i] = gl_viewproj[i * 4 + 3] + gl_viewproj[i * 4 + 0];
		frustum[1][i] = gl_viewproj[i * 4 + 3] - gl_viewproj[i * 4 + 0];
		frustum[2][i] = gl_viewproj[i * 4 + 3] + gl_viewproj[i * 4 + 1];
		frustum[3][i] = gl_viewproj[i * 4 + 3] - gl_viewproj[i * 4 + 1];
	}
}

void GL_RenderView (void)
{
	byte	*pal;
	int		y, i;

	if (!cl_entities[0].model || !cl.worldmodel)
		Sys_Error ("R_RenderView: NULL worldmodel");

	GL_Resize ();
	GL_SetupView ();

	view_rect = r_refdef.vrect;
	view_warped = r_dowarp;

	glBindFramebuffer (GL_FRAMEBUFFER, scene_framebuffer);
	glViewport (view_rect.x, gl_height - view_rect.y - view_rect.height, view_rect.width, view_rect.height);
	// Where nothing is drawn, r_clearcolor shows, as in the software renderer.
	pal = host_basepal + ((int) r_clearcolor.value & 0xff) * 3;
	glClearColor (pal[0] / 255.0, pal[1] / 255.0, pal[2] / 255.0, 1);
	glDepthMask (GL_TRUE);
	glClear (GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);
	glEnable (GL_DEPTH_TEST);
	GL_Anisotropy ();
	GL_LinearSampler (TU_TEXTURE, false);
	for (i = 0 ; i < P_COUNT ; i++)
		if (gl_programs[i].u[UF_LITPALETTE] >= 0)
		{
			glUseProgram (gl_programs[i].id);
			glUniform1i (gl_programs[i].u[UF_LITPALETTE], r_litpalette.value != 0);
		}
	GL_LinearSampler (TU_SECOND, false);

	GLW_DrawWorld ();
	GLM_DrawEntities ();
	GLM_DrawViewModel ();
	GLM_BeginParticles ();
	R_DrawParticles ();
	GLM_EndParticles ();
	GLW_DrawWater ();

	glDisable (GL_DEPTH_TEST);
	glBindSampler (TU_TEXTURE, 0);
	glBindSampler (TU_SECOND, 0);
	glBindFramebuffer (GL_FRAMEBUFFER, 0);

	V_SetContentsColor (r_viewleaf->contents);

	// The 2D drawn over the view from here on shows it where it leaves 255.
	for (y = view_rect.y ; y < view_rect.y + view_rect.height ; y++)
		memset (vid.buffer + y * vid.rowbytes + view_rect.x, 255, view_rect.width);
}

void GL_NewMap (void)
{
	gl_gen++;
	marked_leaf = NULL;
	if (started)
		GLW_NewMap ();
}

/*
=============
GL_Present

The frame on the canvas: the 2D over the 3D view, warped under water,
shifted and put through the gamma table.
=============
*/
static void GL_Present (void)
{
	glprogram_t	*p;
	float		shifts[NUM_CSHIFTS * 4];
	float		scale;
	int			i;

	GL_Resize ();
	GL_Bind (TU_SECOND, GL_TEXTURE_2D, overlay_texture);
	glTexSubImage2D (GL_TEXTURE_2D, 0, 0, 0, gl_width, gl_height, GL_RED, GL_UNSIGNED_BYTE, vid.buffer);
	if (memcmp (gamma_uploaded, gammatable, sizeof (gamma_uploaded)))
	{
		memcpy (gamma_uploaded, gammatable, sizeof (gamma_uploaded));
		GL_Bind (TU_GAMMA, GL_TEXTURE_2D, gamma_texture);
		glTexSubImage2D (GL_TEXTURE_2D, 0, 0, 0, 256, 1, GL_RED, GL_UNSIGNED_BYTE, gamma_uploaded);
	}
	GL_Bind (TU_TEXTURE, GL_TEXTURE_2D, scene_texture);

	for (i = 0 ; i < NUM_CSHIFTS ; i++)
	{
		shifts[i * 4 + 0] = cl.cshifts[i].destcolor[0];
		shifts[i * 4 + 1] = cl.cshifts[i].destcolor[1];
		shifts[i * 4 + 2] = cl.cshifts[i].destcolor[2];
		shifts[i * 4 + 3] = cl.cshifts[i].percent;
	}

	glBindFramebuffer (GL_FRAMEBUFFER, 0);
	glViewport (0, 0, gl_width, gl_height);
	glDisable (GL_DEPTH_TEST);
	glDisable (GL_BLEND);
	p = GL_UseProgram (P_FINAL);
	glUniform2f (p->u[UF_FRAME], gl_width, gl_height);
	glUniform4i (p->u[UF_VRECT], view_rect.x, view_rect.y, view_rect.width, view_rect.height);
	glUniform4fv (p->u[UF_SHIFTS], NUM_CSHIFTS, shifts);
	// The software renderer's warp is 3 pixels high and 128 long, made for
	// a frame of 200 lines; it is as large on this frame.
	scale = gl_height / 200.0;
	glUniform4f (p->u[UF_WARP], view_warped ? 1 : 0, 3 * scale, 128 * scale,
		(float) ((int) (cl.time * 20) & 127) * scale);
	glDrawArrays (GL_TRIANGLES, 0, 3);
}

qboolean GL_EndFrame (void)
{
	qboolean	drawn = gl_drawing;
	qboolean	wanted;

	if (gl_drawing)
		GL_Present ();

	wanted = strcmp (vid_renderer.string, "soft") != 0;
	if (wanted && !started && !gl_failed && !starting)
	{
		// Its messages draw frames of their own (Con_Printf), in software.
		starting = true;
		if (!GL_Start ())
		{
			gl_failed = true;
			Con_Printf ("Drawing with the software renderer\n");
		}
		starting = false;
	}
	gl_drawing = wanted && started;
	gl_linear = !strcmp (gl_filter.string, "linear");
	return drawn;
}
