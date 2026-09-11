"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// This used to be the applications queue, reading GET /v1/admin/applications
// — a table nothing has written to since registration moved onto
// applicant_profiles / the KYC flow (see /dashboard/kyc). Rather than leave
// a route that always renders empty, /dashboard now lands on Overview,
// which is live.
export default function DashboardRoot() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/dashboard/overview");
  }, [router]);
  return null;
}
