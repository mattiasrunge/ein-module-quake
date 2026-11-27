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
// gl_ein.h -- Quake's WebGL 2 renderer (gl_main.c, gl_world.c,
// gl_models.c), beside its software one: what the engine calls it with.
// The software renderer's hooks (webgl.patch) hand a frame to it while
// gl_drawing is set; the dedicated server links gl_null.c instead.

#ifndef GL_EIN_H
#define GL_EIN_H

// Whether the frame being drawn is WebGL's: the player chose it
// (vid_renderer) and the browser has WebGL 2. It changes only between
// frames (GL_EndFrame).
extern qboolean	gl_drawing;

// Whether WebGL 2 could not be had, so the software renderer draws
// whatever vid_renderer says.
extern qboolean	gl_failed;

// vid_null.c's: which renderer the player chose ("gl" or "soft") and how
// WebGL filters the textures ("nearest" or "linear"), both kept in
// config.cfg.
extern cvar_t	vid_renderer;
extern cvar_t	gl_filter;

// The renderer's own cvars, registered by VID_Init.
void GL_Register (void);

// Draws the 3D view with WebGL in place of R_RenderView's software, and
// leaves the view's rectangle of vid.buffer transparent (255) for the 2D
// drawn over it.
void GL_RenderView (void);

// A new map is loaded: what was built of the old one's goes (R_NewMap).
void GL_NewMap (void);

// One of R_DrawParticles' particles, drawn by WebGL (D_DrawParticle).
void GL_Particle (particle_t *p);

// The frame is done: with gl_drawing, shows the 3D view with vid.buffer's
// 2D over it, through the palette, on the canvas, and answers true; the
// software renderer's frames answer false. Then chooses the renderer of
// the next frame.
qboolean GL_EndFrame (void);

#endif
