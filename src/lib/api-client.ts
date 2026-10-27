let pending: Promise<void> | undefined;
export function establishSession() {
  return pending ??= fetch("/api/session", { method: "POST", headers: { "x-ai-editor": "1" } })
    .then(async response => { if (!response.ok) throw new Error((await response.json()).error || "Could not start local session."); })
    .catch(error => { pending = undefined; throw error; });
}
export async function apiFetch(url: string, init?: RequestInit) {
  await establishSession();
  const headers = new Headers(init?.headers); headers.set("x-ai-editor", "1");
  return fetch(url, { ...init, headers });
}
