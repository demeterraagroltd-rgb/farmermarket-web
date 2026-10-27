// Plain-language labels for recova_consents.status, shared by staff screens.
export const RECOVA_STATUS_LABEL: Record<string, string> = {
  draft: "Bank details entered, not yet submitted",
  submitting: "Sending to Recova",
  awaiting_consent: "Waiting for customer to approve on Recova",
  processing: "Recova is processing",
  active: "Mandate active",
  failed: "Failed",
  needs_review: "Needs staff review (Recova's response was unclear)",
  cancelled: "Cancelled",
  expired: "Expired",
};
