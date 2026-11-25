import { Box, Text } from '@mantine/core';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { type Engine, startEngine } from '../quake/engine.ts';
import { listGames } from '../quake/games.ts';
import { useGameLoop } from '../quake/loop.ts';

/**
 * `/cards/quake/demo`: a game (`game`, else the first one there is) on its own, as Quake runs when
 * nobody plays: the demos recorded in its paks, one after the other, for ever. Silent, since a page
 * may make sound only after someone has clicked on it, and it takes no keys.
 */
export default function DemoCard() {
  const [params] = useSearchParams();
  const name = params.get('game');
  const canvas = useRef<HTMLCanvasElement>(null);
  const [engine, setEngine] = useState<Engine | null>(null);
  const [problem, setProblem] = useState<string>();

  useEffect(() => {
    let current = true;
    setEngine(null);
    setProblem(undefined);
    (async () => {
      const games = await listGames();
      const game = games.find((each) => each.name === name) ?? games[0];
      if (!game) throw new Error(name ? `${name} is not in the games` : 'No games yet');
      const started = await startEngine({ game, log: () => undefined });
      if (current) setEngine(started);
    })().catch((error) => {
      if (current) setProblem(error instanceof Error ? error.message : String(error));
    });
    return () => {
      current = false;
    };
  }, [name]);

  // A demo the engine cannot follow ends the game; the card says so rather than freeze.
  useGameLoop(engine, canvas, () => {
    setEngine(null);
    setProblem('The game stopped');
  });

  return (
    <Box
      w='100%'
      h='100%'
      bg='#000'
      style={{ containerType: 'size', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', position: 'relative' }}
    >
      {/* 640 by 480 at 4:3, as large as the tile holds. */}
      <canvas ref={canvas} width={640} height={480} style={{ width: 'min(100cqw, 133.333cqh)', aspectRatio: '4 / 3', imageRendering: 'pixelated', display: 'block' }} />
      {problem && <Text pos='absolute' c='gray.4' size='sm' ta='center' p='md'>{problem}</Text>}
    </Box>
  );
}
