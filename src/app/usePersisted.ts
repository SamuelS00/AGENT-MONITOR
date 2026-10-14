import { useEffect, useState } from "react";

const read = <T>(key: string, fallback: T): T => {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
};
const write = (key: string, v: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* storage may be blocked */
  }
};

export function usePersisted<T>(key: string, initial: T) {
  const [v, setV] = useState<T>(() => read(key, initial));
  useEffect(() => write(key, v), [key, v]);
  return [v, setV] as const;
}
