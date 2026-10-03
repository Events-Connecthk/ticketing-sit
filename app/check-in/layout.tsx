import type { ReactNode } from "react";

/** Always dynamic so check-in server actions stay in sync after deploys. */
export const dynamic = "force-dynamic";

export default function CheckInLayout({ children }: { children: ReactNode }) {
  return children;
}
