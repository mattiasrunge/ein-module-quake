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
// gl_local.h -- what the WebGL 2 renderer's files share: its programs,
// the textures every draw uses, the view and the frame.
//
// Everything is drawn as the software renderer draws it, through Quake's
// palette: the textures are its 8-bit indexes, lit through its colormap
// in the shaders, so the light bands as it does, fullbright texels stay
// unlit and the brightest light is about twice the texture's own. The 3D
// view is drawn into a framebuffer of the frame's size in the palette's
// colours; the last pass puts the 2D the engine drew into vid.buffer over
// it, warps the view under water, and shifts the colours as the software
// renderer shifts its palette (damage, power-ups, water) and through the
// brightness' gamma (gl_main.c). With gl_filter "linear" the textures are
// filtered and mipmapped and the light is smooth, as GLQuake drew them.

#ifndef GL_LOCAL_H
#define GL_LOCAL_H

#include <GLES3/gl3.h>

#include "quakedef.h"
#include "r_local.h"
#include "gl_ein.h"

// The texture units: the draw's own textures on the first three, the
// colormap and the palette always on theirs.
#define TU_TEXTURE		0
#define TU_SECOND		1
#define TU_LIGHTMAP		2
#define TU_COLORMAP		3
#define TU_PALETTE		4
#define TU_GAMMA		5
#define TU_RGBMAP		6

// The colormap texture: the engine's 64 rows, then each player's colours
// (cl.scores[].translations), 64 rows each.
#define COLORMAP_ROWS	VID_GRADES
#define COLORMAP_BLOCKS	(1 + MAX_SCOREBOARD)

// The programs (gl_shaders.c); each but the particles' and the last pass'
// in a nearest variant, the software renderer's look, and a linear one.
typedef enum
{
	P_WORLD, P_WORLD_LINEAR,
	P_TURB, P_TURB_LINEAR,
	P_SKY, P_SKY_LINEAR,
	P_SKYBOX, P_SKYBOX_LINEAR,
	P_ALIAS, P_ALIAS_LINEAR,
	P_SPRITE, P_SPRITE_LINEAR,
	P_PARTICLE,
	P_FINAL,
	P_COUNT
} glprogramid_t;

// The uniforms any of them has; -1 where a program has not.
typedef enum
{
	UF_MVP, UF_SIZE, UF_MIP, UF_MINMIP, UF_CURVE, UF_TIME, UF_ALPHA,
	UF_VPN, UF_VRIGHT, UF_VUP, UF_SKY, UF_FRAME,
	UF_SCALE, UF_ORIGIN, UF_LIGHTVEC, UF_AMBIENT, UF_SHADE, UF_NORMALS, UF_CMAP,
	UF_PARTICLE, UF_VIEWPORT,
	UF_VRECT, UF_SHIFTS, UF_WARP, UF_BLEND, UF_COLOURED, UF_LITPALETTE,
	UF_FOG, UF_FOGBANDS, UF_SKYFOG, UF_EYE,
	UF_COUNT
} gluniformid_t;

typedef struct
{
	GLuint	id;
	GLint	u[UF_COUNT];
} glprogram_t;

extern glprogram_t	gl_programs[P_COUNT];

// gl_shaders.c: builds every program; false, with what failed printed,
// when one does not.
qboolean GL_BuildPrograms (void);

// gl_main.c
extern qboolean	gl_linear;			// this frame filters linearly (gl_filter)
extern int		gl_width, gl_height;	// the frame's size
extern float	gl_viewproj[16];	// world to the view's clip space
extern float	gl_xscale;			// the view's pixels a unit at distance 1
extern float	gl_curve[VID_GRADES];	// a colormap row's brightness, for the linear look
extern int		gl_gen;				// the map's: what was built of an older one is gone
extern int		gl_lightgen;		// the light's: lightmaps lit before are lit again
extern int		gl_fullbrights;		// the first of the palette's fullbright colours
extern cvar_t	r_wateralpha, r_slimealpha, r_lavaalpha, r_telealpha;

#ifndef GL_TEXTURE_MAX_ANISOTROPY_EXT
#define GL_TEXTURE_MAX_ANISOTROPY_EXT		0x84FE
#define GL_MAX_TEXTURE_MAX_ANISOTROPY_EXT	0x84FF
#endif

glprogram_t *GL_UseProgram (glprogramid_t id);
void GL_LinearSampler (int unit, qboolean clamp);
void GL_Bind (int unit, GLenum target, GLuint texture);
void GL_EntityMatrix (entity_t *e, qboolean alias, float *out);
void GL_Matrix (vec3_t origin, vec3_t angles, qboolean alias, float *out);
void GL_MatMul (const float *a, const float *b, float *out);
GLuint GL_IndexTexture (int width, int height, int levels, byte **pixels);
// GL_ColourTexture's flags.
#define CT_MIPMAP		1
#define CT_REPEAT		2
#define CT_ZERO			4
#define CT_255			8
#define CT_FULLBRIGHT	16

GLuint GL_ColourTexture (int width, int height, byte *pixels, int flags);
int GL_PlayerColormap (byte *colormap);
qboolean GL_BoxOutside (vec3_t mins, vec3_t maxs);

// gl_world.c
GLuint GLW_Keep (GLuint texture);		// a texture of the map's, deleted with it
float GLW_LiquidAlpha (texture_t *t);
void GLW_LightTint (vec3_t point, vec3_t tint);
qboolean GLW_Coloured (void);		// the world is lit in colours
void GLW_NewMap (void);
void GLW_DrawWorld (void);
void GLW_DrawBrushEntity (entity_t *e);
void GLW_DrawWater (void);

// gl_sky.c
extern float	gl_map_alpha[4];	// the map's water, lava, slime and teleporter alpha; below 0 none
void GLS_Register (void);
void GLS_NewMap (void);
void GLS_Frame (void);
GLuint GLS_SkyBox (void);

// gl_models.c
void GLM_Register (void);
void GLM_DrawEntities (qboolean translucent);
void GLM_DrawViewModel (qboolean translucent);
void GLM_Blend (float alpha);
void GLM_BeginParticles (void);
void GLM_EndParticles (void);

#endif
