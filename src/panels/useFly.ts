import { useReactFlow } from '@xyflow/react';
import { useCallback } from 'react';
import { CARD_W, cardHeight } from '../layout/geometry';
import { useStore } from '../store/store';

/** Select a table and move the camera onto it. */
export function useFly() {
  const rf = useReactFlow();
  return useCallback(
    (tableId: string, columnId?: string) => {
      const st = useStore.getState();
      const t = st.schema.tables.find((x) => x.id === tableId);
      if (!t) return;
      st.select({ kind: 'table', id: tableId, columnId });
      if ((st.schema.view ?? 'atlas') === 'constellation') {
        const n = rf.getNode(tableId);
        if (n) rf.setCenter(n.position.x + (n.width ?? 0) / 2, n.position.y + (n.height ?? 0) / 2, { zoom: 1.1, duration: 600 });
        return;
      }
      rf.setCenter(t.x + CARD_W / 2, t.y + cardHeight(t, st.schema) / 2, { zoom: Math.max(rf.getZoom(), 0.85), duration: 600 });
    },
    [rf],
  );
}
