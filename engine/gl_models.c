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
// gl_models.c -- the WebGL 2 renderer's entities: alias models (monsters,
// weapons, items, the player's weapon), sprites and particles, drawn as
// the software renderer draws them.
//
// An alias model's poses are put in a vertex buffer the first time it is
// drawn, from the model the software renderer keeps (Mod_Extradata): its
// vertices' bytes and their normals' indexes, pose after pose, beside the
// skin's coordinates, a vertex for each on the seam both ways; its skins
// are textures of their indexes. The pose and the skin drawn are the ones
// the software renderer chooses, without blending between poses, and the
// light is its own: the light under the model and the dynamic lights near
// it, from a fixed direction, through the colormap of the entity (a
// player's colours). Models stay for the session, as the cache keeps them.

#include <string.h>

#include "gl_local.h"

#define VectorSet(v, x, y, z)	((v)[0] = (x), (v)[1] = (y), (v)[2] = (z))

// r_alias.c's normals, which the lightnormalindex of a vertex is one of.
extern float	r_avertexnormals[162][3];

// d_modech.c's: how large a particle is at a distance.
extern int		d_pix_min, d_pix_max, d_pix_shift;

// r_main.c's and r_sprite.c's, which no header declares.
extern cvar_t	r_drawviewmodel;
mspriteframe_t *R_GetSpriteframe (msprite_t *psprite);

// R_AliasSetupLighting's least light.
#define LIGHT_MIN	5

typedef struct glalias_s
{
	model_t		*model;
	char		name[MAX_QPATH];
	GLuint		vao, poses_vbo, st_vbo, ibo;
	int			numindices;
	int			nummesh;		// vertices of a pose
	int			numposes;
	int			*poses;			// each pose's trivertx_t, by its offset in the header
	int			numskins;
	int			*skinoffsets;	// each skin's pixels, by their offset in the header
	GLuint		*skins;
	GLuint		*colours;		// the linear look's, each skin's colours, made when drawn
	struct
	{
		int		skin, colours;	// the skin, and the player's colours it is in
		GLuint	texture;
	}			players[8];		// the linear look's skins in players' colours
	int			nextplayer;
	int			skinwidth, skinheight;
	struct glalias_s	*next;
} glalias_t;

typedef struct glsprite_s
{
	mspriteframe_t	*frame;
	GLuint			index, rgba;
	struct glsprite_s	*next;
} glsprite_t;

static glalias_t	*aliases;
static glsprite_t	*sprites;
static int			sprites_gen;
static GLuint		sprite_vao, sprite_vbo;

static float		*particles;
static int			num_particles, particles_room;
static GLuint		particle_vao, particle_vbo;

//=============================================================================
// Alias models

