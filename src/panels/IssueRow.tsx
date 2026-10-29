import { Wrench } from 'lucide-react';
import { useState } from 'react';
import type { Issue } from '../analysis/lint';
import { useStore } from '../store/store';

/** One health issue. Its fix hides behind a wrench: the first click shows what it will do, the second applies it. */
export function IssueRow({ issue, dot, onClick }: { issue: Issue; dot?: boolean; onClick?: () => void }) {
  const [armed, setArmed] = useState(false);
  const fix = issue.fix;
  return (
    <div className="issue" onClick={onClick}>
      {dot && <span className={`sev sev-${issue.severity}`} />}
      <span className="grow">{issue.message}</span>
      {fix && (
        <button
          className={`icon-btn sm ${armed ? 'is-on' : ''}`}
          title={fix.label}
          onClick={(e) => {
            e.stopPropagation();
            setArmed(!armed);
          }}
        >
          <Wrench size={13} />
        </button>
      )}
      {fix && armed && (
        <button
          className={`btn sm issue-apply ${dot ? '' : 'no-dot'}`}
          onClick={(e) => {
            e.stopPropagation();
            setArmed(false);
            useStore.getState().commit((d) => fix.apply(d));
          }}
        >
          <Wrench size={12} /> {fix.label}
        </button>
      )}
    </div>
  );
}
