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
// gl_world.c -- the WebGL 2 renderer's brush models: the world and the
// models of the map (doors, lifts) and of their own files (boxes).
//
// Each BSP's surfaces are put in a vertex buffer the first time it is drawn
// on a map, from the software renderer's own model (model.c): each its
// polygon, with its texture coordinates in texels and its lightmap's. Its
// lightmaps are lit on the CPU as the software renderer lights its surface
// cache (R_BuildLightMap): the light styles, the dynamic lights and the
// bound to the colormap's rows, an unsigned short a sample, and kept in a
// texture of layers of LM_SIZE squared, lit again whenever a style a
// surface has changes or a dynamic light touches it. The textures are the
// BSP's 8-bit mip levels (the linear look's colours are made from them).
//
// The world's surfaces drawn are those of the leaves the view's leaf sees
// (R_MarkLeaves), inside the frustum and facing the view, walked front to
// back; each is put on its texture's chain, and each texture's chain is
// then one draw.

#include <string.h>

#include "gl_local.h"

// The lightmaps' texture: layers of LM_SIZE by LM_SIZE samples.
#define LM_SIZE		512
#define LM_LAYERS	32

typedef struct
{
	float			pos[3];
	float			st[2];		// texture coordinates, in texels
	float			lm[2];		// lightmap coordinates, in samples
	unsigned short	rect[4];	// the surface's lightmap: first and last sample
	unsigned short	extra[2];	// its lightmap's layer, its texture's mip adjustment
} glvert_t;

typedef struct glbrush_s
{
	int				gen;
	msurface_t		*surfaces;		// the BSP's, which its submodels share
	int				numsurfaces;
	GLuint			vao, vbo;
	GLuint			lightmap;
	int				layers;
	unsigned short	*light;			// the lightmap's samples, `channels` each
	int				channels;		// 1, or 3 with a .lit's colours
	byte			*lightdata;		// the BSP's light (model->lightdata)
	byte			*lit;			// its colours, a .lit's: three bytes for each of its
	int				dirty[LM_LAYERS][2];	// rows of a layer lit since put on the texture
	int				lightgen;
	struct glbrush_s	*next;
} glbrush_t;

// A texture's surfaces to draw in a pass.
typedef struct
{
	texture_t	*texture;
	int			flags;		// its surfaces' SURF_DRAWSKY and SURF_DRAWTURB
	int			first, count;
} glbatch_t;

#define MAX_BATCHES	1024

static glbrush_t	*brushes;
static GLuint		index_buffer;
static unsigned		*indices;
static int			index_room, index_count;
static texture_t	*chained[MAX_BATCHES];
static int			num_chained;
static glbatch_t	batches[MAX_BATCHES];
static int			num_batches;

// The world's water, slime, lava and teleporters, drawn after the rest
// when they are translucent (GLW_LiquidAlpha).
static msurface_t	*water_chain;
static glbrush_t	*water_brush;
static qboolean		in_world;

// The texture names made for this map, gone with it.
static GLuint		*map_textures;
static int			num_map_textures, map_textures_room;

GLuint GLW_Keep (GLuint texture)
{
	if (num_map_textures == map_textures_room)
	{
		map_textures_room = map_textures_room ? map_textures_room * 2 : 256;
		map_textures = realloc (map_textures, map_textures_room * sizeof (GLuint));
	}
	map_textures[num_map_textures++] = texture;
	return texture;
}

void GLW_NewMap (void)
{
	glbrush_t	*b, *next;

	for (b = brushes ; b ; b = next)
	{
		next = b->next;
		glDeleteVertexArrays (1, &b->vao);
		glDeleteBuffers (1, &b->vbo);
		glDeleteTextures (1, &b->lightmap);
		free (b->light);
		free (b->lit);
		free (b);
	}
	brushes = NULL;
	if (num_map_textures)
		glDeleteTextures (num_map_textures, map_textures);
	num_map_textures = 0;
	water_chain = NULL;
}

//=============================================================================
// Textures

