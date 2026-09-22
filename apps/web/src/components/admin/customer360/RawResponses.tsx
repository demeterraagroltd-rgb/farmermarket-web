"use client";

import { useState } from "react";
import { Badge } from "../../ui/Badge";
import { Button } from "../../ui/Button";
import { formatDateTime } from "../../../lib/format";
import {
  ENDPOINT_LABEL,
  SYNC_TRIGGER_LABEL,
  timeAgo,
  type RawResponseList,
  type RawResponseView,
} from "../../../lib/customer360";
import { DataTable, Section, Td } from "./parts";
import { JsonViewer } from "./JsonViewer";
import { useStoredData } from "./useStoredData";

// Mono's original responses, sealed at rest and readable only by admin and
// super_admin. Opening one decrypts it server-side and writes an audit row, so
// nothing here is fetched until the person clicks View.

function Opened({ customerId, rawId, onClose }: { customerId: string; rawId: string; onClose: () => void }) {
  const { data, error, loading } = useStoredData<RawResponseView>(`/v1/admin/customers/${customerId}/mono-raw/${rawId}`);
  return (
    <div className="mt-4 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-text-dark">
          {data ? `${ENDPOINT_LABEL[data.endpoint] ?? data.endpoint} · ${formatDateTime(data.retrievedAt)}` : "Opening…"}
        </p>
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
      {loading && !data && <p className="text-xs text-text-muted">Decrypting…</p>}
      {error && <p className="text-sm text-error">{error}</p>}
      {data && <JsonViewer value={data.payload} />}
      <p className="text-xs text-text-muted">This view was recorded in the audit log.</p>
    </div>
  );
}

export function RawResponses({ customerId }: { customerId: string }) {
  const { data, error } = useStoredData<RawResponseList>(`/v1/admin/customers/${customerId}/mono-raw`);
  const [open, setOpen] = useState<string | null>(null);

  return (
    <Section
      title="Raw Mono responses"
      description="What Mono actually returned, kept encrypted for 90 days for audit and debugging. Admin and super admin only; every view is logged."
    >
      {error && !data ? (
        <p className="text-sm text-error">{error}</p>
      ) : !data ? (
        <p className="text-sm text-text-muted">Loading…</p>
      ) : data.items.length === 0 ? (
        <p className="text-sm text-text-muted">
          {data.storageEnabled
            ? "Nothing captured in the last 90 days. The next sync will store its responses here."
            : "Raw responses aren't being stored: MONO_RAW_ENCRYPTION_KEY isn't set on the API, so nothing is written. The parsed data is unaffected."}
        </p>
      ) : (
        <>
          <DataTable head={["Captured", "Endpoint", "Source", "Size", "Expires", ""]}>
            {data.items.map((r) => (
              <tr key={r.id}>
                <Td className="whitespace-nowrap text-text-medium">
                  <span title={formatDateTime(r.retrievedAt)}>{timeAgo(r.retrievedAt)}</span>
                </Td>
                <Td>
                  <Badge tone="info">{ENDPOINT_LABEL[r.endpoint] ?? r.endpoint}</Badge>
                </Td>
                <Td className="text-text-muted">
                  {r.trigger ? (SYNC_TRIGGER_LABEL[r.trigger as keyof typeof SYNC_TRIGGER_LABEL] ?? r.trigger) : "—"}
                </Td>
                <Td className="tabular-nums text-text-muted">{(r.payloadBytes / 1024).toFixed(1)} KB</Td>
                <Td className="whitespace-nowrap text-text-muted">{formatDateTime(r.expiresAt)}</Td>
                <Td>
                  <Button variant="ghost" className="!px-2 !py-1 text-xs" onClick={() => setOpen(open === r.id ? null : r.id)}>
                    {open === r.id ? "Hide" : "View"}
                  </Button>
                </Td>
              </tr>
            ))}
          </DataTable>
          {open && <Opened key={open} customerId={customerId} rawId={open} onClose={() => setOpen(null)} />}
        </>
      )}
    </Section>
  );
}
