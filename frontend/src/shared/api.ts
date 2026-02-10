const API = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

export async function getActiveSurvey(locationId: number) {
  const res = await fetch(`${API}/api/public/locations/${locationId}/active-survey`);
  if (!res.ok) throw new Error(`Failed to load survey: ${res.status}`);
  return res.json();
}
