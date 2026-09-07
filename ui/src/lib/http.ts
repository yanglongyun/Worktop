export const request = async <T>(path: string, opts: RequestInit = {}) => {
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any).error || `${res.status}`);
  return data as T;
};

export const jsonBody = (body: any): RequestInit => ({
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
