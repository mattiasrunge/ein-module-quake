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
// gl_sky.c -- the WebGL 2 renderer's skyboxes and fog, as QuakeSpasm has
// them, for the maps and mods made for it.
//
// A skybox is six pictures, gfx/env/<name><rt|bk|lf|ft|up|dn>.tga (or .pcx),
// in the game's paks or its folder, which the map's worldspawn names (sky,
// skyname), the server (svc_skybox) or the console's sky command; its sky
// surfaces then show it in place of the scrolling sky (gl_shaders.c's
// skybox). Fog is a colour over what is far, thicker with the distance
// (GL_EXP2's falloff, QuakeSpasm's density / 64), from the worldspawn's fog
// key ("density red green blue"), the server (svc_fog) or the console's fog
// command, fading from the fog before over a time it is given. The sky
// takes r_skyfog of the fog's colour (or the worldspawn's skyfog). The
// worldspawn's wateralpha, lavaalpha, slimealpha and telealpha set the
// map's liquids' (GLW_LiquidAlpha).

#include <string.h>

#include "gl_local.h"

// How much of the fog's colour the sky takes, as QuakeSpasm's r_skyfog.
cvar_t		r_skyfog = {"r_skyfog", "0.5"};

// The nearest look's fog in bands of its share, as the colormap bands the
// light; 0 smooth.
cvar_t		gl_fogbands = {"gl_fogbands", "16", true};

// The map's own liquid alphas (worldspawn keys): water, lava, slime and
// teleporters; below 0 none.
float		gl_map_alpha[4] = {-1, -1, -1, -1};

static char		sky_name[MAX_QPATH];
static qboolean	sky_changed;
static GLuint	sky_box;
static float	map_skyfog = -1;

// The fog now and the fog it fades from, and when the fade began and ends.
static float	fog_density, fog_colour[3];
static float	fog_old_density, fog_old_colour[3];
static float	fog_start, fog_end;

//=============================================================================
// Pictures

/*
=============
GLS_LoadTGA

A TGA's pixels, uncompressed or RLE, truecolour or grey, as R, G, B, A
bytes, top row first; NULL when it is none of those.
=============
*/
static byte *GLS_LoadTGA (byte *data, int size, int *width, int *height)
{
	int		type, bpp, w, h, x, y, top, count, i, run, raw;
	byte	*pixels, *in, *end = data + size, pixel[4] = {0, 0, 0, 255};

	if (size < 18)
		return NULL;
	type = data[2];
	w = data[12] | (data[13] << 8);
	h = data[14] | (data[15] << 8);
	bpp = data[16];
	top = data[17] & 0x20;
	if ((type != 2 && type != 10 && type != 3 && type != 11) || (bpp != 24 && bpp != 32 && bpp != 8) || !w || !h)
		return NULL;
	in = data + 18 + data[0];
	pixels = malloc (w * h * 4);
	count = w * h;
	run = raw = 0;
	for (i = 0 ; i < count ; i++)
	{
		if (type == 10 || type == 11)
		{
			if (!run && !raw)
			{
				if (in >= end)
					break;
				if (*in & 0x80)
					run = (*in++ & 0x7f) + 1;
				else
					raw = *in++ + 1;
				if (run && in + bpp / 8 <= end)
				{
					if (bpp == 8)
						pixel[0] = pixel[1] = pixel[2] = *in;
					else
					{
						pixel[2] = in[0];
						pixel[1] = in[1];
						pixel[0] = in[2];
						pixel[3] = bpp == 32 ? in[3] : 255;
					}
					in += bpp / 8;
				}
			}
			if (raw)
			{
				raw--;
				goto read;
			}
			run--;
		}
		else
		{
read:
			if (in + bpp / 8 > end)
				break;
			if (bpp == 8)
				pixel[0] = pixel[1] = pixel[2] = *in;
			else
			{
				pixel[2] = in[0];
				pixel[1] = in[1];
				pixel[0] = in[2];
				pixel[3] = bpp == 32 ? in[3] : 255;
			}
			in += bpp / 8;
		}
		y = i / w;
		x = i % w;
		memcpy (pixels + ((top ? y : h - 1 - y) * w + x) * 4, pixel, 4);
	}
	*width = w;
	*height = h;
	return pixels;
}

