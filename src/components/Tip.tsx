import type { ReactNode } from 'react';

/**
 * Plain-English hover explanation. Wrap any label/header:
 *   <Tip tip="What this column means in dummy-proof terms">Margin</Tip>
 */
export default function Tip({ tip, children }: { tip: string; children: ReactNode }) {
  return (
    <span className="tip" data-tip={tip}>
      {children}
    </span>
  );
}
