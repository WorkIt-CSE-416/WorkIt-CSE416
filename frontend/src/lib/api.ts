// Server-only API helpers for non-auth requests (e.g. file uploads)
import "server-only";

const API_URL = process.env.API_URL ?? "http://localhost:8000";

// For upload formData (ex: resume). PUT for routes that replace a single
// file in place, such as the profile photo.
export function apiUpload(
  path: string,
  body: FormData,
  accessToken?: string,
  method: "POST" | "PUT" = "POST",
): Promise<Response> {
  return fetch(`${API_URL}${path}`, {
    method,
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
