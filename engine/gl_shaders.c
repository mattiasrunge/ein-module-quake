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
// gl_shaders.c -- the WebGL 2 renderer's shaders, GLSL ES 3.00, and the
// programs made of them. Each draws what the software renderer's span
// drawers draw, per pixel: a texel of the texture's 8-bit indexes, lit
// through the colormap (the world's lightmaps, the models' light at their
// vertices), and its colour in the palette. The variants built with LINEAR
// filter the textures, mipmapped, and light them smoothly instead, as
// GLQuake did; the light is as bright as the colormap's rows make it.

#include <stdio.h>
#include <string.h>

#include "gl_local.h"

glprogram_t	gl_programs[P_COUNT];

static const char *uniform_names[UF_COUNT] =
{
	"u_mvp", "u_size", "u_mip", "u_minmip", "u_curve", "u_time", "u_alpha",
	"u_vpn", "u_vright", "u_vup", "u_sky", "u_frame",
	"u_scale", "u_origin", "u_lightvec", "u_ambient", "u_shade", "u_normals", "u_cmap",
	"u_particle", "u_viewport",
	"u_vrect", "u_shifts", "u_warp", "u_blend", "u_coloured", "u_litpalette",
};

static const char header[] =
	"#version 300 es\n";

static const char precision[] =
	"precision highp float;\n"
	"precision highp int;\n"
	"precision highp sampler2D;\n"
	"precision highp usampler2DArray;\n"
	"precision highp sampler3D;\n";

// The linear look's textures are sampled through the sampler gl_main.c binds,
// trilinear and anisotropic.
//
// The palette and the colormap, which every fragment shader but the last
// pass' looks colours up in: a colour is the palette's at an index, and the
// colormap's row `row` turns a texel's index into the index of its colour
// in that light (rows 0 to 63, brightest first; fullbright colours are the
// same in every row). `block` is the colormap's: 0 the engine's, a
// player's colours from 1.
static const char palette_glsl[] =
	"uniform sampler2D u_palette;\n"
	"uniform sampler2D u_colormap;\n"
	"vec4 colour(int index) {\n"
	"	return vec4(texelFetch(u_palette, ivec2(index, 0), 0).rgb, 1.0);\n"
	"}\n"
	"int lit(int index, int row, int block) {\n"
	"	return int(texelFetch(u_colormap, ivec2(index, block * 64 + clamp(row, 0, 63)), 0).r * 255.0 + 0.5);\n"
	"}\n"
	"int indexAt(sampler2D tex, ivec2 at, int mip) {\n"
	"	return int(texelFetch(tex, at, mip).r * 255.0 + 0.5);\n"
	"}\n"
	// A colormap row's brightness, between rows for the linear look.
	"uniform float u_curve[64];\n"
	"float brightness(float row) {\n"
	"	float r = clamp(row, 0.0, 63.0);\n"
	"	int i = min(int(r), 62);\n"
	"	return mix(u_curve[i], u_curve[i + 1], r - float(i));\n"
	"}\n"
	"vec3 brightness3(vec3 rows) {\n"
	"	return vec3(brightness(rows.r), brightness(rows.g), brightness(rows.b));\n"
	"}\n"
	// A texel in light of a row for each colour: in white light (the rows
	// alike) the colormap's colour, as the software renderer has it; in
	// coloured light each colour through the colormap at its own row, and
	// with u_litpalette that put back on the palette, its nearest colour
	// the light falls on (u_rgbmap, gl_main.c), but for fullbright texels.
	"uniform highp sampler3D u_rgbmap;\n"
	"uniform int u_litpalette;\n"
	"vec3 litColour(int index, ivec3 rows, int block) {\n"
	"	int red = lit(index, rows.r, block);\n"
	"	if (rows.r == rows.g && rows.g == rows.b)\n"
	"		return colour(red).rgb;\n"
	"	vec3 c = vec3(colour(red).r, colour(lit(index, rows.g, block)).g, colour(lit(index, rows.b, block)).b);\n"
	"	if (u_litpalette != 0 && lit(index, 0, block) != lit(index, 63, block))\n"
	"		c = colour(int(texture(u_rgbmap, c).r * 255.0 + 0.5)).rgb;\n"
	"	return c;\n"
	"}\n";