static glalias_t *GLM_BuildAlias (model_t *model)
{
	aliashdr_t			*hdr;
	mdl_t				*mdl;
	stvert_t			*stverts;
	mtriangle_t			*tris;
	maliasgroup_t		*group;
	maliasskindesc_t	*skindesc;
	maliasskingroup_t	*skingroup;
	trivertx_t			*tv;
	glalias_t			*a;
	int					*map, *meshvert;
	float				*st;
	byte				*poses, *pixels[1];
	unsigned short		*indices;
	int					i, j, k, vi, seam, key, p, m;

	hdr = Mod_Extradata (model);
	mdl = (mdl_t *) ((byte *) hdr + hdr->model);
	stverts = (stvert_t *) ((byte *) hdr + hdr->stverts);
	tris = (mtriangle_t *) ((byte *) hdr + hdr->triangles);

	a = calloc (1, sizeof (glalias_t));
	a->model = model;
	strcpy (a->name, model->name);
	a->skinwidth = mdl->skinwidth;
	a->skinheight = mdl->skinheight;

	// A mesh vertex for each vertex and side of the seam it is used on: a
	// triangle facing back takes a vertex on the seam from the skin's right
	// half, as R_AliasPreparePoints does. The skin's coordinates are kept
	// in 16.16 fixed point (Mod_LoadAliasModel).
	map = malloc (mdl->numverts * 2 * sizeof (int));
	meshvert = malloc (mdl->numverts * 2 * sizeof (int));
	st = malloc (mdl->numverts * 2 * 2 * sizeof (float));
	indices = malloc (mdl->numtris * 3 * sizeof (unsigned short));
	for (i = 0 ; i < mdl->numverts * 2 ; i++)
		map[i] = -1;
	for (i = 0 ; i < mdl->numtris ; i++)
	{
		for (k = 0 ; k < 3 ; k++)
		{
			vi = tris[i].vertindex[k];
			seam = !tris[i].facesfront && stverts[vi].onseam;
			key = vi * 2 + seam;
			if (map[key] < 0)
			{
				map[key] = a->nummesh;
				meshvert[a->nummesh] = vi;
				st[a->nummesh * 2 + 0] = (stverts[vi].s >> 16) + (seam ? mdl->skinwidth / 2 : 0);
				st[a->nummesh * 2 + 1] = stverts[vi].t >> 16;
				a->nummesh++;
			}
			indices[i * 3 + k] = map[key];
		}
	}
	a->numindices = mdl->numtris * 3;

	// The poses: each frame's, or each of a group's.
	a->poses = malloc (sizeof (int) * 1024);
	for (i = 0 ; i < mdl->numframes ; i++)
	{
		if (hdr->frames[i].type == ALIAS_SINGLE)
		{
			if (a->numposes < 1024)
				a->poses[a->numposes++] = hdr->frames[i].frame;
			continue;
		}
		group = (maliasgroup_t *) ((byte *) hdr + hdr->frames[i].frame);
		for (j = 0 ; j < group->numframes && a->numposes < 1024 ; j++)
			a->poses[a->numposes++] = group->frames[j].frame;
	}
	poses = malloc (a->numposes * a->nummesh * 4);
	for (p = 0 ; p < a->numposes ; p++)
	{
		tv = (trivertx_t *) ((byte *) hdr + a->poses[p]);
		for (m = 0 ; m < a->nummesh ; m++)
		{
			byte	*out = poses + (p * a->nummesh + m) * 4;

			out[0] = tv[meshvert[m]].v[0];
			out[1] = tv[meshvert[m]].v[1];
			out[2] = tv[meshvert[m]].v[2];
			out[3] = tv[meshvert[m]].lightnormalindex;
		}
	}

	// The skins: each, or each of a group's.
	a->skinoffsets = malloc (sizeof (int) * 256);
	skindesc = (maliasskindesc_t *) ((byte *) hdr + hdr->skindesc);
	for (i = 0 ; i < mdl->numskins ; i++)
	{
		if (skindesc[i].type == ALIAS_SKIN_SINGLE)
		{
			if (a->numskins < 256)
				a->skinoffsets[a->numskins++] = skindesc[i].skin;
			continue;
		}
		skingroup = (maliasskingroup_t *) ((byte *) hdr + skindesc[i].skin);
		for (j = 0 ; j < skingroup->numskins && a->numskins < 256 ; j++)
			a->skinoffsets[a->numskins++] = skingroup->skindescs[j].skin;
	}
	a->skins = malloc (a->numskins * sizeof (GLuint));
	a->colours = calloc (a->numskins, sizeof (GLuint));
	for (i = 0 ; i < a->numskins ; i++)
	{
		pixels[0] = (byte *) hdr + a->skinoffsets[i];
		a->skins[i] = GL_IndexTexture (mdl->skinwidth, mdl->skinheight, 1, pixels);
	}

	glGenVertexArrays (1, &a->vao);
	glBindVertexArray (a->vao);
	glGenBuffers (1, &a->poses_vbo);
	glBindBuffer (GL_ARRAY_BUFFER, a->poses_vbo);
	glBufferData (GL_ARRAY_BUFFER, a->numposes * a->nummesh * 4, poses, GL_STATIC_DRAW);
	glEnableVertexAttribArray (0);
	glGenBuffers (1, &a->st_vbo);
	glBindBuffer (GL_ARRAY_BUFFER, a->st_vbo);
	glBufferData (GL_ARRAY_BUFFER, a->nummesh * 2 * sizeof (float), st, GL_STATIC_DRAW);
	glEnableVertexAttribArray (1);
	glVertexAttribPointer (1, 2, GL_FLOAT, GL_FALSE, 0, 0);
	glGenBuffers (1, &a->ibo);
	glBindBuffer (GL_ELEMENT_ARRAY_BUFFER, a->ibo);
	glBufferData (GL_ELEMENT_ARRAY_BUFFER, a->numindices * sizeof (unsigned short), indices, GL_STATIC_DRAW);
	glBindVertexArray (0);

	free (map);
	free (meshvert);
	free (st);
	free (indices);
	free (poses);

	a->next = aliases;
	aliases = a;
	return a;
}

