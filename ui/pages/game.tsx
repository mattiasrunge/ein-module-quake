import { GamePage } from '@games/page';
import { adapter } from '../adapter.ts';

export { gamePageHandle as handle } from '@games/page';

/** `/games/quake/:game`: a Quake or Quake II game, on the Games page's page for a game. */
export default function Game() {
  return <GamePage adapter={adapter} />;
}
