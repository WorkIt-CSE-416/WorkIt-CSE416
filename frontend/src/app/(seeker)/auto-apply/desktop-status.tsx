"use client";

import { Cpu, MonitorOff } from "lucide-react";
import { useEffect, useState } from "react";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/cn";

import { getDesktopStatus, type DesktopStatus } from "./desktop-actions";

/** How often the bar asks again: often while Desktop runs, so its Workers'
 *  count keeps up with Live Activity's 3-second poll; at its heartbeat's
 *  pace while it is off, so a Desktop that starts shows within one beat. */
const ONLINE_POLL_MS = 3_000;
const OFFLINE_POLL_MS = 15_000;

/**
 * WorkIt Desktop's status (KAN-323), read on the server for the first paint
 * (./page.tsx) and then polled here. Null, or any failed read, is offline:
 * an API without the Desktop routes yet is a seeker without Desktop.
 */
export function useDesktopStatus(initial: DesktopStatus | null) {
  const [status, setStatus] = useState<DesktopStatus | null>(initial);
  const online = status?.online === true;

  useEffect(() => {
    let live = true;
    const timer = setInterval(
      async () => {
        const { data } = await getDesktopStatus();
        if (live) setStatus(data);
      },
      online ? ONLINE_POLL_MS : OFFLINE_POLL_MS,
    );
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [online]);

  return [status, setStatus] as const;
}

/**
 * The bar over Live Activity (KAN-323, the Inbox design): whether WorkIt
 * Desktop is running on the seeker's computer, how many of its Workers are
 * filling an application, whether it has paused (near the Claude plan
 * limit, it takes nothing new), and how much of their Claude plan's 5-hour
 * window and week is used, when Desktop reports it. While Desktop is off it says
 * the extension will be used instead, one application at a time, which is
 * what Start Auto Apply then does (./auto-apply-panel.tsx).
 */
export function DesktopStatusBar({
  status,
  className,
}: {
  status: DesktopStatus | null;
  className?: string;
}) {
  const online = status?.online === true;
  return (
    <Card
      padding="none"
      className={cn("flex flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3", className)}
    >
      <div className="flex min-w-0 items-center gap-2">
        {online ? (
          <Cpu aria-hidden className="text-positive size-4 shrink-0" />
        ) : (
          <MonitorOff aria-hidden className="text-ink-meta size-4 shrink-0" />
        )}
        <div className="min-w-0">
          <p className="text-label text-ink">
            {online ? "WorkIt Desktop Connected" : "WorkIt Desktop Not Running"}
          </p>
          <p className="text-note text-ink-meta">
            {online
              ? `${status.busy} of ${status.workers} ${status.workers === 1 ? "Worker" : "Workers"} busy`
              : "Auto Apply will use the WorkIt extension, one application at a time."}
          </p>
          {online && status.paused && (
            <p className="text-note text-warning">
              Paused: {status.paused_reason || "Claude plan limit"}
            </p>
          )}
        </div>
      </div>
      {online && status.usage && (
        <div className="flex flex-wrap gap-x-6 gap-y-3">
          <Meter label="Claude · 5-Hour Window" value={status.usage.five_hour} />
          <Meter label="Claude · This Week" value={status.usage.weekly} />
        </div>
      )}
    </Card>
  );
}

/** A share of the plan used, as a bar: amber past 80%, where a batch may
 *  stop for the window to reset. */
function Meter({ label, value }: { label: string; value: number }) {
  // Desktop sends each window as a share, 0 to 1.
  const percent = Math.min(100, Math.max(0, value * 100));
  return (
    <div className="min-w-36">
      <div className="text-note text-ink-meta flex justify-between gap-3">
        <span>{label}</span>
        <span className="tabular-nums">{Math.round(percent)}%</span>
      </div>
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(percent)}
        className="bg-well mt-1 h-1.5 overflow-hidden rounded-full"
      >
        <div
          className={cn("h-full rounded-full", percent > 80 ? "bg-warning-strong" : "bg-brand")}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