static glalias_t *GLM_Alias (model_t *model)
{
	glalias_t	*a;

	for (a = aliases ; a ; a = a->next)
		if (a->model == model && !strcmp (a->name, model->name))
			return a;
	return GLM_BuildAlias (model);
}

static int GLM_Pose (glalias_t *a, int offset)
{
	int		i;

	for (i = 0 ; i < a->numposes ; i++)
		if (a->poses[i] == offset)
			return i;
	return 0;
}

/*
=============
GLM_Frame

The pose the entity's frame shows now, as R_AliasSetupFrame chooses it: a
group's by the time, without blending between poses.
=============
*/
static int GLM_Frame (glalias_t *a, aliashdr_t *hdr, mdl_t *mdl, entity_t *e)
{
	maliasgroup_t	*group;
	float			*intervals, full, target, time;
	int				frame = e->frame, i;

	if (frame >= mdl->numframes || frame < 0)
		frame = 0;
	if (hdr->frames[frame].type == ALIAS_SINGLE)
		return GLM_Pose (a, hdr->frames[frame].frame);
	group = (maliasgroup_t *) ((byte *) hdr + hdr->frames[frame].frame);
	intervals = (float *) ((byte *) hdr + group->intervals);
	full = intervals[group->numframes - 1];
	time = cl.time + e->syncbase;
	target = time - ((int) (time / full)) * full;
	for (i = 0 ; i < group->numframes - 1 ; i++)
		if (intervals[i] > target)
			break;
	return GLM_Pose (a, group->frames[i].frame);
}

// The skin the entity shows now, as R_AliasSetupSkin chooses it.
static int GLM_Skin (glalias_t *a, aliashdr_t *hdr, mdl_t *mdl, entity_t *e)
{
	maliasskindesc_t	*skindesc;
	maliasskingroup_t	*group;
	float				*intervals, full, target, time;
	int					skinnum = e->skinnum, i, offset;

	if (skinnum >= mdl->numskins || skinnum < 0)
		skinnum = 0;
	skindesc = (maliasskindesc_t *) ((byte *) hdr + hdr->skindesc) + skinnum;
	offset = skindesc->skin;
	if (skindesc->type == ALIAS_SKIN_GROUP)
	{
		group = (maliasskingroup_t *) ((byte *) hdr + skindesc->skin);
		intervals = (float *) ((byte *) hdr + group->intervals);
		full = intervals[group->numskins - 1];
		time = cl.time + e->syncbase;
		target = time - ((int) (time / full)) * full;
		for (i = 0 ; i < group->numskins - 1 ; i++)
			if (intervals[i] > target)
				break;
		offset = group->skindescs[i].skin;
	}
	for (i = 0 ; i < a->numskins ; i++)
		if (a->skinoffsets[i] == offset)
			return i;
	return 0;
}

