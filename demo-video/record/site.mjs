// Demo articles served locally for the recording. Original text, no third-party content.
const shell = (title, body) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>
  body{margin:0;background:#fbfaf7;color:#1d1d1f;font:20px/1.7 Charter,'Iowan Old Style',Georgia,serif}
  .site{border-bottom:1px solid #e7e3da;background:#fff}
  .site div{max-width:720px;margin:0 auto;padding:18px 24px;display:flex;justify-content:space-between;font:600 15px/1 system-ui,sans-serif;letter-spacing:.02em}
  .site span{color:#8a8578;font-weight:500}
  main{max-width:720px;margin:0 auto;padding:40px 24px 200px}
  h1{font:700 44px/1.15 system-ui,sans-serif;letter-spacing:-.02em;margin:0 0 14px}
  .dek{font-size:22px;color:#55524b;margin:0 0 18px}
  .by{font:14px system-ui,sans-serif;color:#8a8578;margin-bottom:34px}
  h2{font:700 26px/1.3 system-ui,sans-serif;margin:44px 0 10px}
  figure{margin:36px 0;padding:22px;background:#fff;border:1px solid #e7e3da;border-radius:12px}
  figcaption{font:14px/1.5 system-ui,sans-serif;color:#6f6b62;margin-top:10px}
  blockquote{margin:28px 0;padding-left:20px;border-left:3px solid #d9a441;color:#3b3a36;font-style:italic}
</style></head><body>
<div class="site"><div>Slow Reader <span>Essays on attention</span></div></div>
<main>${body}</main></body></html>`;

const curve = `<svg viewBox="0 0 640 300" width="100%" role="img" aria-label="Retention falls fast, then levels off">
  <g font-family="system-ui,sans-serif" font-size="13" fill="#6f6b62">
    <line x1="60" y1="250" x2="620" y2="250" stroke="#cfcabd"/><line x1="60" y1="20" x2="60" y2="250" stroke="#cfcabd"/>
    <text x="20" y="30">100%</text><text x="28" y="140">50%</text><text x="36" y="252">0%</text>
    <text x="56" y="272">read</text><text x="150" y="272">1 day</text><text x="290" y="272">1 week</text><text x="560" y="272">1 month</text>
  </g>
  <path d="M60 25 C 110 140, 160 180, 220 196 S 400 214, 620 220" fill="none" stroke="#c2410c" stroke-width="4"/>
  <path d="M60 25 C 110 140, 140 150, 170 160 L170 60 C 230 110, 280 120, 330 126 L330 50 C 420 80, 520 90, 620 92" fill="none" stroke="#15803d" stroke-width="4" stroke-dasharray="2 0"/>
  <g font-family="system-ui,sans-serif" font-size="14" font-weight="600">
    <text x="470" y="210" fill="#c2410c">read once</text><text x="430" y="78" fill="#15803d">read, noted, revisited</text>
  </g>
</svg>`;

export const MAIN = shell(
  'Why you forget what you read',
  `<h1>Why you forget what you read</h1>
<p class="dek">And the small habit that makes the good parts stick.</p>
<p class="by">8 min read · Essays on attention</p>
<p>You finish a long article feeling sharper. It was clear, it was convincing, and you agreed with most of it. Ask yourself about it next Tuesday and you will find a pleasant fog where the argument used to be.</p>
<p id="p-forget">Most of what we read is gone within a week, and the loss is steepest in the first day.</p>
<p>This is not a character flaw. Memory is built to discard. Anything that is not used again is treated as noise, and an article read once, in one sitting, is almost never used again.</p>
<h2>Reading is not the same as keeping</h2>
<p id="p-notes">The readers who seem to remember everything are rarely the fastest. They are the ones who leave a trail: a highlight here, a sentence in their own words there, something they can come back to.</p>
<p>A note in your own words is a small act of rebuilding the idea. That rebuilding is exactly the work memory needs.</p>
<figure id="fig">${curve}<figcaption>Figure 1. Retention after one reading versus reading with notes and short reviews. Illustrative.</figcaption></figure>
<p>Each return trip is cheap, because you are not re-reading the whole piece. You are re-reading the two or three lines you decided mattered.</p>
<blockquote>Highlights are a conversation with your future self. Keep them short enough that you will actually read them.</blockquote>
<h2>Make it effortless</h2>
<p id="p-friction">The habit only survives if it costs nothing in the moment. If saving a thought means switching apps, it will not happen.</p>
<p>So keep the tools where the reading happens. Mark the line, say what you think, and keep going.</p>`,
);

export const EXTRA = {
  '/slow-reading': shell(
    'The case for slow reading',
    `<h1>The case for slow reading</h1><p class="dek">Speed is the wrong metric.</p>
<p id="a">Reading slowly is not a failure of efficiency; it is how an argument gets inside your head.</p>
<p id="b">Pause at the end of each section and say what it claimed, in one sentence.</p>`,
  ),
  '/reusable-notes': shell(
    'How to write notes you will actually reuse',
    `<h1>How to write notes you will actually reuse</h1><p class="dek">Fewer, sharper, in your own words.</p>
<p id="a">A good note answers one question: why did this matter to me?</p>
<p id="b">Tag notes by the project they serve, not the topic they mention.</p>`,
  ),
};