/*
=============
GLW_Texture

Makes what the texture is drawn with this frame, nearest or linear, the
first time it is: a sky's two layers, the right half of its texture the
back one and the left half the front, transparent where it is 0.
=============
*/
static void GLW_Texture (texture_t *t, int flags)
{
	byte	*levels[MIPLEVELS];
	byte	back[128 * 128], front[128 * 128];
	byte	*src;
	int		i, y;

	if (t->gl_gen != gl_gen)
	{
		t->gl_gen = gl_gen;
		t->gl_index = t->gl_rgba = t->gl_front = t->gl_frontrgba = 0;
	}
	if (gl_linear ? t->gl_rgba : t->gl_index)
		return;

	if (flags & SURF_DRAWSKY)
	{
		src = (byte *) t + t->offsets[0];
		for (y = 0 ; y < 128 ; y++)
		{
			memcpy (front + y * 128, src + y * t->width, 128);
			memcpy (back + y * 128, src + y * t->width + 128, 128);
		}
		if (gl_linear)
		{
			t->gl_rgba = GLW_Keep (GL_ColourTexture (128, 128, back, CT_MIPMAP | CT_REPEAT));
			t->gl_frontrgba = GLW_Keep (GL_ColourTexture (128, 128, front, CT_MIPMAP | CT_REPEAT | CT_ZERO));
		}
		else
		{
			levels[0] = back;
			t->gl_index = GLW_Keep (GL_IndexTexture (128, 128, 1, levels));
			levels[0] = front;
			t->gl_front = GLW_Keep (GL_IndexTexture (128, 128, 1, levels));
		}
		return;
	}

	if (gl_linear)
		t->gl_rgba = GLW_Keep (GL_ColourTexture (t->width, t->height, (byte *) t + t->offsets[0],
			CT_MIPMAP | CT_REPEAT | ((flags & SURF_DRAWTURB) ? 0 : CT_FULLBRIGHT)));
	else
	{
		for (i = 0 ; i < MIPLEVELS ; i++)
			levels[i] = (byte *) t + t->offsets[i];
		t->gl_index = GLW_Keep (GL_IndexTexture (t->width, t->height, MIPLEVELS, levels));
	}
}

//=============================================================================
// Lightmaps

/*
=============
GLW_AddDynamicLights

The dynamic lights touching the surface, added to its samples as
R_AddDynamicLights adds them.
=============
*/
static void GLW_AddDynamicLights (msurface_t *surf, unsigned *blocklights)
{
	int			lnum, i, s, t, sd, td, smax, tmax;
	float		dist, rad, minlight;
	vec3_t		impact, local;
	mtexinfo_t	*tex = surf->texinfo;

	smax = (surf->extents[0] >> 4) + 1;
	tmax = (surf->extents[1] >> 4) + 1;
	for (lnum = 0 ; lnum < MAX_DLIGHTS ; lnum++)
	{
		if (!(surf->dlightbits & (1 << lnum)))
			continue;
		rad = cl_dlights[lnum].radius;
		dist = DotProduct (cl_dlights[lnum].origin, surf->plane->normal) - surf->plane->dist;
		rad -= fabs (dist);
		minlight = cl_dlights[lnum].minlight;
		if (rad < minlight)
			continue;
		minlight = rad - minlight;
		for (i = 0 ; i < 3 ; i++)
			impact[i] = cl_dlights[lnum].origin[i] - surf->plane->normal[i] * dist;
		local[0] = DotProduct (impact, tex->vecs[0]) + tex->vecs[0][3] - surf->texturemins[0];
		local[1] = DotProduct (impact, tex->vecs[1]) + tex->vecs[1][3] - surf->texturemins[1];
		for (t = 0 ; t < tmax ; t++)
		{
			td = local[1] - t * 16;
			if (td < 0)
				td = -td;
			for (s = 0 ; s < smax ; s++)
			{
				sd = local[0] - s * 16;
				if (sd < 0)
					sd = -sd;
				if (sd > td)
					dist = sd + (td >> 1);
				else
					dist = td + (sd >> 1);
				if (dist < minlight)
					blocklights[t * smax + s] += (rad - dist) * 256;
			}
		}
	}
}

/*
=============
GLW_BuildLightmap

Lights the surface's samples as R_BuildLightMap does, each the colormap's
row in 256ths, 0 brightest: the light styles' values times the lightmaps,
the dynamic lights, then bounded, inverted and shifted.
=============
*/
static void GLW_BuildLightmap (glbrush_t *b, msurface_t *surf)
{
	unsigned		blocklights[3][18 * 18];
	unsigned short	*dest;
	byte			*lightmap;
	int				smax, tmax, size, i, s, t, c, maps, value, layer, channels = b->channels;

	smax = (surf->extents[0] >> 4) + 1;
	tmax = (surf->extents[1] >> 4) + 1;
	size = smax * tmax;
	surf->gl_dlit = surf->dlightframe == r_framecount;
	for (maps = 0 ; maps < MAXLIGHTMAPS ; maps++)
		surf->gl_cached[maps] = surf->styles[maps] == 255 ? 0 : d_lightstylevalue[surf->styles[maps]];

	// Each colour of a .lit as the BSP's own light; dynamic lights are white.
	for (c = 0 ; c < channels ; c++)
	{
		if (r_fullbright.value || !cl.worldmodel->lightdata)
		{
			memset (blocklights[c], 0, size * sizeof (unsigned));
			continue;
		}
		for (i = 0 ; i < size ; i++)
			blocklights[c][i] = r_refdef.ambientlight << 8;
		lightmap = surf->samples;
		if (lightmap)
		{
			if (channels == 3)
				lightmap = b->lit + (lightmap - b->lightdata) * 3 + c;
			for (maps = 0 ; maps < MAXLIGHTMAPS && surf->styles[maps] != 255 ; maps++)
			{
				value = d_lightstylevalue[surf->styles[maps]];
				for (i = 0 ; i < size ; i++)
					blocklights[c][i] += lightmap[i * channels] * value;
				lightmap += size * channels;
			}
		}
		if (surf->gl_dlit)
			GLW_AddDynamicLights (surf, blocklights[c]);
		for (i = 0 ; i < size ; i++)
		{
			value = (255 * 256 - (int) blocklights[c][i]) >> (8 - VID_CBITS);
			if (value < (1 << 6))
				value = (1 << 6);
			blocklights[c][i] = value;
		}
	}

	layer = surf->gl_light[2];
	dest = b->light + ((layer * LM_SIZE + surf->gl_light[1]) * LM_SIZE + surf->gl_light[0]) * channels;
	for (t = 0 ; t < tmax ; t++, dest += LM_SIZE * channels)
		for (s = 0 ; s < smax ; s++)
			for (c = 0 ; c < channels ; c++)
				dest[s * channels + c] = blocklights[c][t * smax + s];
	if (b->dirty[layer][0] > surf->gl_light[1])
		b->dirty[layer][0] = surf->gl_light[1];
	if (b->dirty[layer][1] < surf->gl_light[1] + tmax)
		b->dirty[layer][1] = surf->gl_light[1] + tmax;
}

