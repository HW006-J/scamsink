import { NextResponse } from "next/server";
import { getDashboardState } from "@/lib/calls";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const state = await getDashboardState();
    return NextResponse.json(state);
  } catch (error) {
    console.error("dashboard-state: database error", error);
    return NextResponse.json(
      { error: "DATABASE_UNAVAILABLE", message: "Could not reach the database." },
      { status: 503 },
    );
  }
}
