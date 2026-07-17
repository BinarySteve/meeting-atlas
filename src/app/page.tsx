import { MeetingLibrary } from "./meeting-library";

export const dynamic = "force-dynamic";

export default function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <MeetingLibrary searchParams={searchParams} />;
}
