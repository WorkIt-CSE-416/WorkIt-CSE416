'Handles all API related requests from frontend to backend'

const API_URL = process.env.API_URL ?? "http://localhost:8000";

// For upload formData (ex: resume)
export function apiUpload(path: string, body: FormData): Promise<Response> {
    return fetch(`${API_URL}${path}`, {method: "POST", body});
}

// For normal fetch
export function apiFetch(path: string, init: RequestInit): Promise<Response> {
  return fetch(`${API_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
}