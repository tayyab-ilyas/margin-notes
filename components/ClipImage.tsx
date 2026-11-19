import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { db } from '../lib/db';
import { downloadBlob } from './download';

export function ClipImage({ id }: { id: string }) {
  const img = useLiveQuery(() => db.images.get(id), [id]);
  const [url, setUrl] = useState<string>();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!img) return;
    const u = URL.createObjectURL(img.blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [img]);

  if (!img || !url) return <div className="clip placeholder" />;

  const copy = async () => {
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': img.blob })]);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <figure className="clip">
      <a href={url} target="_blank" rel="noreferrer" title="Open full size">
        <img src={url} alt="Saved clip" width={img.width} height={img.height} />
      </a>
      <figcaption>
        <button className="link" onClick={copy}>
          {copied ? 'Copied ✓' : 'Copy image'}
        </button>
        <button className="link" onClick={() => downloadBlob(img.blob, `clip-${id.slice(0, 8)}.png`)}>
          Download
        </button>
      </figcaption>
    </figure>
  );
}
