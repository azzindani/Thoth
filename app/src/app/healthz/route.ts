// Container/LB probe for the app itself: exempt from the access gate (see
// proxy.ts) and independent of the backend, so a backend outage does not
// get the frontend container restarted.
export const dynamic = "force-dynamic";

export function GET() {
	return Response.json({ ok: true });
}