/*
=============
GLM_SkinColours

The linear look's skin `skin`: its colours, filtered and mipmapped, the
light's falling on all but its fullbright texels; for a player in their
colours (cl.scores[].colors), their shirt's and their pants' ranges moved
as CL_NewTranslation moves them, a few kept at a time.
=============
*/
static GLuint GLM_SkinColours (glalias_t *a, aliashdr_t *hdr, int skin, entity_t *e)
{
	byte	translate[256], *pixels, *source;
	int		i, colours = -1, top, bottom, size = a->skinwidth * a->skinheight;
	GLuint	*slot;

	for (i = 0 ; cl.scores && e->colormap != vid.colormap && i < cl.maxclients ; i++)
		if (e->colormap == cl.scores[i].translations)
			colours = cl.scores[i].colors;

	if (colours < 0)
		slot = &a->colours[skin];
	else
	{
		for (i = 0 ; i < 8 ; i++)
			if (a->players[i].texture && a->players[i].skin == skin && a->players[i].colours == colours)
				return a->players[i].texture;
		i = a->nextplayer;
		a->nextplayer = (i + 1) % 8;
		if (a->players[i].texture)
			glDeleteTextures (1, &a->players[i].texture);
		a->players[i].texture = 0;
		a->players[i].skin = skin;
		a->players[i].colours = colours;
		slot = &a->players[i].texture;
	}
	if (*slot)
		return *slot;

	source = (byte *) hdr + a->skinoffsets[skin];
	pixels = malloc (size);
	for (i = 0 ; i < 256 ; i++)
		translate[i] = i;
	if (colours >= 0)
	{
		top = colours & 0xf0;
		bottom = (colours & 15) << 4;
		for (i = 0 ; i < 16 ; i++)
		{
			translate[TOP_RANGE + i] = top < 128 ? top + i : top + 15 - i;
			translate[BOTTOM_RANGE + i] = bottom < 128 ? bottom + i : bottom + 15 - i;
		}
	}
	for (i = 0 ; i < size ; i++)
		pixels[i] = translate[source[i]];
	*slot = GL_ColourTexture (a->skinwidth, a->skinheight, pixels, CT_MIPMAP | CT_FULLBRIGHT);
	free (pixels);
	return *slot;
}

/*
=============
GLM_DrawAlias

The entity's model, lit as R_AliasSetupLighting lights it from `ambient`
and `shade`, the light coming along (-1, 0, 0) of the world.
=============
*/
static void GLM_DrawAlias (entity_t *e, int ambient, int shade)
{
	static qboolean	normals_set[2];
	glalias_t		*a;
	aliashdr_t		*hdr;
	mdl_t			*mdl;
	glprogram_t		*p;
	vec3_t			angles, forward, right, up, lightvec = {-1, 0, 0};
	float			mvp[16], light;
	int				pose, skin;

	a = GLM_Alias (e->model);
	hdr = Mod_Extradata (e->model);
	mdl = (mdl_t *) ((byte *) hdr + hdr->model);
	pose = GLM_Frame (a, hdr, mdl, e);

	p = GL_UseProgram (gl_linear ? P_ALIAS_LINEAR : P_ALIAS);
	if (!normals_set[gl_linear])
	{
		glUniform3fv (p->u[UF_NORMALS], 162, &r_avertexnormals[0][0]);
		normals_set[gl_linear] = true;
	}

	GL_EntityMatrix (e, true, mvp);
	glUniformMatrix4fv (p->u[UF_MVP], 1, GL_FALSE, mvp);
	glUniform3fv (p->u[UF_SCALE], 1, mdl->scale);
	glUniform3fv (p->u[UF_ORIGIN], 1, mdl->scale_origin);

	VectorCopy (e->angles, angles);
	angles[PITCH] = -angles[PITCH];
	AngleVectors (angles, forward, right, up);
	glUniform3f (p->u[UF_LIGHTVEC], DotProduct (lightvec, forward), -DotProduct (lightvec, right),
		DotProduct (lightvec, up));
	if (ambient < LIGHT_MIN)
		ambient = LIGHT_MIN;
	light = (255 - ambient) << VID_CBITS;
	if (light < LIGHT_MIN)
		light = LIGHT_MIN;
	glUniform1f (p->u[UF_AMBIENT], light);
	glUniform1f (p->u[UF_SHADE], (shade < 0 ? 0 : shade) * VID_GRADES);

	glUniform2i (p->u[UF_SIZE], a->skinwidth, a->skinheight);
	skin = GLM_Skin (a, hdr, mdl, e);
	if (gl_linear)
		GL_Bind (TU_TEXTURE, GL_TEXTURE_2D, GLM_SkinColours (a, hdr, skin, e));
	else
	{
		glUniform1i (p->u[UF_CMAP], GL_PlayerColormap (e->colormap));
		GL_Bind (TU_TEXTURE, GL_TEXTURE_2D, a->skins[skin]);
	}
	GL_LinearSampler (TU_TEXTURE, true);

	glBindVertexArray (a->vao);
	glBindBuffer (GL_ARRAY_BUFFER, a->poses_vbo);
	glVertexAttribIPointer (0, 4, GL_UNSIGNED_BYTE, 0, (void *) (intptr_t) (pose * a->nummesh * 4));
	glDrawElements (GL_TRIANGLES, a->numindices, GL_UNSIGNED_SHORT, 0);
	glBindVertexArray (0);
	GL_LinearSampler (TU_TEXTURE, false);
}

