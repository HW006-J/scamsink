import { NextResponse } from "next/server";
import { getCallById } from "@/lib/calls";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    const detail = await getCallById(id);
    if (!detail) {
      return NextResponse.json({ error: "NOT_FOUND", message: "Call not found." }, { status: 404 });
    }
    return NextResponse.json(detail);
  } catch (error) {
    console.error("calls/[id]: database error", error);
    return NextResponse.json(
      { error: "DATABASE_UNAVAILABLE", message: "Could not reach the database." },
      { status: 503 },
    );
  }
}