// A brush model's surfaces: its vertices with their texture coordinates in
// the texture's texels, their lightmap coordinates in the lightmap's
// samples, and per surface its lightmap's rectangle and layer and its
// texture's mip adjustment (gl_world.c).
static const char world_vs[] =
	"uniform mat4 u_mvp;\n"
	"layout(location = 0) in vec3 a_pos;\n"
	"layout(location = 1) in vec2 a_st;\n"
	"layout(location = 2) in vec2 a_lm;\n"
	"layout(location = 3) in uvec4 a_rect;\n"
	"layout(location = 4) in uvec2 a_extra;\n"
	"out vec2 v_st;\n"
	"out vec2 v_lm;\n"
	"flat out uvec4 v_rect;\n"
	"flat out uvec2 v_extra;\n"
	"void main() {\n"
	"	gl_Position = u_mvp * vec4(a_pos, 1.0);\n"
	"	v_st = a_st;\n"
	"	v_lm = a_lm;\n"
	"	v_rect = a_rect;\n"
	"	v_extra = a_extra;\n"
	"}\n";

// A lit surface. The light is the lightmap's samples, one each 16 texels,
// interpolated between them as the surface cache does, a colormap row in
// 256ths (gl_world.c's GLW_BuildLightmap). Nearest: the mip level is the
// one the software renderer chooses for the distance (D_MipLevelForScale,
// with gl_FragCoord.w its 1/z), and each texel is lit by the light where
// the surface cache lights it, then banded to the colormap's row.
static const char world_fs[] =
	"uniform sampler2D u_tex;\n"
	"uniform ivec2 u_size;\n"
	"uniform highp usampler2DArray u_light;\n"
	"uniform vec4 u_mip;\n"
	"uniform int u_minmip;\n"
	"uniform int u_coloured;\n"
	"in vec2 v_st;\n"
	"in vec2 v_lm;\n"
	"flat in uvec4 v_rect;\n"
	"flat in uvec2 v_extra;\n"
	"out vec4 o_colour;\n"
	"vec3 sample3(ivec3 at) {\n"
	"	uvec4 v = texelFetch(u_light, at, 0);\n"
	"	return u_coloured != 0 ? vec3(v.rgb) : vec3(float(v.r));\n"
	"}\n"
	"vec3 lightAt(vec2 lm) {\n"
	"	vec2 f = floor(lm);\n"
	"	vec2 fr = lm - f;\n"
	"	ivec2 lo = ivec2(v_rect.xy), hi = ivec2(v_rect.zw);\n"
	"	ivec2 a = clamp(ivec2(f), lo, hi), b = clamp(ivec2(f) + 1, lo, hi);\n"
	"	int layer = int(v_extra.x);\n"
	"	vec3 l00 = sample3(ivec3(a.x, a.y, layer));\n"
	"	vec3 l10 = sample3(ivec3(b.x, a.y, layer));\n"
	"	vec3 l01 = sample3(ivec3(a.x, b.y, layer));\n"
	"	vec3 l11 = sample3(ivec3(b.x, b.y, layer));\n"
	"	return mix(mix(l00, l10, fr.x), mix(l01, l11, fr.x), fr.y);\n"
	"}\n"
	"void main() {\n"
	"#ifdef LINEAR\n"
	"	vec4 c = texture(u_tex, v_st / vec2(u_size));\n"
	"	vec3 light = lightAt(v_lm + vec2(0.5, -0.5) / 16.0);\n"
	"	o_colour = vec4(c.rgb * mix(vec3(1.0), brightness3(light / 256.0), c.a), 1.0);\n"
	"#else\n"
	"	float scale = u_mip.x * gl_FragCoord.w * float(v_extra.y);\n"
	"	int mip = scale >= u_mip.y ? 0 : scale >= u_mip.z ? 1 : scale >= u_mip.w ? 2 : 3;\n"
	"	mip = max(mip, u_minmip);\n"
	"	float step = float(1 << mip);\n"
	"	vec2 texel = floor(v_st / step);\n"
	"	vec2 size = vec2(max(u_size >> mip, ivec2(1)));\n"
	"	ivec2 at = ivec2(texel - floor(texel / size) * size);\n"
	"	int index = indexAt(u_tex, at, mip);\n"
	"	vec2 lightat = vec2(texel.x + 1.0, texel.y) * step;\n"
	"	vec3 light = lightAt(v_lm + (lightat - v_st) / 16.0);\n"
	"	o_colour = vec4(litColour(index, ivec3(light) >> 8, 0), 1.0);\n"
	"#endif\n"
	"}\n";