/*
=============
GLS_LoadPCX

An 8-bit PCX's pixels in its own palette, as R, G, B, A bytes.
=============
*/
static byte *GLS_LoadPCX (byte *data, int size, int *width, int *height)
{
	int		w, h, i, count, run;
	byte	*pixels, *in, *end, *palette, value;

	if (size < 128 + 769 || data[0] != 0x0a || data[3] != 8)
		return NULL;
	w = (data[8] | (data[9] << 8)) - (data[4] | (data[5] << 8)) + 1;
	h = (data[10] | (data[11] << 8)) - (data[6] | (data[7] << 8)) + 1;
	if (w <= 0 || h <= 0)
		return NULL;
	palette = data + size - 768;
	in = data + 128;
	end = palette - 1;
	pixels = malloc (w * h * 4);
	count = w * h;
	for (i = 0 ; i < count && in < end ; )
	{
		value = *in++;
		run = 1;
		if ((value & 0xc0) == 0xc0)
		{
			run = value & 0x3f;
			value = in < end ? *in++ : 0;
		}
		while (run-- && i < count)
		{
			pixels[i * 4 + 0] = palette[value * 3 + 0];
			pixels[i * 4 + 1] = palette[value * 3 + 1];
			pixels[i * 4 + 2] = palette[value * 3 + 2];
			pixels[i * 4 + 3] = 255;
			i++;
		}
	}
	*width = w;
	*height = h;
	return pixels;
}

// gfx/env/<name><suffix>.tga, or .pcx: its pixels and size, or NULL.
static byte *GLS_LoadFace (char *name, char *suffix, int *width, int *height)
{
	char	path[MAX_QPATH * 2];
	byte	*data, *pixels;
	int		mark;

	mark = Hunk_LowMark ();
	sprintf (path, "gfx/env/%s%s.tga", name, suffix);
	data = COM_LoadHunkFile (path);
	pixels = data ? GLS_LoadTGA (data, com_filesize, width, height) : NULL;
	Hunk_FreeToLowMark (mark);
	if (pixels)
		return pixels;
	sprintf (path, "gfx/env/%s%s.pcx", name, suffix);
	data = COM_LoadHunkFile (path);
	pixels = data ? GLS_LoadPCX (data, com_filesize, width, height) : NULL;
	Hunk_FreeToLowMark (mark);
	return pixels;
}

