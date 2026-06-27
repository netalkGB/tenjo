import { useEffect, useRef } from 'react';
import { useTranslation } from '@/hooks/useTranslation';

const PROMPT_KEYS = [
  'agent_example_prompt_1',
  'agent_example_prompt_2',
  'agent_example_prompt_3',
  'agent_example_prompt_4',
  'agent_example_prompt_5',
  'agent_example_prompt_6',
  'agent_example_prompt_7',
  'agent_example_prompt_8'
];

interface MarqueeRowProps {
  keys: string[];
  speed: number;
  reverse?: boolean;
}

function MarqueeRow({ keys, speed, reverse = false }: MarqueeRowProps) {
  const { t } = useTranslation();
  const trackRef = useRef<HTMLDivElement>(null);
  const offsetRef = useRef<number | null>(null);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;

    let raf = 0;
    let lastTime = performance.now();

    const tick = (now: number) => {
      const dt = (now - lastTime) / 1000;
      lastTime = now;

      const halfWidth = track.scrollWidth / 2;
      if (halfWidth > 0) {
        if (offsetRef.current === null) {
          offsetRef.current = reverse ? -halfWidth : 0;
        }
        offsetRef.current += (reverse ? 1 : -1) * speed * dt;
        if (!reverse && offsetRef.current <= -halfWidth) {
          offsetRef.current += halfWidth;
        } else if (reverse && offsetRef.current >= 0) {
          offsetRef.current -= halfWidth;
        }
        track.style.transform = `translateX(${offsetRef.current}px)`;
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [speed, reverse]);

  // Duplicate items so the track wraps seamlessly.
  const items = [...keys, ...keys];

  return (
    <div className="overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_12%,black_88%,transparent)]">
      <div
        ref={trackRef}
        className="flex w-max gap-16 whitespace-nowrap py-1.5 text-sm font-light tracking-wide text-muted-foreground/70"
      >
        {items.map((key, index) => (
          <span key={`${key}-${index}`}>{t(key)}</span>
        ))}
      </div>
    </div>
  );
}

export function PromptMarquee() {
  const half = Math.ceil(PROMPT_KEYS.length / 2);
  const rowA = PROMPT_KEYS.slice(0, half);
  const rowB = [...PROMPT_KEYS.slice(half), ...PROMPT_KEYS.slice(0, half)];

  return (
    <div className="space-y-1 select-none">
      <MarqueeRow keys={rowA} speed={28} />
      <MarqueeRow keys={rowB} speed={20} reverse />
    </div>
  );
}
