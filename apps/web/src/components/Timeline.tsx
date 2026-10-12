import { formatUtc } from '../format';
import type { Schedule } from '../types';

type Props = { baseline: Schedule | null };

type Bar = {
  taskId: string;
  kind: string;
  startMs: number;
  finishMs: number;
  uncertain: boolean;
  resourceId?: string;
};

export function Timeline({ baseline }: Props) {
  if (!baseline || baseline.tasks.length === 0) {
    return (
      <section className="panel" aria-label="Dependency timeline">
        <h2>Dependency timeline</h2>
        <p className="muted" data-testid="timeline-empty">
          No computed timeline. The schedule could not be produced for this snapshot.
        </p>
      </section>
    );
  }

  const bars: Bar[] = baseline.tasks.map((task) => ({
    taskId: task.taskId,
    kind: task.kind,
    startMs: Date.parse(task.earliestStart),
    finishMs: Date.parse(task.finish),
    uncertain: task.uncertain,
    resourceId: task.resourceId,
  }));

  const min = Math.min(...bars.map((b) => b.startMs));
  const max = Math.max(...bars.map((b) => b.finishMs));
  const span = Math.max(1, max - min);
  const plannedReadyMs = Date.parse(baseline.plannedReadyAt);
  const showPlannedMarker = plannedReadyMs >= min && plannedReadyMs <= max;

  return (
    <section className="panel" aria-label="Dependency timeline">
      <h2>Dependency timeline</h2>
      <p className="muted small">
        Computed intervals from the deterministic engine. Hatched bars carry an uncertainty flag.
      </p>

      <div className="timeline" data-testid="timeline">
        {bars.map((bar) => {
          const left = ((bar.startMs - min) / span) * 100;
          const width = Math.max(1.2, ((bar.finishMs - bar.startMs) / span) * 100);
          const title = `${bar.taskId} (${bar.kind}) ${formatUtc(
            new Date(bar.startMs).toISOString(),
          )} to ${formatUtc(new Date(bar.finishMs).toISOString())}${
            bar.resourceId ? ` on ${bar.resourceId}` : ''
          }${bar.uncertain ? ' - uncertain' : ''}`;
          return (
            <div className="timeline-row" key={bar.taskId}>
              <span className="small mono">{bar.taskId}</span>
              <div className="timeline-track">
                <div
                  className={`timeline-bar${bar.uncertain ? ' uncertain' : ''}`}
                  data-testid={`timeline-bar-${bar.taskId}`}
                  style={{ left: `${left}%`, width: `${width}%` }}
                  title={title}
                  aria-label={title}
                />
              </div>
            </div>
          );
        })}
        {showPlannedMarker ? (
          <div className="timeline-row">
            <span className="small mono muted">planned ready</span>
            <div className="timeline-track" style={{ background: 'transparent', border: 'none' }}>
              <div
                aria-hidden="true"
                style={{
                  position: 'absolute',
                  left: `${((plannedReadyMs - min) / span) * 100}%`,
                  top: 0,
                  bottom: 0,
                  width: 2,
                  background: '#ffd166',
                }}
              />
            </div>
          </div>
        ) : null}
      </div>

      <div className="timeline-axis">
        <span>{formatUtc(new Date(min).toISOString())}</span>
        <span>{formatUtc(new Date(max).toISOString())}</span>
      </div>
    </section>
  );
}
