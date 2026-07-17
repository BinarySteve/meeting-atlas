import type { Metadata } from "next";
import { MeetingLibrary } from "../meeting-library";

export const metadata: Metadata = { title: "Search meetings" };
export const dynamic = "force-dynamic";

export default function SearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <MeetingLibrary searchParams={searchParams} searchMode />;
}