// Water, slime, lava and teleporters: the software renderer's turbulence
// (D_DrawTurbulent8Span), each texel of the 64 by 64 texture taken from
// where a sine of the other coordinate, 8 texels high and 128 long,
// moving 20 a second, puts it; unlit, and r_wateralpha opaque.
static const char turb_fs[] =
	"uniform sampler2D u_tex;\n"
	"uniform ivec2 u_size;\n"
	"uniform float u_time;\n"
	"uniform float u_alpha;\n"
	"in vec2 v_st;\n"
	"out vec4 o_colour;\n"
	"const float CYCLE = 6.28318 / 128.0;\n"
	"void main() {\n"
	"#ifdef LINEAR\n"
	"	float t = u_time * 20.0;\n"
	"	vec2 warped = v_st + 8.0 + 8.0 * sin((v_st.yx + t) * CYCLE);\n"
	"	o_colour = vec4(texture(u_tex, warped / vec2(u_size)).rgb, u_alpha);\n"
	"#else\n"
	"	float t = float(int(u_time * 20.0) & 127);\n"
	"	vec2 texel = floor(v_st);\n"
	"	vec2 warped = floor(v_st + 8.0 + 8.0 * sin((mod(texel.yx, 128.0) + t) * CYCLE));\n"
	"	vec2 size = vec2(u_size);\n"
	"	ivec2 at = ivec2(warped - floor(warped / size) * size);\n"
	"	o_colour = vec4(colour(indexAt(u_tex, at, 0)).rgb, u_alpha);\n"
	"#endif\n"
	"}\n";

// The sky, as the software renderer draws it (D_Sky_uv_To_st): each pixel
// looks along a direction made from its place on the frame, flattened to
// a dome, at two layers of the sky's texture, the front one (its left
// half, transparent where it is 0) moving twice as fast as the back one.
// u_sky is the frame's centre, its view's larger side and how far the sky
// has moved (skytime * skyspeed).
static const char sky_fs[] =
	"uniform sampler2D u_tex;\n"
	"uniform sampler2D u_front;\n"
	"uniform vec3 u_vpn;\n"
	"uniform vec3 u_vright;\n"
	"uniform vec3 u_vup;\n"
	"uniform vec4 u_sky;\n"
	"uniform vec2 u_frame;\n"
	"out vec4 o_colour;\n"
	"void main() {\n"
	"	float u = gl_FragCoord.x - 0.5;\n"
	"	float v = u_frame.y - gl_FragCoord.y - 0.5;\n"
	"	float wu = 8192.0 * (u - u_sky.x) / u_sky.z;\n"
	"	float wv = 8192.0 * (u_sky.y - v) / u_sky.z;\n"
	"	vec3 end = 4096.0 * u_vpn + wu * u_vright + wv * u_vup;\n"
	"	end.z *= 3.0;\n"
	"	end = normalize(end);\n"
	"	vec2 st = u_sky.w + 6.0 * 63.0 * end.xy;\n"
	"#ifdef LINEAR\n"
	"	vec4 back = texture(u_tex, st / 128.0);\n"
	"	vec4 front = texture(u_front, (st + u_sky.w) / 128.0);\n"
	"	o_colour = vec4(mix(back.rgb, front.rgb, front.a), 1.0);\n"
	"#else\n"
	"	vec2 texel = floor(st);\n"
	"	ivec2 b = ivec2(mod(texel, 128.0));\n"
	"	ivec2 f = ivec2(mod(texel + floor(u_sky.w), 128.0));\n"
	"	int front = indexAt(u_front, f, 0);\n"
	"	o_colour = colour(front != 0 ? front : indexAt(u_tex, b, 0));\n"
	"#endif\n"
	"}\n";

