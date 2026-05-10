import { useEffect, useState } from "react";
import { timeAgo } from "@/lib/time";

export function TimeAgo({ ts }: { ts: number }) {
  const [label, setLabel] = useState("…");
  useEffect(() => {
    setLabel(timeAgo(ts));
    const id = setInterval(() => setLabel(timeAgo(ts)), 30000);
    return () => clearInterval(id);
  }, [ts]);
  return <span suppressHydrationWarning>{label}</span>;
}
