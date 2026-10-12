import { formatBoth, formatDelayMinutes } from '../format';
import type { Schedule, Snapshot } from '../types';

type Props = {
  snapshot: Snapshot;
  baseline: Schedule | null;
};

function statusClass(status: string): string {
  if (status === 'complete') return 'pill pill-ok';
  if (status === 'blocked' || status === 'unknown') return 'pill pill-bad';
  if (status === 'active') return 'pill pill-warn';
  return 'pill';
}

export function StationBoard({ snapshot, baseline }: Props) {
  const rows = baseline
    ? baseline.tasks.map((task) => ({
        taskId: task.taskId,
        kind: task.kind,
        status: task.status,
        plannedStart: snapshot.tasks.find((t) => t.id === task.taskId)?.plannedStart ?? '-',
        earliestStart: task.earliestStart,
        finish: task.finish,
        resourceId: task.resourceId,
        uncertain: task.uncertain,
        causes: task.causes,
      }))
    : snapshot.tasks.map((task) => ({
        taskId: task.id,
        kind: task.kind,
        status: task.status,
        plannedStart: task.plannedStart,
        earliestStart: task.earliestStart ?? 'not computed',
        finish: 'not computed',
        resourceId: task.resourceId,
        uncertain: true,
        causes: ['the schedule could not be computed for this scenario'],
      }));

  const projectedReady = baseline?.readyAt ?? null;
  const delay = baseline?.projectedDelayMin ?? null;

  return (
    <section className="panel" data-testid="board" aria-label="Station board">
      <h2>
        Station board &middot; {snapshot.turnaround.station} &middot; {snapshot.turnaround.flightNumber}
      </h2>
      <p className="muted small">{snapshot.label}</p>

      <div data-testid="readiness">
        <dl className="kv">
          <dt>Aircraft</dt>
          <dd>{snapshot.turnaround.aircraft}</dd>
          <dt>Planned ready</dt>
          <dd>{formatBoth(snapshot.turnaround.plannedReadyAt)}</dd>
          <dt>Projected ready</dt>
          <dd>
            {projectedReady === null
              ? 'readiness uncertain - not asserted'
              : formatBoth(projectedReady)}
          </dd>
          <dt>Projected delay</dt>
          <dd>{formatDelayMinutes(delay)}</dd>
          <dt>Snapshot revision</dt>
          <dd>{snapshot.revision}</dd>
          <dt>Snapshot as of</dt>
          <dd>{formatBoth(snapshot.asOf)}</dd>
          <dt>Input snapshot hash</dt>
          <dd className="mono">{snapshot.inputHash}</dd>
        </dl>
      </div>

      {baseline && baseline.uncertainties.length > 0 ? (
        <div className="error-box" role="status">
          <strong>Readiness is not asserted because:</strong>
          <ul>
            {baseline.uncertainties.map((uncertainty) => (
              <li key={uncertainty}>{uncertainty}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <h3>Tasks</h3>
      <table data-testid="task-table">
        <thead>
          <tr>
            <th scope="col">Task</th>
            <th scope="col">Kind</th>
            <th scope="col">Status</th>
            <th scope="col">Planned start (UTC)</th>
            <th scope="col">Computed start (UTC)</th>
            <th scope="col">Computed finish (UTC)</th>
            <th scope="col">Resource</th>
            <th scope="col">Uncertainty</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.taskId} data-testid={`task-row-${row.taskId}`}>
              <td className="mono">{row.taskId}</td>
              <td>{row.kind}</td>
              <td>
                <span className={statusClass(row.status)} data-testid={`task-status-${row.taskId}`}>
                  {row.status}
                </span>
              </td>
              <td className="mono">{row.plannedStart}</td>
              <td className="mono">{row.earliestStart}</td>
              <td className="mono">{row.finish}</td>
              <td>{row.resourceId ?? 'none'}</td>
              <td>
                {row.uncertain ? (
                  <span className="pill pill-warn" title={row.causes.join('; ')}>
                    uncertain
                  </span>
                ) : (
                  <span className="pill">computed</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>Dependency reasons</h3>
      <ul className="small muted">
        {rows.map((row) => (
          <li key={`${row.taskId}-causes`}>
            <span className="mono">{row.taskId}</span>: {row.causes.join('; ')}
          </li>
        ))}
      </ul>
    </section>
  );
}
