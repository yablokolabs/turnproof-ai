import { formatCostUnits, formatMinutes } from '../format';
import type { CandidateEvaluation, Decision } from '../types';

type Props = {
  candidates: CandidateEvaluation[];
  decision: Decision;
};

function actionLabel(candidate: CandidateEvaluation['candidate']): string {
  switch (candidate.action) {
    case 'wait':
      return `Wait - keep the existing plan for ${candidate.taskId}`;
    case 'use_alternate_resource':
      return `Use ${candidate.resourceId ?? 'an alternate resource'} for ${candidate.taskId}`;
    case 'resequencing':
      return `Resequence around ${candidate.taskId}`;
    default:
      return candidate.id;
  }
}

export function Alternatives({ candidates, decision }: Props) {
  const feasible = candidates.filter((candidate) => candidate.feasible);

  return (
    <section className="panel" aria-label="Recovery alternatives">
      <h2>Recovery alternatives</h2>

      <div className="state-row">
        <span className={`state-badge state-${decision.state}`} data-testid="decision-state">
          {decision.state}
        </span>
        <span className="pill">
          baseline delay: {formatMinutes(decision.baselineDelayMin ?? null)}
        </span>
        <span className="pill">
          chosen: {decision.candidateId ?? 'none'}
        </span>
        <span className="pill">
          provider: {decision.providerName ?? 'unknown'} ({decision.providerMode})
        </span>
        <span className="pill">solver: {decision.solverVersion}</span>
        <span className="pill">policy: {decision.policyVersion}</span>
      </div>

      <p data-testid="decision-explanation" aria-live="polite">
        {decision.explanation}
      </p>
      <p className="muted small mono">decision {decision.id} &middot; snapshot {decision.snapshotHash}</p>

      {feasible.length === 0 ? (
        <div className="error-box" data-testid="no-feasible-option">
          No feasible recovery option. Nothing is recommended and no recovery is invented.
        </div>
      ) : null}

      <h3>Candidate set</h3>
      <div data-testid="candidates">
        {candidates.length === 0 ? (
          <p className="muted">No candidates were generated for this snapshot.</p>
        ) : (
          candidates.map((evaluation) => {
            const id = evaluation.candidate.id;
            const state = evaluation.feasible ? 'feasible' : 'rejected';
            return (
              <article
                className={`candidate ${state}`}
                data-testid={`candidate-${id}`}
                key={id}
              >
                <h4>{actionLabel(evaluation.candidate)}</h4>
                <p className="small">
                  <span
                    className={evaluation.feasible ? 'pill pill-ok' : 'pill pill-bad'}
                    data-testid={`candidate-${state}-${id}`}
                  >
                    {state}
                  </span>{' '}
                  <span className="muted">action: {evaluation.candidate.action}</span>
                </p>

                <dl className="kv small">
                  <dt>Projected delay</dt>
                  <dd>{formatMinutes(evaluation.projectedDelayMin)}</dd>
                  <dt>Projected recovery</dt>
                  <dd>{formatMinutes(evaluation.projectedRecoveryMin)}</dd>
                  <dt>Cost proxy</dt>
                  <dd>{formatCostUnits(evaluation.candidate.estimatedCostUnits)}</dd>
                  <dt>Requires human review</dt>
                  <dd>{evaluation.requiresReview ? 'yes' : 'no'}</dd>
                </dl>

                {evaluation.candidate.assumptions.length > 0 ? (
                  <>
                    <h3>Assumptions</h3>
                    <ul className="small">
                      {evaluation.candidate.assumptions.map((assumption) => (
                        <li key={assumption}>{assumption}</li>
                      ))}
                    </ul>
                  </>
                ) : null}

                <h3>Hard constraints</h3>
                <ul className="tag-list">
                  {evaluation.constraints.map((constraint) => (
                    <li
                      key={constraint.code}
                      className={
                        constraint.status === 'pass'
                          ? 'pill pill-ok'
                          : constraint.status === 'fail'
                            ? 'pill pill-bad'
                            : 'pill pill-warn'
                      }
                      title={constraint.detail ?? ''}
                    >
                      {constraint.code}: {constraint.status}
                    </li>
                  ))}
                </ul>

                {evaluation.violations.length > 0 ? (
                  <>
                    <h3>Constraint messages</h3>
                    <ul className="small" data-testid={`candidate-reasons-${id}`}>
                      {evaluation.violations.map((violation) => (
                        <li key={`${violation.code}-${violation.message}`}>
                          <span className="reason">{violation.code}</span> {violation.message}
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <ul className="small" data-testid={`candidate-reasons-${id}`}>
                    <li className="muted">No constraint violations.</li>
                  </ul>
                )}

                {evaluation.evidenceWarnings.length > 0 ? (
                  <ul className="small" style={{ color: '#ffc857' }}>
                    {evaluation.evidenceWarnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                ) : null}
              </article>
            );
          })
        )}
      </div>

      {decision.rejected.length > 0 ? (
        <>
          <h3>Rejected by hard constraints</h3>
          <ul className="small" data-testid="rejected-list">
            {decision.rejected.map((rejected) => (
              <li key={rejected.candidateId} data-testid={`rejected-${rejected.candidateId}`}>
                <span className="mono">{rejected.candidateId}</span>{' '}
                {rejected.reasonCodes.map((code) => (
                  <span className="reason" key={code} style={{ marginRight: 4 }}>
                    {code}
                  </span>
                ))}
                {rejected.detail ? <div className="muted">{rejected.detail}</div> : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <h3>Evidence cited by this decision</h3>
      <ul className="small" data-testid="decision-evidence-ids">
        {decision.evidenceIds.length === 0 ? (
          <li className="muted">No evidence ids cited.</li>
        ) : (
          decision.evidenceIds.map((evidenceId) => (
            <li className="mono" key={evidenceId}>
              {evidenceId}
            </li>
          ))
        )}
      </ul>
    </section>
  );
}
