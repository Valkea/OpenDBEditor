import { useReactFlow } from '@xyflow/react';
import { useCallback } from 'react';
import { CARD_W, cardHeight } from '../layout/geometry';
import { useStore } from '../store/store';
import { isPhone } from '../util/phone';

/** Select a table and move the camera onto it. */
export function useFly() {
  const rf = useReactFlow();
  return useCallback(
    (tableId: string, columnId?: string) => {
      const st = useStore.getState();
      const t = st.schema.tables.find((x) => x.id === tableId);
      if (!t) return;
      st.select({ kind: 'table', id: tableId, columnId });
      // phone: the side panel covers the diagram, and the inspector sheet its lower half; show the table above the sheet
      const phone = isPhone();
      if (phone) st.set({ sidebar: null });
      const lift = (zoom: number) => (phone ? (window.innerHeight * 0.3) / zoom : 0);
      if ((st.schema.view ?? 'atlas') === 'constellation') {
        const n = rf.getNode(tableId);
        if (n) rf.setCenter(n.position.x + (n.width ?? 0) / 2, n.position.y + (n.height ?? 0) / 2 + lift(1.1), { zoom: 1.1, duration: 600 });
        return;
      }
      const zoom = Math.max(rf.getZoom(), 0.85);
      rf.setCenter(t.x + CARD_W / 2, t.y + cardHeight(t, st.schema) / 2 + lift(zoom), { zoom, duration: 600 });
    },
    [rf],
  );
}
