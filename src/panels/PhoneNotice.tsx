import { Smartphone, X } from 'lucide-react';
import { useState } from 'react';
import { useIsPhone } from '../util/phone';

const KEY = 'odbe-phone-notice';

/** On a phone, say up front that this is a reduced version of the app. Dismissed for the session only. */
export function PhoneNotice() {
  const phone = useIsPhone();
  const [hidden, setHidden] = useState(() => {
    try {
      return sessionStorage.getItem(KEY) === '1';
    } catch {
      return false;
    }
  });
  if (!phone || hidden) return null;
  return (
    <div className="phone-notice" role="status">
      <Smartphone size={16} />
      <span>
        <b>Limited phone mode.</b> You can view, explore and share schemas, but editing is cramped and some tools are hidden. For full editing, use a computer or
        a tablet.
      </span>
      <button
        className="icon-btn"
        title="Got it"
        onClick={() => {
          setHidden(true);
          try {
            sessionStorage.setItem(KEY, '1');
          } catch {
            /* ignore */
          }
        }}
      >
        <X size={15} />
      </button>
    </div>
  );
}
