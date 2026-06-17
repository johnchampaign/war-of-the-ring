// A small badge marking which action-die type plays an event card, so the kind is
// readable at a glance (Ira #3). Derived from the card's deck: Character-deck cards
// play on a Character die; Strategy-deck cards on an Army or Muster die (p.22). Colours
// match the DiceTray / die-first chips so the connection is obvious.
import { FACE } from './DiceTray';

export function cardPlayType(deck?: string): { label: string; bg: string } {
  if (deck === 'Character') return { label: 'Character', bg: FACE.character.bg };
  if (deck === 'Strategy') return { label: 'Army / Muster', bg: FACE.armyMuster.bg };
  return { label: deck ?? '?', bg: '#555' };
}

export function CardTypeBadge({ deck, small, style }: { deck?: string; small?: boolean; style?: React.CSSProperties }) {
  const t = cardPlayType(deck);
  return (
    <span style={{ background: t.bg, color: '#fff', borderRadius: 4, padding: small ? '0 4px' : '1px 6px', fontSize: small ? 9 : 11, fontWeight: 700, whiteSpace: 'nowrap', ...style }}>
      {t.label}
    </span>
  );
}