/*
=============
GLW_LiquidAlpha

How opaque a liquid's surface is drawn: r_lavaalpha, r_slimealpha or
r_telealpha by its texture's name, as QuakeSpasm has them, and r_wateralpha
for water and for those of them at 0.
=============
*/
float GLW_LiquidAlpha (texture_t *t)
{
	float	alpha = 0;

	if (!Q_strncasecmp (t->name, "*lava", 5))
		alpha = r_lavaalpha.value;
	else if (!Q_strncasecmp (t->name, "*tele", 5))
		alpha = r_telealpha.value;
	else if (!Q_strncasecmp (t->name, "*slime", 6))
		alpha = r_slimealpha.value;
	if (alpha <= 0)
		alpha = r_wateralpha.value;
	return alpha < 0 ? 0 : alpha > 1 ? 1 : alpha;
}

static qboolean GLW_Lit (msurface_t *surf)
{
	return !(surf->flags & (SURF_DRAWSKY | SURF_DRAWTURB));
}

/*
=============
GLW_CheckLightmap

Lights the surface again if what lights it changed since it was lit.
=============
*/
static void GLW_CheckLightmap (glbrush_t *b, msurface_t *surf)
{
	int		maps;

	if (surf->dlightframe == r_framecount || surf->gl_dlit)
	{
		GLW_BuildLightmap (b, surf);
		return;
	}
	for (maps = 0 ; maps < MAXLIGHTMAPS ; maps++)
	{
		if (surf->gl_cached[maps] != (surf->styles[maps] == 255 ? 0 : d_lightstylevalue[surf->styles[maps]]))
		{
			GLW_BuildLightmap (b, surf);
			return;
		}
	}
}

// The rows of each layer lit since, put on the texture.
static void GLW_UploadLightmaps (glbrush_t *b)
{
	int		layer, lo, hi;

	GL_Bind (TU_LIGHTMAP, GL_TEXTURE_2D_ARRAY, b->lightmap);
	for (layer = 0 ; layer < b->layers ; layer++)
	{
		lo = b->dirty[layer][0];
		hi = b->dirty[layer][1];
		if (lo >= hi)
			continue;
		glTexSubImage3D (GL_TEXTURE_2D_ARRAY, 0, 0, lo, layer, LM_SIZE, hi - lo, 1,
			b->channels == 3 ? GL_RGB_INTEGER : GL_RED_INTEGER, GL_UNSIGNED_SHORT,
			b->light + (layer * LM_SIZE + lo) * LM_SIZE * b->channels);
		b->dirty[layer][0] = LM_SIZE;
		b->dirty[layer][1] = 0;
	}
}

//=============================================================================
// Building a BSP's buffers

/*
=============
GLW_AllocLightmap

A place for a w by h lightmap in one of the layers: the lowest row that
fits it, each column's height kept.
=============
*/
static qboolean GLW_AllocLightmap (unsigned short (*allocated)[LM_SIZE], int *layers, int w, int h, unsigned short *out)
{
	int		layer, i, j, best, best2;

	for (layer = 0 ; layer < LM_LAYERS ; layer++)
	{
		if (layer == *layers)
		{
			memset (allocated[layer], 0, sizeof (allocated[layer]));
			(*layers)++;
		}
		best = LM_SIZE;
		for (i = 0 ; i <= LM_SIZE - w ; i++)
		{
			best2 = 0;
			for (j = 0 ; j < w ; j++)
			{
				if (allocated[layer][i + j] >= best)
					break;
				if (allocated[layer][i + j] > best2)
					best2 = allocated[layer][i + j];
			}
			if (j == w)
			{
				out[0] = i;
				out[1] = best = best2;
			}
		}
		if (best + h > LM_SIZE)
			continue;
		for (i = 0 ; i < w ; i++)
			allocated[layer][out[0] + i] = best + h;
		out[2] = layer;
		return true;
	}
	return false;
}