// An alias model's two poses, blended (u_blend: 0 the first, 1 the second;
// gl_models.c): their vertices' bytes, scaled to the model, and the index
// of each's normal, lit as R_AliasTransformFinalVert lights it, a colour at
// a time, in the colormap's 256ths of a row; and the skin's texels at each.
static const char alias_vs[] =
	"uniform mat4 u_mvp;\n"
	"uniform vec3 u_scale;\n"
	"uniform vec3 u_origin;\n"
	"uniform vec3 u_lightvec;\n"
	"uniform vec3 u_ambient;\n"
	"uniform vec3 u_shade;\n"
	"uniform float u_blend;\n"
	"uniform vec3 u_normals[162];\n"
	"layout(location = 0) in uvec4 a_vert;\n"
	"layout(location = 1) in vec2 a_st;\n"
	"layout(location = 2) in uvec4 a_vert2;\n"
	"out vec2 v_st;\n"
	"out vec3 v_light;\n"
	"vec3 lightOf(uint normal) {\n"
	"	float cosine = dot(u_normals[min(normal, 161u)], u_lightvec);\n"
	"	return cosine < 0.0 ? max(vec3(0.0), u_ambient + trunc(u_shade * cosine)) : u_ambient;\n"
	"}\n"
	"void main() {\n"
	"	vec3 position = mix(vec3(a_vert.xyz), vec3(a_vert2.xyz), u_blend);\n"
	"	gl_Position = u_mvp * vec4(position * u_scale + u_origin, 1.0);\n"
	"	v_st = a_st;\n"
	"	v_light = mix(lightOf(a_vert.w), lightOf(a_vert2.w), u_blend);\n"
	"}\n";

// The skin's texel, through the entity's colormap (a player's colours),
// in the light between the vertices, banded to its row as D_PolysetDraw
// does. Linear: the skin's colours in the player's (gl_models.c), filtered
// between its mip levels, lit smoothly but for its fullbright texels.
static const char alias_fs[] =
	"uniform sampler2D u_tex;\n"
	"uniform ivec2 u_size;\n"
	"uniform int u_cmap;\n"
	"in vec2 v_st;\n"
	"in vec3 v_light;\n"
	"out vec4 o_colour;\n"
	"void main() {\n"
	"#ifdef LINEAR\n"
	"	vec4 c = texture(u_tex, v_st / vec2(u_size));\n"
	"	o_colour = vec4(c.rgb * mix(vec3(1.0), brightness3(v_light / 256.0), c.a), 1.0);\n"
	"#else\n"
	"	ivec2 at = clamp(ivec2(floor(v_st)), ivec2(0), u_size - 1);\n"
	"	o_colour = vec4(litColour(indexAt(u_tex, at, 0), ivec3(v_light) >> 8, u_cmap), 1.0);\n"
	"#endif\n"
	"}\n";

// A sprite's frame: unlit, transparent where its index is 255.
static const char sprite_vs[] =
	"uniform mat4 u_mvp;\n"
	"layout(location = 0) in vec3 a_pos;\n"
	"layout(location = 1) in vec2 a_uv;\n"
	"out vec2 v_uv;\n"
	"void main() {\n"
	"	gl_Position = u_mvp * vec4(a_pos, 1.0);\n"
	"	v_uv = a_uv;\n"
	"}\n";

static const char sprite_fs[] =
	"uniform sampler2D u_tex;\n"
	"uniform ivec2 u_size;\n"
	"in vec2 v_uv;\n"
	"out vec4 o_colour;\n"
	"void main() {\n"
	"#ifdef LINEAR\n"
	"	vec4 c = texture(u_tex, v_uv);\n"
	"	if (c.a < 0.5) discard;\n"
	"	o_colour = vec4(c.rgb / c.a, 1.0);\n"
	"#else\n"
	"	ivec2 at = clamp(ivec2(floor(v_uv * vec2(u_size))), ivec2(0), u_size - 1);\n"
	"	int index = indexAt(u_tex, at, 0);\n"
	"	if (index == 255) discard;\n"
	"	o_colour = colour(index);\n"
	"#endif\n"
	"}\n";

