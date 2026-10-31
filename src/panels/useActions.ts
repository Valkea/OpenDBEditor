import { getNodesBounds, useReactFlow } from '@xyflow/react';
import { encodeSchema, shareUrl } from '../share/codec';
import { generateSql } from '../sql/generator';
import { useStore } from '../store/store';
import { copyText, download, pickFile, slug } from '../util/files';

const frame = () => new Promise((r) => requestAnimationFrame(r));

/** Longest side of the exported image, in pixels. */
const MAX_SIDE = 4096;

const SVG_PAINT = ['stroke', 'stroke-width', 'stroke-opacity', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'fill', 'fill-opacity', 'opacity', 'vector-effect'];

/**
 * html-to-image copies computed styles onto HTML elements but not onto the shapes inside an <svg>,
 * so links styled from the stylesheet would come out unstroked (and circles black). Inline their paint
 * for the capture; returns the undo.
 */
function inlineSvgPaint(root: HTMLElement) {
  const saved: [Element, string | null][] = [];
  root.querySelectorAll('svg *').forEach((n) => {
    if (!(n instanceof SVGElement)) return;
    const cs = getComputedStyle(n);
    saved.push([n, n.getAttribute('style')]);
    for (const p of SVG_PAINT) n.style.setProperty(p, cs.getPropertyValue(p));
  });
  return () => saved.forEach(([n, s]) => (s === null ? n.removeAttribute('style') : n.setAttribute('style', s)));
}

export async function exportPng(rf: ReturnType<typeof useReactFlow>, theme: string) {
  const { toPng } = await import('html-to-image');
  const canvas = document.querySelector('.canvas') as HTMLElement;
  const el = document.querySelector('.react-flow__viewport') as HTMLElement;
  if (!canvas || !el || !rf.getNodes().length) return;
  // draw without selection or hover (and at full detail outside Atlas), then let the cards and links settle
  useStore.setState({ exporting: true });
  let restore = () => {};
  try {
    for (let i = 0; i < 4; i++) await frame();
    const nodes = rf.getNodes().filter((n) => !n.hidden);
    if (!nodes.length) return;
    const b = getNodesBounds(nodes);
    const pad = 48;
    const w = Math.ceil(b.width + pad * 2);
    const h = Math.ceil(b.height + pad * 2);
    // 1:1 with the canvas at 100%, sharper for small schemas, scaled down so big ones stay a sensible size
    const pixelRatio = Math.min(2, MAX_SIDE / Math.max(w, h));
    restore = inlineSvgPaint(el);
    const bg = getComputedStyle(canvas).getPropertyValue('--canvas-bg').trim() || (theme === 'dark' ? '#0b0d12' : '#f7f7f5');
    return await toPng(el, {
      backgroundColor: bg,
      width: w,
      height: h,
      pixelRatio,
      filter: (n) => !(n instanceof Element && n.classList.contains('react-flow__handle')),
      style: { width: `${w}px`, height: `${h}px`, transform: `translate(${pad - b.x}px, ${pad - b.y}px) scale(1)` },
    });
  } finally {
    restore();
    useStore.setState({ exporting: false });
  }
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
