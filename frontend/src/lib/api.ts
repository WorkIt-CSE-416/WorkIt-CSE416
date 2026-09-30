// Server-only API helpers for non-auth requests (e.g. file uploads)
import "server-only";

const API_URL = process.env.API_URL ?? "http://localhost:8000";

// For upload formData (ex: resume)
export function apiUpload(path: string, body: FormData, accessToken?: string): Promise<Response> {
  return fetch(`${API_URL}${path}`, {
    method: "POST",
    body,
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {}
  });
}


export function apiGet(path: string, accessToken?: string): Promise<Response> {
  return fetch(`${API_URL}${path}`, {
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
  })
}

export function apiDelete(path: string, accessToken?: string): Promise<Response> {
  return fetch(`${API_URL}${path}`, {
    method: "DELETE",
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
  });
}
