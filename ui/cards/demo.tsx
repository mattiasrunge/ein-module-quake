import { DemoCard } from '@games/card';
import { adapter } from '../adapter.ts';

/**
 * `/cards/quake/demo`: a game (`game`, else the first one there is) on its own, as Quake runs when
 * nobody plays: the demos recorded in its paks, one after the other, for ever.
 */
export default function Demo() {
  return <DemoCard adapter={adapter} />;
}
