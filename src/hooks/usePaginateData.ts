import { useEffect, useMemo, useRef, useState } from "react";
import { useInView } from "react-intersection-observer";

import type { Card } from "../types/interfaces/Card";

const chunk = <T>(arr: T[], size: number): T[][] => {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
};

export const usePaginateData = (cards: Card[]) => {
  // FIX: memoize chunkedData so it doesn't change identity on every render,
  // which was causing an infinite loop in the useEffect below.
  const chunkedData = useMemo(() => chunk(cards, 10), [cards]);
  const [page, setPage] = useState(0);
  const [data, setData] = useState(chunkedData[0] ?? []);
  const { ref, inView } = useInView();

  // Keep a ref to chunkedData so the effect can read the latest value
  // without needing it as a dependency (prevents stale-closure issues).
  const chunkedRef = useRef(chunkedData);
  chunkedRef.current = chunkedData;

  useEffect(() => {
    if (inView) {
      const nextPage = page + 1;
      if (chunkedRef.current[nextPage]) {
        setPage(nextPage);
        setData((prev) => [...prev, ...chunkedRef.current[nextPage]]);
      }
    }
    // chunkedData intentionally excluded – accessed via ref to avoid infinite loop
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inView, page]);

  return {
    ref,
    data,
  };
};
