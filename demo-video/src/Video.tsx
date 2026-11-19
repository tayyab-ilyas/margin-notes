import React from 'react';
import { AbsoluteFill, Easing, Img, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { loadFont } from '@remotion/google-fonts/Inter';
import timeline from '../public/rec/timeline.json';

const { fontFamily } = loadFont('normal', { weights: ['400', '500', '600', '700', '800'], subsets: ['latin'] });

export const FPS = 30;
const M = Object.fromEntries(timeline.marks.map((m) => [m.name, m])) as Record<string, { t: number; at?: { x: number; y: number } }>;
const REC_START = M.highlight.t - 1200;
const REC_END = M.end.t + 400;
const INTRO = 105;
const PROBLEM = 165;
const DEMO = Math.round(((REC_END - REC_START) / 1000) * FPS);
const OUTRO = 240;
export const TOTAL = INTRO + PROBLEM + DEMO + OUTRO;

const BG = '#0d0d10';
const ACCENT = '#f6c945';
const ease = Easing.bezier(0.45, 0, 0.2, 1);

// Fade a whole scene in and out so cuts are soft.
const Fade: React.FC<{ len: number; children: React.ReactNode }> = ({ len, children }) => {
  const f = useCurrentFrame();
  const o = interpolate(f, [0, 10, len - 10, len], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return <AbsoluteFill style={{ opacity: o }}>{children}</AbsoluteFill>;
};

// ---------- Intro ----------
const Intro: React.FC = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame: f, fps, config: { damping: 14 } });
  const sweep = interpolate(f, [18, 38], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease });
  const tag = interpolate(f, [40, 55], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ background: BG, alignItems: 'center', justifyContent: 'center', fontFamily }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 36, transform: `scale(${0.9 + 0.1 * pop})`, opacity: pop }}>
        <Img src={staticFile('icon.png')} style={{ width: 120, height: 120, borderRadius: 28 }} />
        <div style={{ fontSize: 128, fontWeight: 800, color: '#fff', letterSpacing: -4 }}>
          Margin{' '}
          <span style={{ position: 'relative', display: 'inline-block' }}>
            <span
              style={{
                position: 'absolute', left: -8, right: -8, top: '52%', bottom: '4%', background: ACCENT, borderRadius: 6,
                transform: `scaleX(${sweep})`, transformOrigin: 'left', opacity: 0.9,
              }}
            />
            <span style={{ position: 'relative' }}>Notes</span>
          </span>
        </div>
      </div>
      <div style={{ marginTop: 40, fontSize: 40, color: '#a7a7b0', opacity: tag, transform: `translateY(${(1 - tag) * 12}px)` }}>
        Highlight, annotate and clip anything you read on the web.
      </div>
    </AbsoluteFill>
  );
};

