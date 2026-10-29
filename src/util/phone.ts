import { useEffect, useState } from 'react';

// Below this width the app switches to its limited phone layout (keep in sync with app.css).
export const PHONE_QUERY = '(max-width: 760px)';

export const isPhone = () => typeof window !== 'undefined' && !!window.matchMedia?.(PHONE_QUERY).matches;

export function useIsPhone() {
  const [phone, setPhone] = useState(isPhone);
  useEffect(() => {
    const mq = window.matchMedia(PHONE_QUERY);
    const h = () => setPhone(mq.matches);
    mq.addEventListener('change', h);
    return () => mq.removeEventListener('change', h);
  }, []);
  return phone;
}
