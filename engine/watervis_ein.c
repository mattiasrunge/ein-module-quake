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
// watervis_ein.c -- what a leaf sees through water, slime, lava and
// teleporters, on a map whose visibility was made with them opaque.
//
// id's own maps were vised as if liquids were walls: a leaf above water
// does not see the leaves under it, nor they it, so translucent water
// would show the void, and the server would not send the monsters behind
// it. A map vised for translucent water has a liquid leaf that sees an
// empty one; for any other, Mod_WaterPVS adds to a leaf's own PVS the PVS
// of every leaf across a liquid surface it sees, on the surface's other
// side, as a map vised for it would have them. The WebGL renderer draws
// with it while it draws a liquid translucent (gl_world.c), and the server
// sends what it holds (SV_AddToFatPVS, watervis.patch), so the monsters
// under the water are there to be seen. What the game's code sees is
// unchanged: monsters still see the player only through their own PVS.

#include "quakedef.h"

// A liquid surface's two sides: the leaf in the liquid and the one out of it.
typedef struct
{
	int		a, b;
} liquidpair_t;

static model_t		*vis_model;
static mleaf_t		*vis_leafs;		// the model's leaves when it was looked at
static qboolean		vis_vised;		// the map's own visibility sees through liquids
static liquidpair_t	*vis_pairs;
static int			vis_numpairs;
static byte			**vis_rows;		// each leaf's PVS with the liquids', made as asked for
static int			vis_rowbytes;
static int			vis_numrows;

static qboolean Mod_Liquid (int contents)
{
	return contents == CONTENTS_WATER || contents == CONTENTS_SLIME || contents == CONTENTS_LAVA;
}

/*
=============
Mod_WaterVisSetup

Whether the model's map is vised for translucent liquids, and if not, the
leaves on each side of each of its liquid surfaces.
=============
*/
static void Mod_WaterVisSetup (model_t *model)
{
	msurface_t	**mark, *surf;
	mleaf_t		*leaf, *other[2];
	medge_t		*edge;
	vec3_t		centre, point;
	byte		*pvs;
	int			i, j, k, e, side, numleaves = model->numleafs, room = 0;
	float		*v;

	for (i = 0 ; vis_rows && i < vis_numrows ; i++)
		free (vis_rows[i]);
	free (vis_rows);
	free (vis_pairs);
	vis_rows = NULL;
	vis_pairs = NULL;
	vis_numpairs = 0;
	vis_model = model;
	vis_leafs = model->leafs;
	vis_rowbytes = (numleaves + 7) >> 3;
	vis_numrows = numleaves + 1;
	vis_rows = calloc (vis_numrows, sizeof (byte *));

	// Vised for it: a liquid leaf sees an empty one.
	vis_vised = false;
	for (i = 1 ; i <= numleaves && !vis_vised ; i++)
	{
		if (!Mod_Liquid (model->leafs[i].contents))
			continue;
		pvs = Mod_LeafPVS (&model->leafs[i], model);
		for (j = 0 ; j < numleaves ; j++)
		{
			if ((pvs[j >> 3] & (1 << (j & 7))) && model->leafs[j + 1].contents == CONTENTS_EMPTY)
			{
				vis_vised = true;
				break;
			}
		}
	}
	if (vis_vised)
		return;

	// The leaves a little in front of and behind the middle of each liquid
	// surface a leaf has, where they differ.
	for (i = 1 ; i <= numleaves ; i++)
	{
		leaf = &model->leafs[i];
		mark = leaf->firstmarksurface;
		for (j = 0 ; j < leaf->nummarksurfaces ; j++)
		{
			surf = mark[j];
			if (!(surf->flags & SURF_DRAWTURB) || surf->numedges < 3)
				continue;
			centre[0] = centre[1] = centre[2] = 0;
			for (k = 0 ; k < surf->numedges ; k++)
			{
				e = model->surfedges[surf->firstedge + k];
				edge = &model->edges[e >= 0 ? e : -e];
				v = model->vertexes[e >= 0 ? edge->v[0] : edge->v[1]].position;
				VectorAdd (centre, v, centre);
			}
			VectorScale (centre, 1.0 / surf->numedges, centre);
			for (side = 0 ; side < 2 ; side++)
			{
				VectorMA (centre, side ? -2 : 2, surf->plane->normal, point);
				other[side] = Mod_PointInLeaf (point, model);
			}
			if (other[0] == other[1] || other[0]->contents == CONTENTS_SOLID || other[1]->contents == CONTENTS_SOLID
				|| Mod_Liquid (other[0]->contents) == Mod_Liquid (other[1]->contents))
				continue;
			for (k = 0 ; k < vis_numpairs ; k++)
				if (vis_pairs[k].a == other[0] - model->leafs && vis_pairs[k].b == other[1] - model->leafs)
					break;
			if (k < vis_numpairs)
				continue;
			if (vis_numpairs == room)
			{
				room = room ? room * 2 : 64;
				vis_pairs = realloc (vis_pairs, room * sizeof (liquidpair_t));
			}
			vis_pairs[vis_numpairs].a = other[0] - model->leafs;
			vis_pairs[vis_numpairs].b = other[1] - model->leafs;
			vis_numpairs++;
		}
	}
}

static qboolean Mod_Sees (byte *pvs, int leaf)
{
	return leaf > 0 && (pvs[(leaf - 1) >> 3] & (1 << ((leaf - 1) & 7)));
}

/*
=============
Mod_WaterPVS

The leaf's PVS with what it sees through the liquids its PVS has, on a map
not vised for them; its own PVS (Mod_LeafPVS) on one that is. The result
is the model's to keep, or Mod_LeafPVS's buffer.
=============
*/
byte *Mod_WaterPVS (mleaf_t *leaf, model_t *model)
{
	byte	*row, *pvs;
	int		index, i, j, a, b, pass;

	if (model != vis_model || model->leafs != vis_leafs)
		Mod_WaterVisSetup (model);
	if (vis_vised || !vis_numpairs || leaf == model->leafs)
		return Mod_LeafPVS (leaf, model);

	index = leaf - model->leafs;
	if (index < 0 || index > model->numleafs)
		return Mod_LeafPVS (leaf, model);
	if (vis_rows[index])
		return vis_rows[index];

	row = malloc (vis_rowbytes);
	memcpy (row, Mod_LeafPVS (leaf, model), vis_rowbytes);
	// Twice: a surface seen only through another liquid counts too.
	for (pass = 0 ; pass < 2 ; pass++)
	for (i = 0 ; i < vis_numpairs ; i++)
	{
		a = vis_pairs[i].a;
		b = vis_pairs[i].b;
		if (a == index || Mod_Sees (row, a))
		{
			pvs = Mod_LeafPVS (&model->leafs[b], model);
			for (j = 0 ; j < vis_rowbytes ; j++)
				row[j] |= pvs[j];
		}
		if (b == index || Mod_Sees (row, b))
		{
			pvs = Mod_LeafPVS (&model->leafs[a], model);
			for (j = 0 ; j < vis_rowbytes ; j++)
				row[j] |= pvs[j];
		}
	}
	vis_rows[index] = row;
	return row;
}

// Whether the model's map is vised for translucent liquids by itself.
qboolean Mod_WaterVised (model_t *model)
{
	if (model != vis_model || model->leafs != vis_leafs)
		Mod_WaterVisSetup (model);
	return vis_vised;
}