//=============================================================================
// Sprites

static glsprite_t *GLM_SpriteFrame (mspriteframe_t *frame)
{
	glsprite_t	*s, *next;
	byte		*pixels[1];

	if (sprites_gen != gl_gen)
	{
		// The map's sprites went with it; their textures with gl_world.c's.
		for (s = sprites ; s ; s = next)
		{
			next = s->next;
			free (s);
		}
		sprites = NULL;
		sprites_gen = gl_gen;
	}
	for (s = sprites ; s ; s = s->next)
		if (s->frame == frame)
			break;
	if (!s)
	{
		s = calloc (1, sizeof (glsprite_t));
		s->frame = frame;
		s->next = sprites;
		sprites = s;
	}
	if (gl_linear && !s->rgba)
		s->rgba = GLW_Keep (GL_ColourTexture (frame->width, frame->height, frame->pixels, CT_MIPMAP | CT_255));
	if (!gl_linear && !s->index)
	{
		pixels[0] = frame->pixels;
		s->index = GLW_Keep (GL_IndexTexture (frame->width, frame->height, 1, pixels));
	}
	return s;
}

/*
=============
GLM_DrawSprite

The sprite's frame, turned as R_DrawSprite turns it for its kind.
=============
*/
static void GLM_DrawSprite (entity_t *e)
{
	msprite_t		*psprite = e->model->cache.data;
	mspriteframe_t	*frame;
	glsprite_t		*s;
	glprogram_t		*p;
	vec3_t			sup, sright, spn, origin, tvec;
	float			verts[4][5], dot, angle, sr, cr;
	int				i;

	currententity = e;
	frame = R_GetSpriteframe (psprite);

	switch (psprite->type)
	{
	case SPR_FACING_UPRIGHT:
		VectorSubtract (e->origin, r_origin, tvec);
		VectorNormalize (tvec);
		dot = tvec[2];
		if (dot > 0.999848 || dot < -0.999848)
			return;
		VectorSet (sup, 0, 0, 1);
		VectorSet (sright, tvec[1], -tvec[0], 0);
		VectorNormalize (sright);
		VectorSet (spn, -sright[1], sright[0], 0);
		break;
	case SPR_VP_PARALLEL:
		VectorCopy (vup, sup);
		VectorCopy (vright, sright);
		VectorCopy (vpn, spn);
		break;
	case SPR_VP_PARALLEL_UPRIGHT:
		dot = vpn[2];
		if (dot > 0.999848 || dot < -0.999848)
			return;
		VectorSet (sup, 0, 0, 1);
		VectorSet (sright, vpn[1], -vpn[0], 0);
		VectorNormalize (sright);
		VectorSet (spn, -sright[1], sright[0], 0);
		break;
	case SPR_ORIENTED:
		AngleVectors (e->angles, spn, sright, sup);
		break;
	case SPR_VP_PARALLEL_ORIENTED:
		angle = e->angles[ROLL] * (M_PI * 2 / 360);
		sr = sin (angle);
		cr = cos (angle);
		for (i = 0 ; i < 3 ; i++)
		{
			spn[i] = vpn[i];
			sright[i] = vright[i] * cr + vup[i] * sr;
			sup[i] = vright[i] * -sr + vup[i] * cr;
		}
		break;
	default:
		return;
	}

	VectorMA (e->origin, -psprite->beamlength, spn, origin);
	for (i = 0 ; i < 3 ; i++)
	{
		verts[0][i] = origin[i] + sup[i] * frame->up + sright[i] * frame->left;
		verts[1][i] = origin[i] + sup[i] * frame->up + sright[i] * frame->right;
		verts[2][i] = origin[i] + sup[i] * frame->down + sright[i] * frame->right;
		verts[3][i] = origin[i] + sup[i] * frame->down + sright[i] * frame->left;
	}
	verts[0][3] = 0; verts[0][4] = 0;
	verts[1][3] = 1; verts[1][4] = 0;
	verts[2][3] = 1; verts[2][4] = 1;
	verts[3][3] = 0; verts[3][4] = 1;

	s = GLM_SpriteFrame (frame);
	p = GL_UseProgram (gl_linear ? P_SPRITE_LINEAR : P_SPRITE);
	glUniformMatrix4fv (p->u[UF_MVP], 1, GL_FALSE, gl_viewproj);
	glUniform2i (p->u[UF_SIZE], frame->width, frame->height);
	GL_Bind (TU_TEXTURE, GL_TEXTURE_2D, gl_linear ? s->rgba : s->index);

	if (!sprite_vao)
	{
		glGenVertexArrays (1, &sprite_vao);
		glBindVertexArray (sprite_vao);
		glGenBuffers (1, &sprite_vbo);
		glBindBuffer (GL_ARRAY_BUFFER, sprite_vbo);
		glEnableVertexAttribArray (0);
		glVertexAttribPointer (0, 3, GL_FLOAT, GL_FALSE, 5 * sizeof (float), 0);
		glEnableVertexAttribArray (1);
		glVertexAttribPointer (1, 2, GL_FLOAT, GL_FALSE, 5 * sizeof (float), (void *) (3 * sizeof (float)));
	}
	glBindVertexArray (sprite_vao);
	glBindBuffer (GL_ARRAY_BUFFER, sprite_vbo);
	glBufferData (GL_ARRAY_BUFFER, sizeof (verts), verts, GL_STREAM_DRAW);
	GL_LinearSampler (TU_TEXTURE, true);
	glDrawArrays (GL_TRIANGLE_FAN, 0, 4);
	GL_LinearSampler (TU_TEXTURE, false);
	glBindVertexArray (0);
}

