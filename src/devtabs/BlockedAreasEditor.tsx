// DEV-ONLY editor for the board's unused "special areas" (off-map tracks, boxes,
// scoring strips printed on the map image that aren't playable regions). Draw a
// polygon by clicking vertices on the map; finish it; repeat. Export produces the
// exact contents of assets/blocked-areas.json, which the play board uses to mask
// these areas out. Geometry is in the reference image's pixel space, same as
// region-geometry.json. Never shipped — it's a hash route (#blocked).
import { useCallback, useRef, useState } from 'react';
import { mapImage } from '../data/geometry';
import { blockedAreas as existing, type BlockedArea } from '../data/blockedAreas';
import { useBoardArt } from '../play/artCache';

type Pt = { x: number; y: number };

export function BlockedAreasEditor() {
  const W = mapImage.width, H = mapImage.height;
  // Prefer the downloaded board art (IndexedDB) so the editor works on the deployed
  // site (where /dev-assets is stripped); fall back to the dev file for local dev.
  const boardArt = useBoardArt();
  const mapHref = boardArt ?? `/dev-assets/${mapImage.src}`;
  const [areas, setAreas] = useState<BlockedArea[]>(() => existing.map((a) => ({ ...a, polygon: a.polygon.map((p) => [...p] as [number, number]) })));
  const [draft, setDraft] = useState<Pt[]>([]);
  const [showMap, setShowMap] = useState(true);
  const svgRef = useRef<SVGSVGElement>(null);

  // Map a click to image-pixel coordinates via the SVG's own transform (robust to
  // CSS scaling), rounded to whole pixels.
  const toImg = useCallback((e: React.MouseEvent): Pt => {
    const svg = svgRef.current!;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    return { x: Math.round(p.x), y: Math.round(p.y) };
  }, []);

  const addPoint = (e: React.MouseEvent) => setDraft((d) => [...d, toImg(e)]);
  const undoPoint = () => setDraft((d) => d.slice(0, -1));
  const finishArea = () => {
    if (draft.length < 3) return;
    const label = window.prompt('Label for this area?', `blocked-${areas.length + 1}`) ?? `blocked-${areas.length + 1}`;
    setAreas((a) => [...a, { label, polygon: draft.map((p) => [p.x, p.y] as [number, number]) }]);
    setDraft([]);
  };
  const deleteArea = (i: number) => setAreas((a) => a.filter((_, j) => j !== i));

  const json = JSON.stringify({
    _doc: "Off-map / unused 'special areas' printed on the board image (tracks, boxes, scoring strips) that are NOT playable regions. Polygons are in the same pixel space as region-geometry.json (the reference map image). The play board masks these out so they read as inert. Authored with the #blocked dev tab.",
    areas,
  }, null, 2) + '\n';

  const copyJson = () => { void navigator.clipboard.writeText(json); };
  const downloadJson = () => {
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'blocked-areas.json'; a.click();
    URL.revokeObjectURL(url);
  };

  const draftPath = draft.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
  const areaPath = (poly: [number, number][]) => poly.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x},${y}`).join(' ') + ' Z';
  const btn = (on = false): React.CSSProperties => ({ padding: '5px 12px', marginRight: 8, cursor: 'pointer', background: on ? '#2b6cb0' : '#444', color: '#fff', border: 'none', borderRadius: 4, fontSize: 14 });

  return (
    <div style={{ fontFamily: 'system-ui', color: '#eee', background: '#1a1a1a', minHeight: '100vh', padding: 12 }}>
      <h2 style={{ margin: '4px 0' }}>WotR — Blocked "special areas" editor</h2>
      <p style={{ fontSize: 13, color: '#bbb', margin: '4px 0 10px', maxWidth: 900 }}>
        Click the map to drop polygon vertices around an unused area (the Hunt box, political track, dice
        strips, scoring tracks — anything that isn't a playable region). <b>Finish area</b> closes it and
        asks for a label. Repeat for each. When done, <b>Download</b> the file to{' '}
        <code>assets/blocked-areas.json</code> (or <b>Copy</b> the JSON and paste it back to me) — the play
        board masks every area out.
      </p>
      <div style={{ marginBottom: 8 }}>
        <button style={btn(showMap)} onClick={() => setShowMap((v) => !v)}>map bg</button>
        <button style={btn()} onClick={undoPoint} disabled={!draft.length}>undo point</button>
        <button style={btn()} onClick={() => setDraft([])} disabled={!draft.length}>clear draft</button>
        <button style={btn(true)} onClick={finishArea} disabled={draft.length < 3}>✓ finish area ({draft.length} pts)</button>
        <span style={{ marginLeft: 16, color: '#9c9' }}>{areas.length} area{areas.length === 1 ? '' : 's'} defined</span>
      </div>

      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} width={1280} height={1280 * H / W}
          onClick={addPoint}
          style={{ display: 'block', border: '1px solid #333', background: '#000', maxWidth: '100%', cursor: 'crosshair', flexShrink: 0 }}>
          {showMap && <image href={mapHref} x={0} y={0} width={W} height={H} />}
          {/* committed areas */}
          {areas.map((a, i) => (
            <g key={i}>
              <path d={areaPath(a.polygon)} fill="rgba(220,40,40,0.4)" stroke="#ff5a5a" strokeWidth={2} />
              <text x={a.polygon[0]![0]} y={a.polygon[0]![1] - 6} fontSize={16} fill="#fff" stroke="#000" strokeWidth={0.5}>{a.label}</text>
            </g>
          ))}
          {/* draft in progress */}
          {draft.length > 0 && (
            <>
              <path d={draftPath + (draft.length > 2 ? ' Z' : '')} fill="rgba(80,160,255,0.25)" stroke="#5aa0ff" strokeWidth={2} strokeDasharray="6 4" />
              {draft.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={5} fill={i === 0 ? '#ffd23f' : '#5aa0ff'} stroke="#fff" strokeWidth={1} />)}
            </>
          )}
        </svg>

        <div style={{ flexShrink: 0, width: 320 }}>
          <div style={{ marginBottom: 8 }}>
            <button style={btn(true)} onClick={downloadJson}>⬇ Download JSON</button>
            <button style={btn()} onClick={copyJson}>Copy</button>
          </div>
          <div style={{ fontSize: 13, marginBottom: 6, color: '#bbb' }}>Defined areas:</div>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, maxHeight: 280, overflow: 'auto' }}>
            {areas.map((a, i) => (
              <li key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', borderBottom: '1px solid #333', fontSize: 13 }}>
                <span>{a.label} <span style={{ color: '#888' }}>({a.polygon.length} pts)</span></span>
                <button onClick={() => deleteArea(i)} style={{ background: 'none', border: 'none', color: '#e98', cursor: 'pointer' }}>✕</button>
              </li>
            ))}
            {!areas.length && <li style={{ color: '#777', fontSize: 13 }}>none yet</li>}
          </ul>
          <textarea readOnly value={json} style={{ width: '100%', height: 200, marginTop: 10, background: '#0e0e0e', color: '#9c9', fontFamily: 'monospace', fontSize: 11, border: '1px solid #333', borderRadius: 4 }} />
        </div>
      </div>
    </div>
  );
}
