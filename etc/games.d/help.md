Drop the game's folder. Its paks say which engine plays it.

#### Quake

```text
id1/
├── pak0.pak
├── pak1.pak              the whole game (not in the shareware)
├── maps/
│   └── mymap.bsp         optional
└── music/                optional
    ├── track02.ogg
    ├── track03.ogg
    └── … track11.ogg
```

#### Quake II

```text
baseq2/
├── pak0.pak
├── pak1.pak
├── pak2.pak
├── maps/
│   └── mymap.bsp         optional
└── music/                optional
    ├── track02.ogg
    └── … track11.ogg
```

#### Quake III Arena

```text
baseq3/
├── pak0.pk3
├── pak1.pk3 … pak8.pk3   the 1.32 point release
├── q3key                 optional, the CD key
└── mymap.pk3             maps and mods come as pk3s
```

Its music is in its pk3s. OpenArena and other games for Quake III's engine are
dropped as a folder of their pk3s too.

#### Music

- `track02.ogg`, `02 - Quake.mp3`, `Track 2.flac`: the number is what counts
- Ogg, MP3, Opus, FLAC, M4A, AAC or WAV
- Track 2 is the first song; a rip numbered from 1 is moved up by one
- Add it later: drop the `music/` folder and choose the game
