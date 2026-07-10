"use client";

import { useEffect, useRef, useState } from "react";

/** Numbers glide to new values instead of jumping — motion only on real change. */
export function CountUp({ value, suffix = "" }: { value: number; suffix?: string }) {
  const [shown, setShown] = useState(value);
  const prev = useRef(value);

  useEffect(() => {
    const from = prev.current;
    if (from === value) return;
    prev.current = value;
    const start = performance.now();
    const duration = 600;
    let raf: number;
    const step = (t: number) => {
      const p = Math.min(1, (t - start) / duration);
      setShown(Math.round(from + (value - from) * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);

  return (
    <span>
      {shown}
      {suffix}
    </span>
  );
}
