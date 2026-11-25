import { useCallback, useEffect, useState } from "react";
import { adminApi } from "./adminApi";

// Carga simple con recarga manual
export function useData<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const reload = useCallback(() => {
    adminApi.get<T>(path).then((d) => { setData(d); setError(""); }).catch((e: Error) => setError(e.message));
  }, [path]);
  useEffect(reload, [reload]);
  return { data, setData, error, reload };
}