// ---------- Problem ----------
const Problem: React.FC = () => {
  const f = useCurrentFrame();
  const l1 = interpolate(f, [0, 14], [0, 1], { extrapolateRight: 'clamp' });
  const l2 = interpolate(f, [34, 48], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const words = "you can't remember a word of it.".split(' ');
  return (
    <AbsoluteFill style={{ background: BG, alignItems: 'center', justifyContent: 'center', fontFamily, color: '#fff', textAlign: 'center' }}>
      <div style={{ fontSize: 76, fontWeight: 700, letterSpacing: -2, opacity: l1, transform: `translateY(${(1 - l1) * 16}px)` }}>
        You read something great.
      </div>
      <div style={{ marginTop: 24, fontSize: 76, fontWeight: 700, letterSpacing: -2, opacity: l2, transform: `translateY(${(1 - l2) * 16}px)` }}>
        <span style={{ color: '#a7a7b0' }}>A week later, </span>
        {words.map((w, i) => {
          // The words fade and blur away one by one: forgetting.
          const k = interpolate(f, [80 + i * 9, 104 + i * 9], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
          return (
            <span key={i} style={{ opacity: 1 - 0.85 * k, filter: `blur(${k * 10}px)`, display: 'inline-block', marginRight: 18 }}>
              {w}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

// ---------- Demo ----------
type Stream = keyof typeof timeline.streams;
function frameAt(stream: Stream, t: number) {
  const s = timeline.streams[stream] as [number, string][];
  let lo = 0;
  let hi = s.length - 1;
  if (t <= s[0][0]) return s[0][1];
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (s[mid][0] <= t) lo = mid;
    else hi = mid - 1;
  }
  return s[lo][1];
}
const Rec: React.FC<{ stream: Stream; t: number; w: number; h: number }> = ({ stream, t, w, h }) => (
  <Img src={staticFile(`rec/${stream}/${frameAt(stream, t)}`)} style={{ width: w, height: h, display: 'block' }} />
);

const BAR = 84; // tab strip + toolbar
const PAGE = timeline.sizes.page;
const PANEL = timeline.sizes.panel;
const WIN_W = PAGE.width + PANEL.width;
const WIN_H = PAGE.height + BAR;
const BASE = 0.86;
const WIN_LEFT = (1920 - WIN_W * BASE) / 2;
const WIN_TOP = 40;

// Camera keyframes in recording time; x/y are points in window coordinates to zoom toward.
const panelPt = { x: PAGE.width + PANEL.width / 2, y: BAR + 470 };
const cams: { t: number; s: number; x: number; y: number }[] = [
  { t: 0, s: 1, x: M.toolbar.at!.x, y: M.toolbar.at!.y + BAR },
  { t: M.toolbar.t - 300, s: 1, x: M.toolbar.at!.x, y: M.toolbar.at!.y + BAR },
  { t: M.toolbar.t + 500, s: 1.55, x: M.toolbar.at!.x, y: M.toolbar.at!.y + BAR },
  { t: M.highlighted.t + 900, s: 1.55, x: M.toolbar.at!.x, y: M.toolbar.at!.y + BAR },
  { t: M.highlighted.t + 1700, s: 1, x: M.toolbar.at!.x, y: M.toolbar.at!.y + BAR },
  { t: M.typing.t - 1600, s: 1, x: M.typing.at!.x, y: M.typing.at!.y + BAR + 60 },
  { t: M.typing.t - 600, s: 1.5, x: M.typing.at!.x, y: M.typing.at!.y + BAR + 60 },
  { t: M.noted.t + 700, s: 1.5, x: M.typing.at!.x, y: M.typing.at!.y + BAR + 60 },
  { t: M.noted.t + 1500, s: 1, x: M.typing.at!.x, y: M.typing.at!.y + BAR + 60 },
  { t: M.panel.t, s: 1, ...panelPt },
  { t: M.panel.t + 800, s: 1.4, ...panelPt },
  { t: M.shown.t + 1200, s: 1.4, ...panelPt },
  { t: M.shown.t + 2000, s: 1, ...panelPt },
  { t: M.library.t + 500, s: 1, x: WIN_W / 2, y: BAR },
  { t: M.library.t + 1400, s: 1.4, x: WIN_W / 2, y: BAR },
  { t: REC_END, s: 1.4, x: WIN_W / 2, y: BAR },
];
function camera(t: number) {
  const ts = cams.map((c) => c.t);
  const at = (k: 's' | 'x' | 'y') =>
    interpolate(t, ts, cams.map((c) => c[k]), { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease });
  return { s: at('s'), x: at('x'), y: at('y') };
}

const captions: { from: string; to: string; text: string; keys?: string[] }[] = [
  { from: 'highlight', to: 'note', text: 'Select any text. Highlight it in one click.' },
  { from: 'note', to: 'snip', text: 'Add a thought, in your own words.' },
  { from: 'snip', to: 'panel', text: 'Snip charts and figures as images.', keys: ['Alt', 'Shift', 'S'] },
  { from: 'panel', to: 'shown', text: 'Everything from this page, in the side panel.' },
  { from: 'shown', to: 'reload', text: 'Jump back to any highlight.' },
  { from: 'reload', to: 'library', text: 'Come back later. Your highlights are still there.' },
  { from: 'library', to: 'export', text: 'Search every note, across every page.' },
  { from: 'export', to: 'end', text: 'Export it all to Markdown.' },
];

const Caption: React.FC<{ t: number }> = ({ t }) => {
  const c = captions.find((c) => t >= M[c.from].t && t < (c.to === 'end' ? REC_END : M[c.to].t));
  if (!c) return null;
  const start = M[c.from].t;
  const end = c.to === 'end' ? REC_END : M[c.to].t;
  const o = interpolate(t, [start, start + 250, end - 200, end], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, bottom: 52, display: 'flex', justifyContent: 'center', opacity: o, transform: `translateY(${(1 - o) * 10}px)` }}>
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 22, padding: '18px 34px', borderRadius: 999, background: 'rgba(18,18,22,.88)',
          border: '1px solid rgba(255,255,255,.12)', boxShadow: '0 12px 40px rgba(0,0,0,.45)', color: '#fff', fontSize: 40, fontWeight: 600, letterSpacing: -0.5,
        }}
      >
        {c.text}
        {c.keys && (
          <span style={{ display: 'flex', gap: 8 }}>
            {c.keys.map((k) => (
              <span key={k} style={{ fontSize: 26, fontWeight: 600, padding: '6px 14px', borderRadius: 10, background: '#2a2a31', border: '1px solid #44444d', borderBottomWidth: 3 }}>
                {k}
              </span>
            ))}
          </span>
        )}
      </div>
    </div>
  );
};

const WindowChrome: React.FC<{ library: number }> = ({ library }) => {
  const title = library < 0.5 ? 'Why you forget what you read' : 'Margin Notes · Library';
  const url = library < 0.5 ? 'slowreader.example/why-you-forget' : 'Margin Notes  |  Library';
  return (
    <div style={{ height: BAR, background: '#dee1e6', fontFamily, fontSize: 15, color: '#3c4043' }}>
      <div style={{ height: 40, display: 'flex', alignItems: 'flex-end', paddingLeft: 16, gap: 10 }}>
        <div style={{ display: 'flex', gap: 8, alignSelf: 'center', marginRight: 12 }}>
          {['#ff5f57', '#febc2e', '#28c840'].map((c) => <span key={c} style={{ width: 13, height: 13, borderRadius: 7, background: c }} />)}
        </div>
        <div style={{ height: 34, width: 280, background: '#fff', borderRadius: '10px 10px 0 0', display: 'flex', alignItems: 'center', gap: 10, padding: '0 14px' }}>
          {library < 0.5 ? (
            <span style={{ width: 16, height: 16, borderRadius: 4, background: '#1d1d1f', color: '#fff', fontSize: 11, fontWeight: 700, display: 'grid', placeItems: 'center' }}>S</span>
          ) : (
            <Img src={staticFile('icon.png')} style={{ width: 16, height: 16 }} />
          )}
          <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</span>
        </div>
      </div>
      <div style={{ height: 44, background: '#fff', display: 'flex', alignItems: 'center', gap: 18, padding: '0 16px', borderBottom: '1px solid #dadce0' }}>
        <span style={{ color: '#5f6368', fontSize: 20, letterSpacing: 10 }}>←→↻</span>
        <div style={{ flex: 1, height: 32, borderRadius: 16, background: '#f1f3f4', display: 'flex', alignItems: 'center', padding: '0 16px', fontSize: 16 }}>{url}</div>
        <span style={{ width: 32, height: 32, borderRadius: 8, background: '#e8eaed', display: 'grid', placeItems: 'center' }}>
          <Img src={staticFile('icon.png')} style={{ width: 20, height: 20 }} />
        </span>
      </div>
    </div>
  );
};

const Demo: React.FC = () => {
  const f = useCurrentFrame();
  const t = REC_START + (f / FPS) * 1000;
  const cam = camera(t);
  const library = interpolate(t, [M.library.t - 250, M.library.t + 150], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ background: `radial-gradient(1200px 700px at 50% 35%, #26222a 0%, ${BG} 70%)`, fontFamily, overflow: 'hidden' }}>
      <div style={{ position: 'absolute', left: WIN_LEFT, top: WIN_TOP, width: WIN_W * BASE, height: WIN_H * BASE }}>
        <div
          style={{
            width: WIN_W, height: WIN_H, transformOrigin: '0 0',
            transform: `scale(${BASE}) translate(${cam.x}px, ${cam.y}px) scale(${cam.s}) translate(${-cam.x}px, ${-cam.y}px)`,
            borderRadius: 14, overflow: 'hidden', boxShadow: '0 30px 90px rgba(0,0,0,.55), 0 0 0 1px rgba(255,255,255,.08)', background: '#fff',
          }}
        >
          <WindowChrome library={library} />
          <div style={{ position: 'relative', width: WIN_W, height: PAGE.height }}>
            <div style={{ display: 'flex', position: 'absolute', inset: 0 }}>
              <Rec stream="page" t={t} w={PAGE.width} h={PAGE.height} />
              <div style={{ borderLeft: '1px solid #dadce0' }}>
                <Rec stream="panel" t={t} w={PANEL.width - 1} h={PANEL.height} />
              </div>
            </div>
            {library > 0 && (
              <div style={{ position: 'absolute', inset: 0, opacity: library }}>
                <Rec stream="library" t={Math.max(t, M.library.t)} w={WIN_W} h={PAGE.height} />
              </div>
            )}
          </div>
        </div>
      </div>
      <Caption t={t} />
    </AbsoluteFill>
  );
};

// ---------- Outro ----------
const points = ['Highlights and notes that stay on the page', 'Search and export everything you save', 'Local-first: no account, nothing leaves your browser'];
const Outro: React.FC = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const listOut = interpolate(f, [118, 132], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const card = spring({ frame: f - 130, fps, config: { damping: 15 } });
  return (
    <AbsoluteFill style={{ background: BG, fontFamily, color: '#fff' }}>
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', opacity: listOut }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 34 }}>
          {points.map((p, i) => {
            const k = interpolate(f, [8 + i * 22, 22 + i * 22], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease });
            return (
              <div key={p} style={{ display: 'flex', alignItems: 'center', gap: 26, fontSize: 52, fontWeight: 650, letterSpacing: -1, opacity: k, transform: `translateX(${(1 - k) * -24}px)` }}>
                <span style={{ width: 52, height: 52, borderRadius: 26, background: ACCENT, color: BG, display: 'grid', placeItems: 'center', fontSize: 32, fontWeight: 800 }}>✓</span>
                {p}
              </div>
            );
          })}
        </div>
      </AbsoluteFill>
      {f > 125 && (
        <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', opacity: card, transform: `scale(${0.94 + 0.06 * card})` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 30 }}>
            <Img src={staticFile('icon.png')} style={{ width: 104, height: 104, borderRadius: 24 }} />
            <div style={{ fontSize: 108, fontWeight: 800, letterSpacing: -3.5 }}>Margin Notes</div>
          </div>
          <div style={{ marginTop: 28, fontSize: 38, color: '#a7a7b0' }}>Read it once. Keep it for good.</div>
          <div style={{ marginTop: 44, fontSize: 26, color: '#76767f', letterSpacing: 2, textTransform: 'uppercase', fontWeight: 600 }}>For Chrome and Edge</div>
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
};

export const Video: React.FC = () => (
  <AbsoluteFill style={{ background: BG }}>
    <Sequence durationInFrames={INTRO}>
      <Fade len={INTRO}><Intro /></Fade>
    </Sequence>
    <Sequence from={INTRO} durationInFrames={PROBLEM}>
      <Fade len={PROBLEM}><Problem /></Fade>
    </Sequence>
    <Sequence from={INTRO + PROBLEM} durationInFrames={DEMO}>
      <Fade len={DEMO}><Demo /></Fade>
    </Sequence>
    <Sequence from={INTRO + PROBLEM + DEMO} durationInFrames={OUTRO}>
      <Fade len={OUTRO + 30}><Outro /></Fade>
    </Sequence>
  </AbsoluteFill>
);
