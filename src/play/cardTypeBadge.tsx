// A small badge marking which action-die type plays an event card, so the kind is
// readable at a glance (Ira #3). It shows the icon PRINTED ON THE CARD (Character /
// Army / Muster, p.21-22) — an Event/Palantír die plays anything regardless. Falls
// back to the deck when the icon is unknown (a face-down opponent card, where only
// the card back's deck is public). Colours match the DiceTray / die-first chips so
// the connection is obvious.
import { FACE } from './DiceTray';

export function cardPlayType(deck?: string, via?: string | null): { label: string; bg: string } {
  if (via === 'character') return { label: 'Character', bg: FACE.character.bg };
  if (via === 'army') return { label: 'Army', bg: FACE.army.bg };
  if (via === 'muster') return { label: 'Muster', bg: FACE.muster.bg };
  if (deck === 'Character') return { label: 'Character', bg: FACE.character.bg };
  if (deck === 'Strategy') return { label: 'Army / Muster', bg: FACE.armyMuster.bg };
  return { label: deck ?? '?', bg: '#555' };
}

export function CardTypeBadge({ deck, via, small, style }: { deck?: string; via?: string | null; small?: boolean; style?: React.CSSProperties }) {
  const t = cardPlayType(deck, via);
  return (
    <span style={{ background: t.bg, color: '#fff', borderRadius: 4, padding: small ? '0 4px' : '1px 6px', fontSize: small ? 9 : 11, fontWeight: 700, whiteSpace: 'nowrap', ...style }}>
      {t.label}
    </span>
  );
}
