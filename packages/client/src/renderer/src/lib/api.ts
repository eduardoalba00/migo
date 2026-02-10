export class ApiClient {
  private accessToken: string | null = null;
  private baseUrl: string = "http://localhost:8080";

  setBaseUrl(url: string) {
    this.baseUrl = url.replace(/\/+$/, "");
  }

  setAccessToken(token: string | null) {
    this.accessToken = token;
  }

  async fetch<T>(path: string, options: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...((options.headers as Record<string, string>) || {}),
    };

    if (this.accessToken) {
      headers["Authorization"] = `Bearer ${this.accessToken}`;
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new ApiError(response.status, body.error || "Request failed");
    }

    if (response.status === 204) return undefined as T;

    return response.json();
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    return this.fetch<T>(path, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  async get<T>(path: string): Promise<T> {
    return this.fetch<T>(path);
  }

  async patch<T>(path: string, body: unknown): Promise<T> {
    return this.fetch<T>(path, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  }

  async put<T>(path: string, body: unknown): Promise<T> {
    return this.fetch<T>(path, {
      method: "PUT",
      body: JSON.stringify(body),
    });
  }

  async delete<T = void>(path: string): Promise<T> {
    return this.fetch<T>(path, { method: "DELETE" });
  }
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const api = new ApiClient();
