import type { Metadata } from "next";
import Link from "next/link";
import { requireUserId } from "@/lib/auth";
import { UploadForm } from "../../upload-form";

export const metadata: Metadata = { title: "New recording" };
export default async function NewMeetingPage() {
  await requireUserId();
  return <main className="page-shell narrow-page"><Link className="back-link" href="/">← Meetings</Link><header className="page-intro"><div><p className="eyebrow">New meeting</p><h1>Record or upload</h1><p>Add long-form audio or video for local transcription, speaker detection, and meeting insights.</p></div></header><UploadForm /></main>;
}
