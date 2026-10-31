import { getNodesBounds, getViewportForBounds, useReactFlow } from '@xyflow/react';
import { encodeSchema, shareUrl } from '../share/codec';
import { generateSql } from '../sql/generator';
import { useStore } from '../store/store';
import { copyText, download, pickFile, slug } from '../util/files';

export async function exportPng(rf: ReturnType<typeof useReactFlow>, theme: string) {
  const { toPng } = await import('html-to-image');
  const nodes = rf.getNodes();
  if (!nodes.length) return;
  const b = getNodesBounds(nodes);
  const scale = 2;
  const w = Math.min(12000, Math.round((b.width + 160) * scale));
  const h = Math.min(12000, Math.round((b.height + 160) * scale));
  const vp = getViewportForBounds(b, w, h, 0.05, 4, 0.04);
  const el = document.querySelector('.react-flow__viewport') as HTMLElement;
  const bg = getComputedStyle(document.querySelector('.canvas') as HTMLElement).getPropertyValue('--canvas-bg').trim() || (theme === 'dark' ? '#0b0d12' : '#f7f7f5');
  return toPng(el, { backgroundColor: bg, width: w, height: h, style: { width: `${w}px`, height: `${h}px`, transform: `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom})` } });
}

/** File, share and theme actions shared by the top bar and the rail. */
export function useActions() {
  const rf = useReactFlow();
  const st = useStore.getState;

  const share = async () => {
    const url = shareUrl(encodeSchema(st().schema));
    window.history.replaceState(null, '', url);
    if (await copyText(url)) st().toast(`Link copied · ${(url.length / 1024).toFixed(1)} kB · the schema lives in the link itself, no server stores it`);
  };
  const openFile = async () => {
    const f = await pickFile();
    if (f) await st().importSql(await f.text(), f.name);
  };
  const exportSql = (embedLayout: boolean) => {
    const schema = st().schema;
    download(`${slug(schema.name)}.sql`, generateSql(schema, embedLayout ? { embedLayout } : undefined), 'application/sql');
  };
  const exportImage = async () => {
    const { schema, theme } = st();
    const url = await exportPng(rf, theme);
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = `${slug(schema.name)}-${schema.view ?? 'atlas'}.png`;
    a.click();
  };
  const toggleTheme = () => {
    const t = st().theme === 'dark' ? 'light' : 'dark';
    st().set({ theme: t });
    try {
      localStorage.setItem('odbe-theme', t);
    } catch {
      /* ignore */
    }
  };
  /** Where a new table or note lands: the middle of the screen. */
  const center = () => {
    const c = rf.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
    return { x: c.x - 140, y: c.y - 60 };
  };

  return { share, openFile, exportSql, exportImage, toggleTheme, center };
}
