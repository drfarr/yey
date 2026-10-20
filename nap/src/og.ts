import type { NapResult } from './nap';
import { savedLabel } from './render';

/** Satori element tree. Plain objects so no React dependency is needed. */
export interface OgNode {
  type: string;
  props: { style?: Record<string, string | number>; children?: OgNode | OgNode[] | string };
}

const BG = '#0b0b10';
const FG = '#f2f1ec';
const MUTE = 'rgba(242,241,236,0.55)';
const ACCENT = '#ffd166';

function div(style: Record<string, string | number>, children: OgNode | OgNode[] | string): OgNode {
  return { type: 'div', props: { style, children } };
}

function clip(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s;
}

export function ogElement(r: NapResult | null, site = 'nap'): OgNode {
  const frame = {
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
    width: '100%',
    height: '100%',
    padding: '64px 72px',
    background: BG,
    color: FG,
    fontFamily: 'sans-serif',
  };

  if (!r) {
    return div(frame, [
      div({ display: 'flex', fontSize: 44, color: MUTE }, 'nap'),
      div({ display: 'flex', flexDirection: 'column' }, [
        div({ display: 'flex', fontSize: 92, lineHeight: 1.05, letterSpacing: -3 }, 'Paste anything.'),
        div({ display: 'flex', fontSize: 92, lineHeight: 1.05, letterSpacing: -3, color: ACCENT }, 'Find out what you'),
        div({ display: 'flex', fontSize: 92, lineHeight: 1.05, letterSpacing: -3, color: ACCENT }, 'could have slept through.'),
      ]),
      div({ display: 'flex', fontSize: 30, color: MUTE }, site),
    ]);
  }

  return div(frame, [
    div({ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 36, color: MUTE }, [
      div({ display: 'flex' }, 'nap'),
      div({ display: 'flex' }, `${r.stats.words.toLocaleString()} words · ${savedLabel(r.stats.savedSeconds)}`),
    ]),
    div({ display: 'flex', flexDirection: 'column' }, [
      div({ display: 'flex', alignItems: 'baseline' }, [
        div({ display: 'flex', fontSize: 190, lineHeight: 1, letterSpacing: -8, color: ACCENT }, `${r.napScore}%`),
        div({ display: 'flex', fontSize: 44, color: MUTE, marginLeft: 20 }, 'nappable'),
      ]),
      div({ display: 'flex', fontSize: 54, lineHeight: 1.2, marginTop: 24, letterSpacing: -1 }, `“${clip(r.verdict, 90)}”`),
    ]),
    div({ display: 'flex', fontSize: 30, color: MUTE }, site),
  ]);
}