// How much of the BSP's light its surfaces use: as far as their samples reach.
static int GLW_LightSize (model_t *model)
{
	msurface_t	*surf;
	int			i, maps, end, size = 0;

	for (i = 0, surf = model->surfaces ; i < model->numsurfaces ; i++, surf++)
	{
		if (!surf->samples || !GLW_Lit (surf))
			continue;
		for (maps = 0 ; maps < MAXLIGHTMAPS && surf->styles[maps] != 255 ; maps++)
			;
		end = surf->samples - model->lightdata
			+ maps * ((surf->extents[0] >> 4) + 1) * ((surf->extents[1] >> 4) + 1);
		if (end > size)
			size = end;
	}
	return size;
}

/*
=============
GLW_LoadLit

The colours of the BSP's light, from a .lit beside it (maps/<map>.lit, as
QuakeSpasm looks for it): "QLIT", version 1, then three bytes for each byte
of the BSP's light. Without one, or with one of another size, the light is
the BSP's own, white.
=============
*/
static void GLW_LoadLit (glbrush_t *b, model_t *model)
{
	char	name[MAX_QPATH];
	byte	*data;
	int		mark, size, lightsize;
	model_t	*named = model;

	b->channels = 1;
	b->lightdata = model->lightdata;
	b->lit = NULL;
	// a submodel ("*1") is its BSP's: the world's
	if (model->name[0] == '*' && cl.worldmodel && model->surfaces == cl.worldmodel->surfaces)
		named = cl.worldmodel;
	if (!model->lightdata || named->name[0] == '*')
		return;
	COM_StripExtension (named->name, name);
	strcat (name, ".lit");
	mark = Hunk_LowMark ();
	data = COM_LoadHunkFile (name);
	if (!data)
		return;
	size = com_filesize;
	lightsize = GLW_LightSize (named);
	// QuakeSpasm holds it to the BSP's light lump's size, which the model
	// does not keep: it covers every surface's samples here.
	if (size >= 8 && !memcmp (data, "QLIT", 4) && LittleLong (((int *) data)[1]) == 1
		&& (size - 8) % 3 == 0 && size >= 8 + lightsize * 3)
	{
		b->lit = malloc (size - 8);
		memcpy (b->lit, data + 8, size - 8);
		b->channels = 3;
		Con_DPrintf ("%s: coloured light\n", name);
	}
	else
		Con_Printf ("%s is not a .lit of %s\n", name, named->name);
	Hunk_FreeToLowMark (mark);
}

