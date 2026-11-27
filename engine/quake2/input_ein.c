/*
Copyright (C) 1997-2001 Id Software, Inc.
Copyright (C) 2010 Yamagi Burmeister
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
// input_ein.c -- Yamagi Quake II's input for the EiN page, in place of
// input/sdl2.c: the page has the keyboard and the pointer lock, and hands
// the keys (ein_key, ein_char, quake2_ein.c) and the mouse's movement
// (ein_mouse) to the worker between ticks. The mouse looks as the game's
// own input makes it, with its sensitivity, filter and free look; there
// is no gamepad, gyro or rumble, so the menus never offer them.

#include <emscripten.h>

#include "../src/client/header/client.h"
#include "../src/client/header/keyboard.h"

// The mouse's movement since the last frame, and since the game last moved
// by it.
static int mouse_dx, mouse_dy;
static float mouse_x, mouse_y;
static qboolean mlooking;

int sys_frame_time;

// What the menus and the keys ask of a gamepad, which there is none of.
qboolean joy_altselector_pressed = false;
gamepad_labels_t joy_current_lbls = LBL_SDL;
qboolean japanese_confirm = false;
qboolean show_gamepad = false, show_haptic = false, show_gyro = false;

cvar_t *freelook;
cvar_t *lookstrafe;
cvar_t *m_forward;
cvar_t *m_pitch;
cvar_t *m_side;
cvar_t *m_up;
cvar_t *m_yaw;
cvar_t *joy_layout;
cvar_t *gyro_mode;
static cvar_t *sensitivity;
static cvar_t *exponential_speedup;
static cvar_t *m_filter;

#define MOUSE_MAX 3000
#define MOUSE_MIN 40

// The mouse moved by `dx` and `dy` pixels.
EMSCRIPTEN_KEEPALIVE
void ein_mouse(int dx, int dy)
{
	mouse_dx += dx;
	mouse_dy += dy;
}

// Each frame: the mouse's movement counts while the game is played, not
// in a menu, the console or a pause.
void IN_Update(void)
{
	if (cls.key_dest == key_game && (int)cl_paused->value == 0)
	{
		mouse_x += mouse_dx;
		mouse_y += mouse_dy;
	}

	mouse_dx = mouse_dy = 0;
	sys_frame_time = Sys_Milliseconds();
}

// The mouse's movement turns, looks or moves the player, as sdl2.c's.
void IN_Move(usercmd_t *cmd)
{
	static float old_mouse_x;
	static float old_mouse_y;

	if (m_filter->value)
	{
		if ((mouse_x > 1) || (mouse_x < -1))
		{
			mouse_x = (mouse_x + old_mouse_x) * 0.5;
		}

		if ((mouse_y > 1) || (mouse_y < -1))
		{
			mouse_y = (mouse_y + old_mouse_y) * 0.5;
		}
	}

	old_mouse_x = mouse_x;
	old_mouse_y = mouse_y;

	if (mouse_x || mouse_y)
	{
		if (!exponential_speedup->value)
		{
			mouse_x *= sensitivity->value;
			mouse_y *= sensitivity->value;
		}
		else
		{
			if ((mouse_x > MOUSE_MIN) || (mouse_y > MOUSE_MIN) ||
				(mouse_x < -MOUSE_MIN) || (mouse_y < -MOUSE_MIN))
			{
				mouse_x = (mouse_x * mouse_x * mouse_x) / 4;
				mouse_y = (mouse_y * mouse_y * mouse_y) / 4;

				if (mouse_x > MOUSE_MAX)
				{
					mouse_x = MOUSE_MAX;
				}
				else if (mouse_x < -MOUSE_MAX)
				{
					mouse_x = -MOUSE_MAX;
				}

				if (mouse_y > MOUSE_MAX)
				{
					mouse_y = MOUSE_MAX;
				}
				else if (mouse_y < -MOUSE_MAX)
				{
					mouse_y = -MOUSE_MAX;
				}
			}
		}

		// add mouse X/Y movement to cmd
		if ((in_strafe.state & 1) || (lookstrafe->value && mlooking))
		{
			cmd->sidemove += m_side->value * mouse_x;
		}
		else
		{
			cl.viewangles[YAW] -= m_yaw->value * mouse_x;
		}

		if ((mlooking || freelook->value) && !(in_strafe.state & 1))
		{
			cl.viewangles[PITCH] += m_pitch->value * mouse_y;
		}
		else
		{
			cmd->forwardmove -= m_forward->value * mouse_y;
		}

		mouse_x = mouse_y = 0;
	}
}

static void IN_MLookDown(void)
{
	mlooking = true;
}

static void IN_MLookUp(void)
{
	mlooking = false;
	IN_CenterView();
}

void IN_Init(void)
{
	Com_Printf("------- input initialization -------\n");

	mouse_x = mouse_y = 0;
	mouse_dx = mouse_dy = 0;

	exponential_speedup = Cvar_Get("exponential_speedup", "0", CVAR_ARCHIVE);
	freelook = Cvar_Get("freelook", "1", CVAR_ARCHIVE);
	lookstrafe = Cvar_Get("lookstrafe", "0", CVAR_ARCHIVE);
	m_filter = Cvar_Get("m_filter", "0", CVAR_ARCHIVE);
	m_up = Cvar_Get("m_up", "1", CVAR_ARCHIVE);
	m_forward = Cvar_Get("m_forward", "1", CVAR_ARCHIVE);
	m_pitch = Cvar_Get("m_pitch", "0.022", CVAR_ARCHIVE);
	m_side = Cvar_Get("m_side", "0.8", CVAR_ARCHIVE);
	m_yaw = Cvar_Get("m_yaw", "0.022", CVAR_ARCHIVE);
	sensitivity = Cvar_Get("sensitivity", "3", CVAR_ARCHIVE);
	joy_layout = Cvar_Get("joy_layout", "0", CVAR_ARCHIVE);
	gyro_mode = Cvar_Get("gyro_mode", "2", CVAR_ARCHIVE);

	Cmd_AddCommand("+mlook", IN_MLookDown);
	Cmd_AddCommand("-mlook", IN_MLookUp);

	Com_Printf("------------------------------------\n\n");
}

void IN_Shutdown(void)
{
	Cmd_RemoveCommand("+mlook");
	Cmd_RemoveCommand("-mlook");
}

// Keys held when a level or a cinematic starts are let go.
void In_FlushQueue(void)
{
	Key_MarkAllUp();
	mouse_dx = mouse_dy = 0;
}

// The page has no clipboard to give the game.
void IN_GetClipboardText(char *out, size_t n)
{
	*out = '\0';
}

int IN_SetClipboardText(const char *s)
{
	return 1;
}

// The keypad's keys are always the keypad's.
qboolean IN_NumpadIsOn()
{
	return false;
}

// No gamepad: nothing to rumble or to calibrate.
void Controller_Rumble(const char *name, vec3_t source, qboolean from_player,
		unsigned int duration, unsigned short int volume)
{
}

void Haptic_Feedback(const char *name, int effect_volume, int effect_duration,
		int effect_delay, int effect_attack, int effect_fade,
		int effect_x, int effect_y, int effect_z, float effect_distance)
{
}

void IN_ApplyJoyPreset(void)
{
}

qboolean IN_MatchJoyPreset(void)
{
	return true;
}

void StartCalibration(void)
{
}

qboolean IsCalibrationZero(void)
{
	return true;
}
