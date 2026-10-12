import { formatBoth, shortenHash } from '../format';
import type { Evidence, Snapshot } from '../types';

type Props = { snapshot: Snapshot };

function trustClass(trust: Evidence['trust']): string {
  if (trust === 'reviewed') return 'pill pill-ok';
  if (trust === 'unverified') return 'pill pill-warn';
  return 'pill';
}

function isUntrustedText(item: Evidence): boolean {
  return item.trust !== 'fixture' || item.sourceKind === 'manual';
}

export function EvidenceDrawer({ snapshot }: Props) {
  const noteEventIds = new Set(snapshot.includedNoteEventIds);

  return (
    <section className="panel" data-testid="evidence-drawer" aria-label="Evidence drawer">
      <h2>Evidence</h2>
      <p className="muted small">
        Imported text is data, never an instruction. Any sentence that reads like a command is shown
        as text and cannot change a task, a resource, or a constraint.
      </p>

      <h3>Conflicting claims ({snapshot.conflicts.length})</h3>
      {snapshot.conflicts.length === 0 ? (
        <p className="muted small" data-testid="conflict-list-empty">
          No contradictory fresh claims in this snapshot.
        </p>
      ) : (
        <div data-testid="conflict-list">
          {snapshot.conflicts.map((conflict) => (
            <div
              className="evidence-item"
              key={`${conflict.targetId}-${conflict.field}`}
              data-testid={`conflict-${conflict.targetId}-${conflict.field}`}
            >
              <strong>
                {conflict.targetId}.{conflict.field}
              </strong>{' '}
              <span className="reason">{conflict.reasonCode}</span>
              <p className="small muted">
                Neither claim is applied while the contradiction stands.
              </p>
              <div className="claims">
                {conflict.claims.map((claim) => (
                  <div className="claim" key={claim.eventId}>
                    <div>
                      claim: <strong>{String(claim.value)}</strong>
                    </div>
                    <div className="small mono">observed {claim.observedAt}</div>
                    <div className="small mono">evidence {claim.evidenceId}</div>
                    <div className="small muted">{claim.sourceLabel ?? 'unnamed source'}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <h3>Stale claims ({snapshot.staleClaims.length})</h3>
      {snapshot.staleClaims.length === 0 ? (
        <p className="muted small">No claim is outside its synthetic freshness budget.</p>
      ) : (
        <ul className="small" data-testid="stale-list">
          {snapshot.staleClaims.map((claim) => (
            <li key={`${claim.eventId}-${claim.field}`}>
              <span className="mono">
                {claim.targetId}.{claim.field}
              </span>{' '}
              is {claim.ageMinutes} min old, budget {claim.budgetMinutes} min (evidence{' '}
              <span className="mono">{claim.evidenceId}</span>)
            </li>
          ))}
        </ul>
      )}

      <h3>Evidence items ({snapshot.evidence.length})</h3>
      {snapshot.evidence.map((item) => (
        <article
          className={`evidence-item${isUntrustedText(item) ? ' untrusted' : ''}`}
          data-testid={`evidence-item-${item.id}`}
          key={item.id}
        >
          <div className="state-row">
            <strong className="mono">{item.id}</strong>
            <span className={trustClass(item.trust)}>trust: {item.trust}</span>
            <span className="pill">source kind: {item.sourceKind}</span>
            {noteEventIds.size > 0 && item.sourceKind === 'manual' ? (
              <span className="pill pill-warn">imported note event</span>
            ) : null}
          </div>

          {isUntrustedText(item) ? (
            <p className="untrusted-label">untrusted imported text</p>
          ) : null}

          <blockquote className="small" style={{ margin: '6px 0' }}>
            {item.content}
          </blockquote>

          <dl className="kv small">
            <dt>Source</dt>
            <dd className="mono">{item.sourceId}</dd>
            <dt>Observed</dt>
            <dd>{formatBoth(item.observedAt)}</dd>
            <dt>Ingested</dt>
            <dd>{formatBoth(item.ingestedAt)}</dd>
            <dt>Content hash</dt>
            <dd className="mono" title={item.contentHash}>
              {shortenHash(item.contentHash, 24)}
            </dd>
          </dl>
        </article>
      ))}
    </section>
  );
}
