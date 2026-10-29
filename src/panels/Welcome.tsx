import { ClipboardPaste, FileUp, Link2, Plus, ShieldCheck, Sparkles, UserX, WifiOff } from 'lucide-react';
import { useState } from 'react';
import { emptySchema } from '../model/types';
import { useStore } from '../store/store';
import { pickFile } from '../util/files';
import sample from '../sample.sql?raw';

export function Welcome() {
  const [paste, setPaste] = useState<string | null>(null);
  const linkError = useStore((s) => s.linkError);
  const st = useStore.getState;
  return (
    <div className="welcome">
      <div className="welcome-card">
        <div className="welcome-orbs" aria-hidden>
          <span style={{ ['--c' as string]: '#7c9cff' }} />
          <span style={{ ['--c' as string]: '#5eead4' }} />
          <span style={{ ['--c' as string]: '#f0abfc' }} />
        </div>
        {linkError && <div className="error-box welcome-error">{linkError}</div>}
        <h1>See your schema.</h1>
        <p>
          Draw PostgreSQL schemas as an <b>atlas</b> of domains, a precise <b>blueprint</b>, or a <b>constellation</b> to explore.
        </p>
        <ul className="welcome-promises">
          <li>
            <ShieldCheck size={16} />
            <span>
              <b>Nothing leaves your browser.</b> Your SQL is parsed and drawn on this device; there is no server, and the page is not even allowed to contact one.
            </span>
          </li>
          <li>
            <WifiOff size={16} />
            <span>
              <b>Works fully offline.</b> Once opened, the whole app is kept on this device: unplug and keep working, or install it as an app.
            </span>
          </li>
          <li>
            <UserX size={16} />
            <span>
              <b>No account, no tracking.</b> No sign-up, no cookies, no analytics. The schema sits after the # in the link, a part browsers never send to any server, even when you open a shared link.
            </span>
          </li>
          <li>
            <Link2 size={16} />
            <span>
              <b>The link is the file.</b> The whole schema, layout included, is packed into the page URL. Share the link to share the schema; bookmark it to save
              your work, even offline. A bookmark only holds the version you bookmarked, so also use <b>Export → SQL + layout</b> to keep a copy: it re-opens with
              your positions and groups.
            </span>
          </li>
        </ul>
        {paste === null ? (
          <div className="welcome-actions">
            <button
              className="btn primary lg"
              onClick={async () => {
                const f = await pickFile();
                if (f) await st().importSql(await f.text(), f.name);
              }}
            >
              <FileUp size={16} /> Open a .sql file
            </button>
            <button className="btn lg" onClick={() => setPaste('')}>
              <ClipboardPaste size={16} /> Paste SQL
            </button>
            <button className="btn lg" onClick={() => void st().importSql(sample, 'Bookshop (sample)')}>
              <Sparkles size={16} /> Try a sample
            </button>
            <button
              className="btn lg ghost"
              onClick={() => {
                st().load(emptySchema());
                st().addTable({ x: 0, y: 0 });
              }}
            >
              <Plus size={16} /> Start blank
            </button>
          </div>
        ) : (
          <div className="welcome-paste">
            <textarea className="input mono" autoFocus rows={10} placeholder="CREATE TABLE …" value={paste} onChange={(e) => setPaste(e.target.value)} />
            <div className="row">
              <button className="btn" onClick={() => setPaste(null)}>
                Back
              </button>
              <span className="grow" />
              <button className="btn primary" disabled={!paste.trim()} onClick={() => void st().importSql(paste, 'Pasted schema')}>
                Import
              </button>
            </div>
          </div>
        )}
        <div className="welcome-foot">Tip: drop a .sql file anywhere on the page · ⌘K for commands</div>
      </div>
    </div>
  );
}