static glbrush_t *GLW_Build (model_t *model)
{
	static unsigned short	allocated[LM_LAYERS][LM_SIZE];
	glbrush_t		*b;
	glvert_t		*verts, *v;
	msurface_t		*surf;
	mtexinfo_t		*tex;
	medge_t			*edge;
	float			*pos;
	int				numverts, i, j, e, smax, tmax, layer;

	b = calloc (1, sizeof (glbrush_t));
	b->gen = gl_gen;
	b->lightgen = gl_lightgen;
	b->surfaces = model->surfaces;
	b->numsurfaces = model->numsurfaces;

	numverts = 0;
	for (i = 0 ; i < model->numsurfaces ; i++)
		numverts += model->surfaces[i].numedges;
	verts = v = malloc (numverts * sizeof (glvert_t));

	numverts = 0;
	for (i = 0 ; i < model->numsurfaces ; i++)
	{
		surf = &model->surfaces[i];
		tex = surf->texinfo;
		smax = (surf->extents[0] >> 4) + 1;
		tmax = (surf->extents[1] >> 4) + 1;
		surf->gl_light[0] = surf->gl_light[1] = surf->gl_light[2] = 0;
		if (GLW_Lit (surf) && !GLW_AllocLightmap (allocated, &b->layers, smax, tmax, surf->gl_light))
			Sys_Error ("GLW_Build: %s has more lightmaps than %d layers", model->name, LM_LAYERS);

		surf->gl_vertex = numverts;
		for (j = 0 ; j < surf->numedges ; j++, v++)
		{
			e = model->surfedges[surf->firstedge + j];
			edge = &model->edges[e >= 0 ? e : -e];
			pos = model->vertexes[e >= 0 ? edge->v[0] : edge->v[1]].position;
			VectorCopy (pos, v->pos);
			v->st[0] = DotProduct (pos, tex->vecs[0]) + tex->vecs[0][3];
			v->st[1] = DotProduct (pos, tex->vecs[1]) + tex->vecs[1][3];
			v->lm[0] = surf->gl_light[0] + (v->st[0] - surf->texturemins[0]) / 16;
			v->lm[1] = surf->gl_light[1] + (v->st[1] - surf->texturemins[1]) / 16;
			v->rect[0] = surf->gl_light[0];
			v->rect[1] = surf->gl_light[1];
			v->rect[2] = surf->gl_light[0] + smax - 1;
			v->rect[3] = surf->gl_light[1] + tmax - 1;
			v->extra[0] = surf->gl_light[2];
			v->extra[1] = tex->mipadjust;
		}
		numverts += surf->numedges;
	}

	glGenVertexArrays (1, &b->vao);
	glBindVertexArray (b->vao);
	glGenBuffers (1, &b->vbo);
	glBindBuffer (GL_ARRAY_BUFFER, b->vbo);
	glBufferData (GL_ARRAY_BUFFER, numverts * sizeof (glvert_t), verts, GL_STATIC_DRAW);
	free (verts);
	glEnableVertexAttribArray (0);
	glVertexAttribPointer (0, 3, GL_FLOAT, GL_FALSE, sizeof (glvert_t), (void *) offsetof (glvert_t, pos));
	glEnableVertexAttribArray (1);
	glVertexAttribPointer (1, 2, GL_FLOAT, GL_FALSE, sizeof (glvert_t), (void *) offsetof (glvert_t, st));
	glEnableVertexAttribArray (2);
	glVertexAttribPointer (2, 2, GL_FLOAT, GL_FALSE, sizeof (glvert_t), (void *) offsetof (glvert_t, lm));
	glEnableVertexAttribArray (3);
	glVertexAttribIPointer (3, 4, GL_UNSIGNED_SHORT, sizeof (glvert_t), (void *) offsetof (glvert_t, rect));
	glEnableVertexAttribArray (4);
	glVertexAttribIPointer (4, 2, GL_UNSIGNED_SHORT, sizeof (glvert_t), (void *) offsetof (glvert_t, extra));
	if (!index_buffer)
		glGenBuffers (1, &index_buffer);
	glBindBuffer (GL_ELEMENT_ARRAY_BUFFER, index_buffer);
	glBindVertexArray (0);

	if (!b->layers)
		b->layers = 1;
	GLW_LoadLit (b, model);
	b->light = calloc (b->layers * LM_SIZE * LM_SIZE * b->channels, sizeof (unsigned short));
	for (layer = 0 ; layer < b->layers ; layer++)
	{
		b->dirty[layer][0] = LM_SIZE;
		b->dirty[layer][1] = 0;
	}
	for (i = 0 ; i < model->numsurfaces ; i++)
		if (GLW_Lit (&model->surfaces[i]))
			GLW_BuildLightmap (b, &model->surfaces[i]);
	glGenTextures (1, &b->lightmap);
	GL_Bind (TU_LIGHTMAP, GL_TEXTURE_2D_ARRAY, b->lightmap);
	glTexStorage3D (GL_TEXTURE_2D_ARRAY, 1, b->channels == 3 ? GL_RGB16UI : GL_R16UI, LM_SIZE, LM_SIZE, b->layers);
	glTexParameteri (GL_TEXTURE_2D_ARRAY, GL_TEXTURE_MIN_FILTER, GL_NEAREST);
	glTexParameteri (GL_TEXTURE_2D_ARRAY, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
	GLW_UploadLightmaps (b);

	b->next = brushes;
	brushes = b;
	return b;
}

// The model's BSP's buffers, built the first time it is drawn on the map.
/*
=============
GLW_LightTint

The colour of the light below `point` on the world, as R_LightPoint finds
its brightness: each colour of the .lit's light there against the BSP's
own, (1, 1, 1) on a map without one. An alias model there is lit in it.
=============
*/
static qboolean GLW_TintNode (glbrush_t *b, mnode_t *node, vec3_t start, vec3_t end, vec3_t tint)
{
	float		front, back, frac, mono, rgb[3];
	int			side, i, c, s, t, ds, dt, maps, size, offset, scale;
	vec3_t		mid;
	msurface_t	*surf;
	mtexinfo_t	*tex;

	while (node->contents >= 0)
	{
		front = DotProduct (start, node->plane->normal) - node->plane->dist;
		back = DotProduct (end, node->plane->normal) - node->plane->dist;
		side = front < 0;
		if ((back < 0) == side)
		{
			node = node->children[side];
			continue;
		}
		frac = front / (front - back);
		for (i = 0 ; i < 3 ; i++)
			mid[i] = start[i] + (end[i] - start[i]) * frac;
		if (GLW_TintNode (b, node->children[side], start, mid, tint))
			return true;
		surf = cl.worldmodel->surfaces + node->firstsurface;
		for (i = 0 ; i < node->numsurfaces ; i++, surf++)
		{
			if (surf->flags & SURF_DRAWTILED)
				continue;
			tex = surf->texinfo;
			s = DotProduct (mid, tex->vecs[0]) + tex->vecs[0][3];
			t = DotProduct (mid, tex->vecs[1]) + tex->vecs[1][3];
			if (s < surf->texturemins[0] || t < surf->texturemins[1])
				continue;
			ds = s - surf->texturemins[0];
			dt = t - surf->texturemins[1];
			if (ds > surf->extents[0] || dt > surf->extents[1])
				continue;
			if (!surf->samples)
				return true;
			size = ((surf->extents[0] >> 4) + 1) * ((surf->extents[1] >> 4) + 1);
			offset = surf->samples - b->lightdata + (dt >> 4) * ((surf->extents[0] >> 4) + 1) + (ds >> 4);
			mono = rgb[0] = rgb[1] = rgb[2] = 0;
			for (maps = 0 ; maps < MAXLIGHTMAPS && surf->styles[maps] != 255 ; maps++, offset += size)
			{
				scale = d_lightstylevalue[surf->styles[maps]];
				mono += b->lightdata[offset] * scale;
				for (c = 0 ; c < 3 ; c++)
					rgb[c] += b->lit[offset * 3 + c] * scale;
			}
			for (c = 0 ; c < 3 ; c++)
				tint[c] = mono > 0 ? rgb[c] / mono : 1;
			return true;
		}
		start = mid;
		node = node->children[!side];
	}
	return false;
}

qboolean GLW_Coloured (void)
{
	glbrush_t	*b;

	for (b = brushes ; b ; b = b->next)
		if (b->surfaces == cl.worldmodel->surfaces && b->gen == gl_gen)
			return b->channels == 3;
	return false;
}

void GLW_LightTint (vec3_t point, vec3_t tint)
{
	glbrush_t	*b;
	vec3_t		end;
	int			c;

	tint[0] = tint[1] = tint[2] = 1;
	for (b = brushes ; b ; b = b->next)
		if (b->surfaces == cl.worldmodel->surfaces && b->gen == gl_gen)
			break;
	if (!b || b->channels != 3)
		return;
	VectorCopy (point, end);
	end[2] -= 2048;
	GLW_TintNode (b, cl.worldmodel->nodes, point, end, tint);
	for (c = 0 ; c < 3 ; c++)
		tint[c] = tint[c] < 0 ? 0 : tint[c] > 3 ? 3 : tint[c];
}

static glbrush_t *GLW_Brush (model_t *model)
{
	glbrush_t	*b;
	int			i;

	for (b = brushes ; b ; b = b->next)
		if (b->surfaces == model->surfaces && b->gen == gl_gen)
			break;
	if (!b)
		b = GLW_Build (model);
	if (b->lightgen != gl_lightgen)
	{
		b->lightgen = gl_lightgen;
		for (i = 0 ; i < b->numsurfaces ; i++)
			if (GLW_Lit (&b->surfaces[i]))
				GLW_BuildLightmap (b, &b->surfaces[i]);
	}
	return b;
}

//=============================================================================
// Drawing

// Puts the surface on its texture's chain, lit as it is now.
static void GLW_Chain (glbrush_t *b, msurface_t *surf)
{
	texture_t	*t = surf->texinfo->texture;

	if (GLW_Lit (surf))
		GLW_CheckLightmap (b, surf);
	if ((surf->flags & SURF_DRAWTURB) && in_world && GLW_LiquidAlpha (t) < 1)
	{
		surf->gl_next = water_chain;
		water_chain = surf;
		return;
	}
	if (!t->gl_chain)
	{
		if (num_chained == MAX_BATCHES)
			return;
		chained[num_chained++] = t;
	}
	surf->gl_next = t->gl_chain;
	t->gl_chain = surf;
}

static void GLW_AddIndices (msurface_t *surf)
{
	int		i, first = surf->gl_vertex;

	if (index_count + (surf->numedges - 2) * 3 > index_room)
	{
		index_room = (index_count + (surf->numedges - 2) * 3) * 2;
		indices = realloc (indices, index_room * sizeof (unsigned));
	}
	for (i = 2 ; i < surf->numedges ; i++)
	{
		indices[index_count++] = first;
		indices[index_count++] = first + i - 1;
		indices[index_count++] = first + i;
	}
}

// The chains' surfaces as batches of indices, a batch a texture, and the
// chains emptied.
static void GLW_Batch (void)
{
	msurface_t	*surf;
	glbatch_t	*batch;
	int			i;

	index_count = 0;
	num_batches = 0;
	for (i = 0 ; i < num_chained ; i++)
	{
		batch = &batches[num_batches++];
		batch->texture = chained[i];
		batch->flags = chained[i]->gl_chain->flags & (SURF_DRAWSKY | SURF_DRAWTURB);
		batch->first = index_count;
		for (surf = chained[i]->gl_chain ; surf ; surf = surf->gl_next)
			GLW_AddIndices (surf);
		batch->count = index_count - batch->first;
		chained[i]->gl_chain = NULL;
	}
	num_chained = 0;
}

static void GLW_DrawBatch (glbatch_t *batch)
{
	glDrawElements (GL_TRIANGLES, batch->count, GL_UNSIGNED_INT, (void *) (batch->first * sizeof (unsigned)));
}

/*
=============
GLW_DrawBatches

The batches, with the model's lightmaps: the lit surfaces, then the
turbulent ones (translucent as GLW_LiquidAlpha says with `translucent`,
else opaque), then the sky. Each
texture is the one its animation shows now (R_TextureAnimation, for
currententity).
=============
*/
static void GLW_DrawBatches (glbrush_t *b, float *mvp, qboolean translucent)
{
	float			alpha;
	extern cvar_t	d_mipscale, d_mipcap;
	glprogram_t		*p;
	texture_t		*t;
	glbatch_t		*batch;
	int				i, pass, minmip;

	if (!num_batches || !index_count)
		return;
	GLW_UploadLightmaps (b);
	glBindVertexArray (b->vao);
	glBindBuffer (GL_ELEMENT_ARRAY_BUFFER, index_buffer);
	glBufferData (GL_ELEMENT_ARRAY_BUFFER, index_count * sizeof (unsigned), indices, GL_STREAM_DRAW);

	for (pass = 0 ; pass < 3 ; pass++)
	{
		p = NULL;
		for (i = 0 ; i < num_batches ; i++)
		{
			batch = &batches[i];
			if ((pass == 0 && batch->flags) || (pass == 1 && !(batch->flags & SURF_DRAWTURB))
				|| (pass == 2 && !(batch->flags & SURF_DRAWSKY)))
				continue;
			if (!p)
			{
				if (pass == 0)
				{
					p = GL_UseProgram (gl_linear ? P_WORLD_LINEAR : P_WORLD);
					minmip = (int) d_mipcap.value;
					glUniform4f (p->u[UF_MIP], gl_xscale, 1.0 * d_mipscale.value, 0.5 * 0.8 * d_mipscale.value,
						0.25 * 0.8 * d_mipscale.value);
					glUniform1i (p->u[UF_MINMIP], minmip < 0 ? 0 : minmip > 3 ? 3 : minmip);
					glUniform1i (p->u[UF_COLOURED], b->channels == 3);
				}
				else if (pass == 1)
				{
					p = GL_UseProgram (gl_linear ? P_TURB_LINEAR : P_TURB);
					glUniform1f (p->u[UF_TIME], cl.time);
					glBlendFunc (GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);
				}
				else
				{
					p = GL_UseProgram (gl_linear ? P_SKY_LINEAR : P_SKY);
					glUniform3fv (p->u[UF_VPN], 1, vpn);
					glUniform3fv (p->u[UF_VRIGHT], 1, vright);
					glUniform3fv (p->u[UF_VUP], 1, vup);
					glUniform4f (p->u[UF_SKY], vid.width >> 1, vid.height >> 1,
						r_refdef.vrect.width >= r_refdef.vrect.height ? r_refdef.vrect.width : r_refdef.vrect.height,
						fmod (cl.time, 512.0) * 8);
					glUniform2f (p->u[UF_FRAME], gl_width, gl_height);
				}
				glUniformMatrix4fv (p->u[UF_MVP], 1, GL_FALSE, mvp);
			}
			t = batch->flags ? batch->texture : R_TextureAnimation (batch->texture);
			GLW_Texture (t, batch->flags);
			GL_Bind (TU_TEXTURE, GL_TEXTURE_2D, gl_linear ? t->gl_rgba : t->gl_index);
			if (batch->flags & SURF_DRAWSKY)
				GL_Bind (TU_SECOND, GL_TEXTURE_2D, gl_linear ? t->gl_frontrgba : t->gl_front);
			glUniform2i (p->u[UF_SIZE], t->width, t->height);
			if (pass == 1)
			{
				alpha = translucent ? GLW_LiquidAlpha (batch->texture) : 1;
				glUniform1f (p->u[UF_ALPHA], alpha);
				if (alpha < 1)
					glEnable (GL_BLEND);
				else
					glDisable (GL_BLEND);
				glDepthMask (alpha < 1 ? GL_FALSE : GL_TRUE);
			}
			GLW_DrawBatch (batch);
		}
		if (pass == 1 && p)
		{
			glDisable (GL_BLEND);
			glDepthMask (GL_TRUE);
		}
	}
	glBindVertexArray (0);
}

/*
=============
GLW_WorldNode

The node's surfaces, if the view's leaf sees it and the frustum has it,
the side the view is on first: a leaf marks its own to be drawn, and keeps
its static entities for the frame (R_StoreEfrags); a node chains those of
its plane that face the view.
=============
*/
static void GLW_WorldNode (glbrush_t *b, mnode_t *node)
{
	vec3_t		mins, maxs;
	msurface_t	*surf, **mark;
	mleaf_t		*leaf;
	mplane_t	*plane;
	float		dot;
	int			i, side;

	if (node->contents == CONTENTS_SOLID || node->visframe != r_visframecount)
		return;
	for (i = 0 ; i < 3 ; i++)
	{
		mins[i] = node->minmaxs[i];
		maxs[i] = node->minmaxs[3 + i];
	}
	if (GL_BoxOutside (mins, maxs))
		return;

	if (node->contents < 0)
	{
		leaf = (mleaf_t *) node;
		mark = leaf->firstmarksurface;
		for (i = 0 ; i < leaf->nummarksurfaces ; i++)
			mark[i]->visframe = r_framecount;
		if (leaf->efrags)
			R_StoreEfrags (&leaf->efrags);
		return;
	}

	plane = node->plane;
	if (plane->type < 3)
		dot = r_origin[plane->type] - plane->dist;
	else
		dot = DotProduct (r_origin, plane->normal) - plane->dist;
	side = dot < 0;

	GLW_WorldNode (b, node->children[side]);

	surf = cl.worldmodel->surfaces + node->firstsurface;
	for (i = 0 ; i < node->numsurfaces ; i++, surf++)
	{
		if (surf->visframe != r_framecount)
			continue;
		if (((surf->flags & SURF_PLANEBACK) != 0) != side)
			continue;
		GLW_Chain (b, surf);
	}

	GLW_WorldNode (b, node->children[!side]);
}

void GLW_DrawWorld (void)
{
	glbrush_t	*b;

	currententity = &cl_entities[0];
	b = GLW_Brush (cl.worldmodel);
	water_brush = b;
	water_chain = NULL;
	in_world = true;
	GLW_WorldNode (b, cl.worldmodel->nodes);
	in_world = false;
	GLW_Batch ();
	GLW_DrawBatches (b, gl_viewproj, false);
}

/*
=============
GLW_DrawBrushEntity

A door, a lift, a box: the surfaces of its model that face the view, lit
by the dynamic lights as R_DrawBEntitiesOnList lights them (a model of its
own file, firstmodelsurface 0, is not).
=============
*/
void GLW_DrawBrushEntity (entity_t *e)
{
	model_t		*model = e->model;
	glbrush_t	*b;
	msurface_t	*surf;
	vec3_t		mins, maxs, local, forward, right, up;
	float		mvp[16], dot;
	int			i, k;

	if (e->angles[0] || e->angles[1] || e->angles[2])
	{
		for (i = 0 ; i < 3 ; i++)
		{
			mins[i] = e->origin[i] - model->radius;
			maxs[i] = e->origin[i] + model->radius;
		}
	}
	else
	{
		VectorAdd (e->origin, model->mins, mins);
		VectorAdd (e->origin, model->maxs, maxs);
	}
	if (GL_BoxOutside (mins, maxs))
		return;

	b = GLW_Brush (model);
	currententity = e;

	VectorSubtract (r_origin, e->origin, local);
	if (e->angles[0] || e->angles[1] || e->angles[2])
	{
		AngleVectors (e->angles, forward, right, up);
		VectorCopy (local, mins);
		local[0] = DotProduct (mins, forward);
		local[1] = -DotProduct (mins, right);
		local[2] = DotProduct (mins, up);
	}

	if (model->firstmodelsurface != 0)
	{
		r_dlightframecount = r_framecount;
		for (k = 0 ; k < MAX_DLIGHTS ; k++)
		{
			if (cl_dlights[k].die < cl.time || !cl_dlights[k].radius)
				continue;
			R_MarkLights (&cl_dlights[k], 1 << k, model->nodes + model->hulls[0].firstclipnode);
		}
	}

	surf = model->surfaces + model->firstmodelsurface;
	for (i = 0 ; i < model->nummodelsurfaces ; i++, surf++)
	{
		dot = DotProduct (local, surf->plane->normal) - surf->plane->dist;
		if (((surf->flags & SURF_PLANEBACK) && dot < -BACKFACE_EPSILON)
			|| (!(surf->flags & SURF_PLANEBACK) && dot > BACKFACE_EPSILON))
			GLW_Chain (b, surf);
	}
	GLW_Batch ();
	GL_EntityMatrix (e, false, mvp);
	GLW_DrawBatches (b, mvp, true);
	currententity = &cl_entities[0];
}

// The world's water, slime and lava, translucent, after everything else.
void GLW_DrawWater (void)
{
	msurface_t	*surf;
	texture_t	*t;

	if (!water_chain)
		return;
	currententity = &cl_entities[0];
	for (surf = water_chain ; surf ; surf = water_chain)
	{
		water_chain = surf->gl_next;
		t = surf->texinfo->texture;
		if (!t->gl_chain && num_chained < MAX_BATCHES)
			chained[num_chained++] = t;
		surf->gl_next = t->gl_chain;
		t->gl_chain = surf;
	}
	GLW_Batch ();
	GLW_DrawBatches (water_brush, gl_viewproj, true);
}
