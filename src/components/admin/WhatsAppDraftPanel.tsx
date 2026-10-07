import { Badge } from "@/components/ui/badge";
import { explainGrouping, reviewReasonText, type AuditRow } from "@/lib/whatsapp-draft";
import { MarkReviewedButton } from "./MarkReviewedButton";

type Props = {
  productId: string;
  needsReview: boolean;
  reasons: string[];
  /** The raw WhatsApp text (admin-only, migration 030). */
  sourceText: string | null;
  /** whatsapp_listing_audit rows for this product. */
  audit: AuditRow[];
};

/**
 * What WhatsApp ingestion knows about a draft it made: why it wants a second
 * look, the text the sender actually typed, and why these photos were grouped
 * with it. Renders nothing for a product that did not come from WhatsApp.
 */
export function WhatsAppDraftPanel({ productId, needsReview, reasons, sourceText, audit }: Props) {
  const grouping = explainGrouping(audit);
  if (!needsReview && !reasons.length && !sourceText && !grouping) return null;
  return (
    <section className="rounded-sm border border-border bg-card p-4" data-testid="whatsapp-draft-panel">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-serif text-lg text-primary">From WhatsApp</h2>
        {needsReview && <Badge variant="amber">Needs review</Badge>}
        {needsReview && <MarkReviewedButton productId={productId} />}
      </div>

      {reasons.length > 0 && (
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-foreground" data-testid="review-reasons">
          {reasons.map((reason) => <li key={reason}>{reviewReasonText(reason)}</li>)}
        </ul>
      )}

      {sourceText && (
        <div className="mt-4">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">What was sent</h3>
          <p className="mt-1 whitespace-pre-wrap break-words rounded-sm bg-muted p-3 text-sm text-foreground" data-testid="source-text">{sourceText}</p>
          <p className="mt-1 text-xs text-muted-foreground">Only visible here. Customers never see this text.</p>
        </div>
      )}

      {grouping && (
        <div className="mt-4" data-testid="why-grouped">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Why these photos are in this listing</h3>
          {grouping.headline && <p className="mt-1 text-sm text-foreground">{grouping.headline}</p>}
          <table className="mt-2 w-full text-left text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr><th className="py-1 pr-3 font-medium">Photos/videos</th><th className="py-1 pr-3 font-medium">Signal</th><th className="py-1 pr-3 font-medium">When</th><th className="py-1 font-medium">Confidence</th></tr>
            </thead>
            <tbody>
              {grouping.signals.map((row) => (
                <tr key={`${row.signal}|${row.confidence}`} className="border-t border-border">
                  <td className="py-1 pr-3">{row.count}</td>
                  <td className="py-1 pr-3">{row.signal}</td>
                  <td className="py-1 pr-3 text-muted-foreground">{row.timing ?? "—"}</td>
                  <td className="py-1">{row.confidence}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