// A particle: a square of its colour, as many pixels across as
// D_DrawParticle makes it at its distance (u_particle: d_pix_shift,
// d_pix_min, d_pix_max), its top left corner where it is.
static const char particle_vs[] =
	"uniform mat4 u_mvp;\n"
	"uniform vec3 u_origin;\n"
	"uniform vec3 u_vpn;\n"
	"uniform ivec3 u_particle;\n"
	"uniform vec2 u_viewport;\n"
	"layout(location = 0) in vec3 a_org;\n"
	"layout(location = 1) in float a_colour;\n"
	"flat out int v_colour;\n"
	"void main() {\n"
	"	float z = dot(a_org - u_origin, u_vpn);\n"
	"	if (z < 8.0) {\n"
	"		gl_Position = vec4(2.0, 2.0, 2.0, 1.0);\n"
	"		gl_PointSize = 1.0;\n"
	"		return;\n"
	"	}\n"
	"	int pix = clamp(int(32768.0 / z) >> u_particle.x, u_particle.y, u_particle.z);\n"
	"	vec4 p = u_mvp * vec4(a_org, 1.0);\n"
	"	p.xy += vec2(float(pix), -float(pix)) / u_viewport * p.w;\n"
	"	gl_Position = p;\n"
	"	gl_PointSize = float(pix);\n"
	"	v_colour = int(a_colour);\n"
	"}\n";

static const char particle_fs[] =
	"flat in int v_colour;\n"
	"out vec4 o_colour;\n"
	"void main() {\n"
	"	o_colour = colour(v_colour);\n"
	"}\n";

// The last pass, over the whole frame: the 2D the engine drew into
// vid.buffer (u_front, its indexes, row 0 at the top) over the 3D view
// (u_tex), which shows where the 2D is transparent (255) inside the view's
// rectangle (u_vrect, x, y, width, height from the top). Under water the
// view is warped as D_WarpScreen warps it, a sine of the other coordinate
// shifting each row and column, the view squeezed by its height so no edge
// wraps; u_warp is whether, its height, its length and how far it has
// moved. Then the colours are shifted toward each of u_shifts' colours by
// its share in 256ths, as V_UpdatePalette shifts the palette, and put
// through the brightness' gamma table (u_gamma).
static const char final_vs[] =
	"void main() {\n"
	"	vec2 p = vec2(float((gl_VertexID & 1) * 4 - 1), float((gl_VertexID & 2) * 2 - 1));\n"
	"	gl_Position = vec4(p, 0.0, 1.0);\n"
	"}\n";

static const char final_fs[] =
	"uniform sampler2D u_tex;\n"
	"uniform sampler2D u_front;\n"
	"uniform sampler2D u_gamma;\n"
	"uniform vec2 u_frame;\n"
	"uniform ivec4 u_vrect;\n"
	"uniform vec4 u_shifts[4];\n"
	"uniform vec4 u_warp;\n"
	"out vec4 o_colour;\n"
	"int turb(int i) {\n"
	"	return int(u_warp.y + sin((float(i) + u_warp.w) * 6.28318 / u_warp.z) * u_warp.y);\n"
	"}\n"
	"void main() {\n"
	"	int height = int(u_frame.y);\n"
	"	int x = int(gl_FragCoord.x);\n"
	"	int y = height - 1 - int(gl_FragCoord.y);\n"
	"	int index = indexAt(u_front, ivec2(x, y), 0);\n"
	"	vec3 c;\n"
	"	if (index == 255 && x >= u_vrect.x && x < u_vrect.x + u_vrect.z && y >= u_vrect.y && y < u_vrect.y + u_vrect.w) {\n"
	"		ivec2 at = ivec2(x, y);\n"
	"		if (u_warp.x > 0.0) {\n"
	"			int u = x - u_vrect.x, v = y - u_vrect.y;\n"
	"			float w = float(u_vrect.z), h = float(u_vrect.w), amp = 2.0 * u_warp.y;\n"
	"			at.x = u_vrect.x + int(float(u + turb(v)) * w / (w + amp));\n"
	"			at.y = u_vrect.y + int(float(v + turb(u)) * h / (h + amp));\n"
	"		}\n"
	"		c = texelFetch(u_tex, ivec2(at.x, height - 1 - at.y), 0).rgb;\n"
	"	} else\n"
	"		c = colour(index).rgb;\n"
	"	c = floor(c * 255.0 + 0.5);\n"
	"	for (int i = 0; i < 4; i++)\n"
	"		c += floor(u_shifts[i].w * (u_shifts[i].rgb - c) / 256.0);\n"
	"	ivec3 g = clamp(ivec3(c), ivec3(0), ivec3(255));\n"
	"	o_colour = vec4(texelFetch(u_gamma, ivec2(g.r, 0), 0).r, texelFetch(u_gamma, ivec2(g.g, 0), 0).r,\n"
	"		texelFetch(u_gamma, ivec2(g.b, 0), 0).r, 1.0);\n"
	"}\n";