//=============================================================================
// Entities

/*
=============
GLM_DrawEntities

The frame's entities, as R_DrawEntitiesOnList and R_DrawBEntitiesOnList
draw them: brush models, sprites, and alias models in the light under them
and of the dynamic lights near them, not the player's own.
=============
*/
void GLM_DrawEntities (void)
{
	entity_t	*e;
	vec3_t		dist;
	float		add;
	int			i, lnum, ambient, shade;

	if (!r_drawentities.value)
		return;

	for (i = 0 ; i < cl_numvisedicts ; i++)
	{
		e = cl_visedicts[i];
		if (e->model->type == mod_brush)
		{
			GLW_DrawBrushEntity (e);
			continue;
		}
		if (e == &cl_entities[cl.viewentity])
			continue;
		if (e->model->type == mod_sprite)
		{
			GLM_DrawSprite (e);
			continue;
		}
		if (e->model->type != mod_alias)
			continue;

		currententity = e;
		ambient = shade = R_LightPoint (e->origin);
		for (lnum = 0 ; lnum < MAX_DLIGHTS ; lnum++)
		{
			if (cl_dlights[lnum].die < cl.time)
				continue;
			VectorSubtract (e->origin, cl_dlights[lnum].origin, dist);
			add = cl_dlights[lnum].radius - Length (dist);
			if (add > 0)
				ambient += add;
		}
		// lit no brighter than R_DrawEntitiesOnList lets it
		if (ambient > 128)
			ambient = 128;
		if (ambient + shade > 192)
			shade = 192 - ambient;
		GLM_DrawAlias (e, ambient, shade);
	}
	currententity = &cl_entities[0];
}

