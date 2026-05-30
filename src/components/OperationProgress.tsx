"use client";

import { useEffect, useMemo, useState } from "react";

import { Progress } from "@/components/ui/progress";

type OperationProgressProps = {
  active: boolean;
  label: string;
  estimateSeconds?: number;
};

export function OperationProgress({
  active,
  label,
  estimateSeconds = 90,
}: OperationProgressProps) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    if (!active) {
      setElapsedSeconds(0);
      return;
    }

    setElapsedSeconds(0);
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      setElapsedSeconds(Math.max(1, Math.floor((Date.now() - startedAt) / 1000)));
    }, 1000);

    return () => window.clearInterval(timer);
  }, [active]);

  const progress = useMemo(() => {
    if (!active) return 0;
    const estimated = Math.max(15, estimateSeconds);
    const pct = Math.round((elapsedSeconds / estimated) * 92);
    return Math.min(96, Math.max(6, pct));
  }, [active, elapsedSeconds, estimateSeconds]);

  if (!active) return null;

  const remaining = Math.max(0, estimateSeconds - elapsedSeconds);
  const remainingLabel =
    remaining > 0 ? `about ${formatDuration(remaining)} left` : "finishing final checks";

  return (
    <div className="mt-4 rounded-lg border border-primary/20 bg-primary/5 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="font-semibold text-primary">{label}</div>
        <div className="text-muted-foreground">
          {progress}% - {formatDuration(elapsedSeconds)} elapsed - {remainingLabel}
        </div>
      </div>
      <Progress value={progress} className="h-2" />
    </div>
  );
}

function formatDuration(totalSeconds: number) {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  if (minutes <= 0) return `${seconds}s`;
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}