static GLuint GL_CompileShader (GLenum type, const char *name, const char *defines, const char *body)
{
	const char	*parts[5];
	GLuint		shader;
	GLint		ok;
	char		log[1024];

	parts[0] = header;
	parts[1] = defines;
	parts[2] = precision;
	parts[3] = type == GL_FRAGMENT_SHADER ? palette_glsl : "";
	parts[4] = body;
	shader = glCreateShader (type);
	glShaderSource (shader, 5, parts, NULL);
	glCompileShader (shader);
	glGetShaderiv (shader, GL_COMPILE_STATUS, &ok);
	if (!ok)
	{
		glGetShaderInfoLog (shader, sizeof (log), NULL, log);
		Con_Printf ("WebGL: the %s %s shader does not compile: %s\n", name,
			type == GL_VERTEX_SHADER ? "vertex" : "fragment", log);
		glDeleteShader (shader);
		return 0;
	}
	return shader;
}

static void GL_Sampler (GLuint program, const char *name, int unit)
{
	GLint	at = glGetUniformLocation (program, name);

	if (at >= 0)
		glUniform1i (at, unit);
}

static qboolean GL_BuildProgram (glprogramid_t id, const char *name, const char *vs, const char *fs, qboolean linear)
{
	const char	*defines = linear ? "#define LINEAR\n" : "";
	GLuint		v, f, program;
	GLint		ok;
	char		log[1024];
	int			i;

	v = GL_CompileShader (GL_VERTEX_SHADER, name, defines, vs);
	f = GL_CompileShader (GL_FRAGMENT_SHADER, name, defines, fs);
	if (!v || !f)
		return false;
	program = glCreateProgram ();
	glAttachShader (program, v);
	glAttachShader (program, f);
	glLinkProgram (program);
	glDeleteShader (v);
	glDeleteShader (f);
	glGetProgramiv (program, GL_LINK_STATUS, &ok);
	if (!ok)
	{
		glGetProgramInfoLog (program, sizeof (log), NULL, log);
		Con_Printf ("WebGL: the %s program does not link: %s\n", name, log);
		glDeleteProgram (program);
		return false;
	}

	gl_programs[id].id = program;
	for (i = 0 ; i < UF_COUNT ; i++)
		gl_programs[id].u[i] = glGetUniformLocation (program, uniform_names[i]);
	if (gl_programs[id].u[UF_NORMALS] < 0)
		gl_programs[id].u[UF_NORMALS] = glGetUniformLocation (program, "u_normals[0]");
	if (gl_programs[id].u[UF_CURVE] < 0)
		gl_programs[id].u[UF_CURVE] = glGetUniformLocation (program, "u_curve[0]");
	if (gl_programs[id].u[UF_SHIFTS] < 0)
		gl_programs[id].u[UF_SHIFTS] = glGetUniformLocation (program, "u_shifts[0]");

	glUseProgram (program);
	GL_Sampler (program, "u_tex", TU_TEXTURE);
	GL_Sampler (program, "u_front", TU_SECOND);
	GL_Sampler (program, "u_light", TU_LIGHTMAP);
	GL_Sampler (program, "u_colormap", TU_COLORMAP);
	GL_Sampler (program, "u_palette", TU_PALETTE);
	GL_Sampler (program, "u_gamma", TU_GAMMA);
	GL_Sampler (program, "u_rgbmap", TU_RGBMAP);
	return true;
}

qboolean GL_BuildPrograms (void)
{
	int		linear;

	for (linear = 0 ; linear < 2 ; linear++)
	{
		if (!GL_BuildProgram (P_WORLD + linear, "world", world_vs, world_fs, linear)
			|| !GL_BuildProgram (P_TURB + linear, "turbulence", world_vs, turb_fs, linear)
			|| !GL_BuildProgram (P_SKY + linear, "sky", world_vs, sky_fs, linear)
			|| !GL_BuildProgram (P_ALIAS + linear, "alias model", alias_vs, alias_fs, linear)
			|| !GL_BuildProgram (P_SPRITE + linear, "sprite", sprite_vs, sprite_fs, linear))
			return false;
	}
	return GL_BuildProgram (P_PARTICLE, "particle", particle_vs, particle_fs, false)
		&& GL_BuildProgram (P_FINAL, "last pass", final_vs, final_fs, false);
}
