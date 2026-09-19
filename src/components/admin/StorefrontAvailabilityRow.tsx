"use client";

import { useEffect, useState, useTransition } from "react";
import { Select } from "@/components/ui/select";
import { setStorefrontAvailability, clearStorefrontAvailability, getSignalHistory, undoSignalChanges, type SignalHistoryEntry } from "@/app/admin/storefront-availability-actions";
import { AVAILABILITY_SIGNAL_PRESETS } from "@/lib/availability-presets";
import { availabilityLabel } from "@/lib/catalog-format";

interface Props {
  slug: string;
  name?: string;
  currentOverrideKey: string;
  defaultLabel: string;
  customLabel?: string;
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
}

export function StorefrontAvailabilityRow({ slug, name = slug, currentOverrideKey, defaultLabel, customLabel, disabled, onBusyChange }: Props) {
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState(currentOverrideKey);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [retryKey, setRetryKey] = useState<string | null>(null);
  const [undoIds, setUndoIds] = useState<number[]>([]);
  const [history, setHistory] = useState<SignalHistoryEntry[] | null>(null);
  useEffect(() => { setSelected(currentOverrideKey); }, [currentOverrideKey]);

  function save(key: string) {
    const preset = AVAILABILITY_SIGNAL_PRESETS.find((p) => p.key === key);
    if (key && !preset) return;
    setSelected(key);
    setError(null);
    setMessage("");
    setRetryKey(key);
    onBusyChange?.(true);
    startTransition(async () => {
      try {
        const result = preset
          ? await setStorefrontAvailability({ slug, availability: preset.availability, availability_note: preset.note })
          : await clearStorefrontAvailability(slug);
        if (!result.ok) throw new Error(result.error);
        setUndoIds(result.changes.map((change) => change.id));
        setRetryKey(null);
        setHistory(null);
        setMessage("Saved");
      } catch (e) {
        setSelected(currentOverrideKey);
        setError(e instanceof Error ? e.message : "Could not save. Please retry.");
      } finally { onBusyChange?.(false); }
    });
  }

  function undo(ids: number[]) {
    setError(null);
    setRetryKey(null);
    onBusyChange?.(true);
    startTransition(async () => {
      try {
        const result = await undoSignalChanges(ids);
        if (!result.ok) throw new Error(result.error);
        setUndoIds([]);
        setHistory(null);
        setMessage("Change undone");
      } catch (e) { setError(e instanceof Error ? e.message : "Could not undo. Please retry."); }
      finally { onBusyChange?.(false); }
    });
  }

  function loadHistory() {
    setError(null);
    setRetryKey(null);
    startTransition(async () => {
      try {
        const result = await getSignalHistory(slug);
        if (!result.ok) throw new Error(result.error);
        setHistory(result.entries);
      } catch (e) { setError(e instanceof Error ? e.message : "Could not load history. Please retry."); }
    });
  }

  return <div className="min-w-52 space-y-1">
    <Select aria-label={`Stock signal for ${name}`} value={selected} onChange={(e) => save(e.target.value)} disabled={disabled || pending} className="h-9 text-xs">
      <option value="">Default — {defaultLabel}</option>
      {selected === "custom" && <option value="custom" disabled>{customLabel ?? "Custom signal"}</option>}
      {AVAILABILITY_SIGNAL_PRESETS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
    </Select>
    <div role="status" aria-live="polite" className="text-xs text-muted-foreground">{pending ? "Saving / loading…" : message}</div>
    {error && <p role="alert" className="max-w-64 text-xs text-destructive">{error} {retryKey !== null && <button disabled={pending || disabled} className="underline" onClick={() => save(retryKey)}>Retry</button>}</p>}
    <div className="flex gap-3 text-xs text-primary">
      {undoIds.length > 0 && <button disabled={pending || disabled} onClick={() => undo(undoIds)}>Undo</button>}
      <button disabled={pending || disabled} onClick={() => history ? setHistory(null) : loadHistory()}>{history ? "Close history" : "History"}</button>
    </div>
    {history && <ol className="max-w-72 space-y-2 border-t border-border pt-2 text-xs">
      {history.length === 0 && <li>No recorded changes yet.</li>}
      {history.map((entry, index) => <li key={entry.id}>
        <span>{entry.before_value ? availabilityLabel(entry.before_value.availability) : "Default"} → {entry.after_value ? availabilityLabel(entry.after_value.availability) : "Default"}</span>
        {entry.after_value?.availability_note && <p>{entry.after_value.availability_note}</p>}
        <p className="text-muted-foreground">{entry.actor} · {new Date(entry.created_at).toLocaleString()}</p>
        {index === 0 && <button className="text-primary underline" disabled={pending || disabled} onClick={() => undo([entry.id])}>Undo latest change</button>}
      </li>)}
    </ol>}
  </div>;
}
