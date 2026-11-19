// Shared by the e2e test and the demo-video recorder.

// Viewport points at the start and end of a phrase inside an element.
export const textRect = (page, selector, text) =>
  page.evaluate(
    (sel, t) => {
      const el = document.querySelector(sel);
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let full = '';
      const nodes = [];
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        nodes.push([n, full.length]);
        full += n.data;
      }
      const at = full.indexOf(t);
      const point = (off) => {
        for (let i = nodes.length - 1; i >= 0; i--) if (nodes[i][1] <= off) return [nodes[i][0], off - nodes[i][1]];
      };
      const r = document.createRange();
      r.setStart(...point(at));
      r.setEnd(...point(at + t.length));
      const rects = r.getClientRects();
      const first = rects[0];
      const last = rects[rects.length - 1];
      return { x1: first.left + 1, y1: first.top + first.height / 2, x2: last.right - 1, y2: last.top + last.height / 2 };
    },
    selector,
    text,
  );

// Center of a <button> with the given attribute value, piercing closed shadow roots
// (the extension's page UI lives in one). Returns null if there is none.
export async function shadowButton(page, attr, value) {
  const cdp = await page.createCDPSession();
  try {
    const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
    const stack = [root];
    while (stack.length) {
      const n = stack.pop();
      if (n.nodeName === 'BUTTON' && n.attributes) {
        for (let i = 0; i < n.attributes.length; i += 2) {
          if (n.attributes[i] === attr && n.attributes[i + 1] === value) {
            const { model } = await cdp.send('DOM.getBoxModel', { backendNodeId: n.backendNodeId });
            const q = model.content;
            return { x: (q[0] + q[4]) / 2, y: (q[1] + q[5]) / 2 };
          }
        }
      }
      for (const c of [...(n.children ?? []), ...(n.shadowRoots ?? []), ...(n.contentDocument ? [n.contentDocument] : [])]) stack.push(c);
    }
    return null;
  } finally {
    await cdp.detach();
  }
}