/*
=============
GLM_DrawViewModel

The player's weapon, as R_DrawViewModel draws it, never darker than 24,
in front of everything (the software renderer's z scaled by 3 for it).
=============
*/
void GLM_DrawViewModel (void)
{
	entity_t	*e = &cl.viewent;
	dlight_t	*dl;
	vec3_t		dist;
	float		add;
	int			lnum, ambient, shade;

	if (!r_drawviewmodel.value || r_fov_greater_than_90 || (cl.items & IT_INVISIBILITY)
		|| cl.stats[STAT_HEALTH] <= 0 || !e->model)
		return;

	currententity = e;
	ambient = R_LightPoint (e->origin);
	if (ambient < 24)
		ambient = 24;
	shade = ambient;
	for (lnum = 0 ; lnum < MAX_DLIGHTS ; lnum++)
	{
		dl = &cl_dlights[lnum];
		if (!dl->radius || dl->die < cl.time)
			continue;
		VectorSubtract (e->origin, dl->origin, dist);
		add = dl->radius - Length (dist);
		if (add > 0)
			ambient += add;
	}
	if (ambient > 128)
		ambient = 128;
	if (ambient + shade > 192)
		shade = 192 - ambient;

	glDepthRangef (0, 0.3);
	GLM_DrawAlias (e, ambient, shade);
	glDepthRangef (0, 1);
	currententity = &cl_entities[0];
}

//=============================================================================
// Particles

void GLM_BeginParticles (void)
{
	num_particles = 0;
}

void GL_Particle (particle_t *p)
{
	float	*out;

	if (num_particles == particles_room)
	{
		particles_room = particles_room ? particles_room * 2 : 4096;
		particles = realloc (particles, particles_room * 4 * sizeof (float));
	}
	out = particles + num_particles++ * 4;
	out[0] = p->org[0];
	out[1] = p->org[1];
	out[2] = p->org[2];
	out[3] = p->color;
}

// The frame's particles, squares as D_DrawParticle draws them.
void GLM_EndParticles (void)
{
	glprogram_t	*p;

	if (!num_particles)
		return;
	if (!particle_vao)
	{
		glGenVertexArrays (1, &particle_vao);
		glBindVertexArray (particle_vao);
		glGenBuffers (1, &particle_vbo);
		glBindBuffer (GL_ARRAY_BUFFER, particle_vbo);
		glEnableVertexAttribArray (0);
		glVertexAttribPointer (0, 3, GL_FLOAT, GL_FALSE, 4 * sizeof (float), 0);
		glEnableVertexAttribArray (1);
		glVertexAttribPointer (1, 1, GL_FLOAT, GL_FALSE, 4 * sizeof (float), (void *) (3 * sizeof (float)));
	}
	p = GL_UseProgram (P_PARTICLE);
	glUniformMatrix4fv (p->u[UF_MVP], 1, GL_FALSE, gl_viewproj);
	glUniform3fv (p->u[UF_ORIGIN], 1, r_origin);
	glUniform3fv (p->u[UF_VPN], 1, vpn);
	glUniform3i (p->u[UF_PARTICLE], d_pix_shift, d_pix_min, d_pix_max);
	glUniform2f (p->u[UF_VIEWPORT], r_refdef.vrect.width, r_refdef.vrect.height);
	glBindVertexArray (particle_vao);
	glBindBuffer (GL_ARRAY_BUFFER, particle_vbo);
	glBufferData (GL_ARRAY_BUFFER, num_particles * 4 * sizeof (float), particles, GL_STREAM_DRAW);
	glDrawArrays (GL_POINTS, 0, num_particles);
	glBindVertexArray (0);
}