/*
=============
GLS_LoadSkyBox

The skybox sky_name names: its six faces in a texture array, in the order
QuakeSpasm loads them (rt, bk, lf, ft, up, dn), each at the first face's
size; a face missing is black. No face at all is no skybox.
=============
*/
static void GLS_LoadSkyBox (void)
{
	static char	*suffixes[6] = {"rt", "bk", "lf", "ft", "up", "dn"};
	byte		*faces[6], *scaled;
	int			widths[6], heights[6], i, x, y, size = 0, found = 0;

	sky_changed = false;
	if (sky_box)
	{
		glDeleteTextures (1, &sky_box);
		sky_box = 0;
	}
	if (!sky_name[0])
		return;
	for (i = 0 ; i < 6 ; i++)
	{
		faces[i] = GLS_LoadFace (sky_name, suffixes[i], &widths[i], &heights[i]);
		if (faces[i])
		{
			found++;
			if (!size)
				size = widths[i];
		}
	}
	if (!found)
	{
		Con_Printf ("Couldn't load gfx/env/%s: no skybox\n", sky_name);
		return;
	}

	glGenTextures (1, &sky_box);
	GL_Bind (TU_TEXTURE, GL_TEXTURE_2D_ARRAY, sky_box);
	glTexImage3D (GL_TEXTURE_2D_ARRAY, 0, GL_RGBA8, size, size, 6, 0, GL_RGBA, GL_UNSIGNED_BYTE, NULL);
	scaled = calloc (size * size, 4);
	for (i = 0 ; i < 6 ; i++)
	{
		if (faces[i])
			for (y = 0 ; y < size ; y++)
				for (x = 0 ; x < size ; x++)
					memcpy (scaled + (y * size + x) * 4,
						faces[i] + ((y * heights[i] / size) * widths[i] + x * widths[i] / size) * 4, 4);
		else
			memset (scaled, 0, size * size * 4);
		glTexSubImage3D (GL_TEXTURE_2D_ARRAY, 0, 0, 0, i, size, size, 1, GL_RGBA, GL_UNSIGNED_BYTE, scaled);
		free (faces[i]);
	}
	free (scaled);
	glGenerateMipmap (GL_TEXTURE_2D_ARRAY);
	glTexParameteri (GL_TEXTURE_2D_ARRAY, GL_TEXTURE_MIN_FILTER, GL_NEAREST);
	glTexParameteri (GL_TEXTURE_2D_ARRAY, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
	glTexParameteri (GL_TEXTURE_2D_ARRAY, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
	glTexParameteri (GL_TEXTURE_2D_ARRAY, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
}

void GL_SkyName (char *name)
{
	strncpy (sky_name, name, sizeof (sky_name) - 1);
	sky_name[sizeof (sky_name) - 1] = 0;
	sky_changed = true;
}

GLuint GLS_SkyBox (void)
{
	return sky_box;
}

static void GLS_Sky_f (void)
{
	if (Cmd_Argc () < 2)
	{
		Con_Printf ("\"sky\" is \"%s\"\n", sky_name);
		return;
	}
	GL_SkyName (Cmd_Argv (1));
}

//=============================================================================
// Fog

// The fog's density and colour now, between the old and the new.
static float GLS_FogNow (float *colour)
{
	float	f = 0;
	int		i;

	if (fog_end > cl.time && fog_end > fog_start)
		f = (fog_end - cl.time) / (fog_end - fog_start);
	for (i = 0 ; i < 3 ; i++)
		colour[i] = f * fog_old_colour[i] + (1 - f) * fog_colour[i];
	return f * fog_old_density + (1 - f) * fog_density;
}

void GL_Fog (float density, float red, float green, float blue, float time)
{
	float	colour[3];

	fog_old_density = GLS_FogNow (colour);
	memcpy (fog_old_colour, colour, sizeof (colour));
	fog_density = density < 0 ? 0 : density;
	fog_colour[0] = red;
	fog_colour[1] = green;
	fog_colour[2] = blue;
	fog_start = cl.time;
	fog_end = time > 0 ? cl.time + time : 0;
}

/*
=============
GLS_Fog_f

The console's fog, as QuakeSpasm's: fog <density>, fog <red> <green>
<blue>, fog <density> <red> <green> <blue>, and a time to fade over after.
=============
*/
static void GLS_Fog_f (void)
{
	int		argc = Cmd_Argc ();

	switch (argc)
	{
	case 2:
		GL_Fog (atof (Cmd_Argv (1)), fog_colour[0], fog_colour[1], fog_colour[2], 0);
		break;
	case 3:
		GL_Fog (atof (Cmd_Argv (1)), fog_colour[0], fog_colour[1], fog_colour[2], atof (Cmd_Argv (2)));
		break;
	case 4:
		GL_Fog (fog_density, atof (Cmd_Argv (1)), atof (Cmd_Argv (2)), atof (Cmd_Argv (3)), 0);
		break;
	case 5:
	case 6:
		GL_Fog (atof (Cmd_Argv (1)), atof (Cmd_Argv (2)), atof (Cmd_Argv (3)), atof (Cmd_Argv (4)),
			argc == 6 ? atof (Cmd_Argv (5)) : 0);
		break;
	default:
		Con_Printf ("usage: fog <density> | fog <red> <green> <blue> | fog <density> <red> <green> <blue> [time]\n"
			"\"fog\" is \"%g %g %g %g\"\n", fog_density, fog_colour[0], fog_colour[1], fog_colour[2]);
	}
}

//=============================================================================

void GLS_Register (void)
{
	Cvar_RegisterVariable (&r_skyfog);
	Cvar_RegisterVariable (&gl_fogbands);
	Cmd_AddCommand ("sky", GLS_Sky_f);
	Cmd_AddCommand ("fog", GLS_Fog_f);
}

/*
=============
GLS_NewMap

The map's worldspawn's fog, sky, skyfog and liquid alphas; none of them
is none.
=============
*/
void GLS_NewMap (void)
{
	static char	*alphas[4] = {"wateralpha", "lavaalpha", "slimealpha", "telealpha"};
	char		key[128], value[4096], *data;
	float		d, r, g, b;
	int			i;

	fog_density = fog_old_density = 0;
	fog_end = 0;
	fog_colour[0] = fog_colour[1] = fog_colour[2] = 0.3;
	map_skyfog = -1;
	for (i = 0 ; i < 4 ; i++)
		gl_map_alpha[i] = -1;
	GL_SkyName ("");

	data = cl.worldmodel ? cl.worldmodel->entities : NULL;
	if (!data || !(data = COM_Parse (data)) || com_token[0] != '{')
		return;
	while ((data = COM_Parse (data)) && com_token[0] != '}')
	{
		strncpy (key, com_token[0] == '_' ? com_token + 1 : com_token, sizeof (key) - 1);
		key[sizeof (key) - 1] = 0;
		if (!(data = COM_Parse (data)))
			break;
		strncpy (value, com_token, sizeof (value) - 1);
		value[sizeof (value) - 1] = 0;
		if (!strcmp (key, "fog") && sscanf (value, "%f %f %f %f", &d, &r, &g, &b) == 4)
			GL_Fog (d, r, g, b, 0);
		else if (!strcmp (key, "sky") || !strcmp (key, "skyname") || !strcmp (key, "qlsky"))
			GL_SkyName (value);
		else if (!strcmp (key, "skyfog"))
			map_skyfog = atof (value);
		else
			for (i = 0 ; i < 4 ; i++)
				if (!strcmp (key, alphas[i]))
					gl_map_alpha[i] = atof (value);
	}
}

/*
=============
GLS_Frame

Loads a skybox named since the last frame, and gives every program the
fog as it is now, the sky's share of it and where the eye is.
=============
*/
void GLS_Frame (void)
{
	float	colour[3], density;
	int		i;

	if (sky_changed)
		GLS_LoadSkyBox ();
	density = GLS_FogNow (colour);
	for (i = 0 ; i < P_COUNT ; i++)
	{
		glprogram_t	*p = &gl_programs[i];

		if (p->u[UF_FOG] < 0 && p->u[UF_EYE] < 0)
			continue;
		glUseProgram (p->id);
		if (p->u[UF_FOG] >= 0)
			glUniform4f (p->u[UF_FOG], colour[0], colour[1], colour[2], density / 64);
		if (p->u[UF_FOGBANDS] >= 0)
			glUniform1f (p->u[UF_FOGBANDS], gl_linear ? 0 : gl_fogbands.value);
		if (p->u[UF_SKYFOG] >= 0)
			glUniform1f (p->u[UF_SKYFOG], map_skyfog >= 0 ? map_skyfog : r_skyfog.value);
		if (p->u[UF_EYE] >= 0)
			glUniform3fv (p->u[UF_EYE], 1, r_origin);
	}
}
