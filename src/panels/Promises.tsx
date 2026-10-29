import { Link2, ShieldCheck, UserX, WifiOff } from 'lucide-react';

/** What happens to the user's data, shown on the welcome screen and behind the "Local only" badge. */
export function Promises({ className }: { className?: string }) {
  return (
    <ul className={className}>
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
  );
}
