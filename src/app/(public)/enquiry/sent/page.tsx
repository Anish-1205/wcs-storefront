import type { Metadata } from "next";
import { EnquirySent } from "@/components/enquiry/EnquirySent";

export const metadata: Metadata = {
  title: "Enquiry Sent",
  robots: { index: false, follow: false },
};

export default function EnquirySentPage() {
  return <EnquirySent />;
}
