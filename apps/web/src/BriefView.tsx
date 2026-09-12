import { useEffect } from 'react';
import type { BriefLine, BriefSection, ObjectId } from '@coral/core';
import { useStudio } from './store.js';

/**
 * The Reasoning Brief.
 *
 * Every line here is a string the project already holds — a thought, a passage,
 * a citation. The template contributes headings, order, and the admission of
 * absence: a section with nothing behind it shows what would close it rather
 * than prose covering the hole.
 *
 * That is the difference the interface has to make visible. A summary reads
 * well and answers for nothing; this is meant to be defensible line by line, so
 * every line is clickable through to the object it came from.
 */
export default function BriefView() {
  const brief = useStudio((s) => s.brief);
  const omitted = useStudio((s) => s.omitted);
  const refreshBrief = useStudio((s) => s.refreshBrief);
  const scan = useStudio((s) => s.scan);
  const lastScan = useStudio((s) => s.lastScan);
  const busy = useStudio((s) => s.busy);
  const state = useStudio((s) => s.state);
  const checkpoints = useStudio((s) => s.checkpoints);
  const briefAsOf = useStudio((s) => s.briefAsOf);

  useEffect(() => { void refreshBrief(); }, [refreshBrief, state.seq]);

  if (brief === null) {
    return (
      <div className="focus">
        <div className="focuscol"><p className="empty">Nothing to assemble yet.</p></div>
      </div>
    );
  }

  const open = brief.sections.filter((s) => s.gap).length;

  return (
    <div className="focus">
      <div className="focuscol">
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <span className="eyebrow" style={{ color: 'var(--brand)' }}>Reasoning brief</span>
          <span className="mono" style={{ fontSize: 10.5, color: 'var(--text-3)' }}>
            {brief.cited.length} objects cited
            {open > 0 && ` · ${open} section${open === 1 ? '' : 's'} open`}
          </span>
        </div>

        <p className="empty" style={{ maxWidth: '64ch' }}>
          Assembled from what is on the map. Nothing here was written for you: every line is a
          thought you wrote, a passage that was retrieved, or a source you saved. Where there is
          nothing behind a section, it says so.
        </p>

        {/*
          A brief read from live state is the wrong document to review: an
          instructor commented on what was handed in, and a student who has
          revised since would be defended by text nobody read.
        */}
        {checkpoints.length > 0 && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <label className="lbl" style={{ flex: 1, minWidth: 200 }}>
              <span className="eyebrow">Read it as of</span>
              <select
                className="field"
                value={briefAsOf ?? ''}
                onChange={(e) => void refreshBrief(e.target.value === '' ? null : e.target.value)}
              >
                <option value="">Now, with everything written since</option>
                {checkpoints.map((c, i) => (
                  <option key={c.snapshotId} value={c.snapshotId}>
                    Checkpoint {i + 1} · {new Date(c.at).toLocaleString()} · {c.entries} frozen
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}

        {briefAsOf !== null && (
          <span className="empty" style={{ color: 'var(--brand)' }}>
            This is what was submitted, not what is on the map now. Nothing written since appears
            here.
          </span>
        )}

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn" disabled={busy} onClick={() => void scan()}>
            {busy ? 'Looking…' : 'What is missing or in tension?'}
          </button>
          {lastScan !== null && (
            <span className="empty">
              {lastScan.flagged === 0
                ? 'Nothing new flagged.'
                : `${lastScan.flagged} flagged.`}
              {lastScan.alreadyStanding > 0 && ` ${lastScan.alreadyStanding} already standing.`}
              {!lastScan.scannedForContradictions && (
                lastScan.nothingToCompare
                  ? ' Only one claim so far, so there was nothing to read against anything.'
                  : ' Contradictions were not scanned.'
              )}
            </span>
          )}
        </div>

        {lastScan?.reason !== undefined && (
          <span className="empty" style={{ color: 'var(--brand)' }}>{lastScan.reason}</span>
        )}

        {brief.synthesisOpening && (
          <div className="row" style={{ borderColor: 'var(--coach)' }}>
            <span className="eyebrow" style={{ color: 'var(--coach)' }}>an opening, not a gap</span>
            <p>
              You are holding more than one claim and have not written a synthesis. That section is
              the one nobody else can write for you.
            </p>
          </div>
        )}

        {brief.sections.map((section) => (
          <Section key={section.id} section={section} />
        ))}

        {omitted.length > 0 && (
          <div className="row">
            <span className="eyebrow">Not in the brief</span>
            <p>
              {omitted.length} thought{omitted.length === 1 ? '' : 's'} on the map
              {' '}({[...new Set(omitted.map((t) => t.type.toLowerCase()))].join(', ')})
              {' '}did not belong to a section. Nothing is hidden; they are simply not part of the
              argument yet.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function Section({ section }: { section: BriefSection }) {
  return (
    <div className="current" style={section.gap ? { borderStyle: 'dashed' } : undefined}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
        <span className="eyebrow" style={{ color: section.gap ? 'var(--text-3)' : 'var(--brand)' }}>
          {section.title}
        </span>
        {section.gap && (
          <span className="mono" style={{ fontSize: 10, color: 'var(--text-3)' }}>open</span>
        )}
      </div>

      {section.gap
        ? <p className="empty" style={{ margin: 0 }}>{section.gapPrompt}</p>
        : section.lines.map((line, i) => <Line key={`${String(line.objectId)}-${String(i)}`} line={line} />)}
    </div>
  );
}

/**
 * One line, and the object behind it.
 *
 * Clicking a line selects that object, which is what makes "defensible line by
 * line" something a reader can check rather than something the page claims.
 */
function Line({ line, depth = 0 }: { line: BriefLine; depth?: number }) {
  const select = useStudio((s) => s.select);
  const setView = useStudio((s) => s.setView);

  const body = (
    <>
      {line.role !== null && (
        <span className="eyebrow" style={{ color: 'var(--ext)', marginRight: 8 }}>{line.role}</span>
      )}
      <span style={{ fontSize: depth === 0 ? 14.5 : 12.5, lineHeight: 1.55 }}>{line.text}</span>
      {line.flags.map((flag) => (
        <span key={flag} className="tag" style={{ color: 'var(--brand)', marginLeft: 8 }}>
          {flag.replace(/_/g, ' ')}
        </span>
      ))}
    </>
  );

  return (
    <div style={{ paddingLeft: depth * 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
      {line.objectId === null ? (
        <p style={{ margin: 0 }}>{body}</p>
      ) : (
        <button
          style={{ textAlign: 'left', display: 'block', width: '100%' }}
          onClick={() => { select(line.objectId as ObjectId); setView('focus'); }}
          title="Open the thought this line came from"
        >
          {body}
        </button>
      )}
      {line.children.map((child, i) => (
        <Line key={`${String(child.objectId)}-${String(i)}`} line={child} depth={depth + 1} />
      ))}
    </div>
  );
}
