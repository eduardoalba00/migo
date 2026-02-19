export class ApiClient {
  private accessToken: string | null = null;
  private baseUrl: string = "http://localhost:3000";
  private refreshHandler: (() => Promise<boolean>) | null = null;
  private refreshPromise: Promise<boolean> | null = null;

  setBaseUrl(url: string) {
    this.baseUrl = url.replace(/\/+$/, "");
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  setAccessToken(token: string | null) {
    this.accessToken = token;
  }

  /** Register a callback that refreshes tokens and returns true on success */
  setRefreshHandler(handler: (() => Promise<boolean>) | null) {
    this.refreshHandler = handler;
  }

  private async tryRefresh(): Promise<boolean> {
    if (!this.refreshHandler) return false;
    // Deduplicate concurrent refresh attempts
    if (!this.refreshPromise) {
      this.refreshPromise = this.refreshHandler().finally(() => {
        this.refreshPromise = null;
      });
    }
    return this.refreshPromise;
  }

  async fetch<T>(path: string, options: RequestInit = {}, _isRetry = false): Promise<T> {
    const headers: Record<string, string> = {
      ...((options.headers as Record<string, string>) || {}),
    };

    // Only set Content-Type when there's a body
    if (options.body) {
      headers["Content-Type"] = "application/json";
    }

    if (this.accessToken) {
      headers["Authorization"] = `Bearer ${this.accessToken}`;
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers,
    });

    if (!response.ok) {
      // On 401, try refreshing the token and retry once
      if (response.status === 401 && !_isRetry) {
        const refreshed = await this.tryRefresh();
        if (refreshed) {
          return this.fetch<T>(path, options, true);
        }
      }
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

  async upload<T>(path: string, formData: FormData, _isRetry = false): Promise<T> {
    const headers: Record<string, string> = {};

    if (this.accessToken) {
      headers["Authorization"] = `Bearer ${this.accessToken}`;
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers,
      body: formData,
    });

    if (!response.ok) {
      if (response.status === 401 && !_isRetry) {
        const refreshed = await this.tryRefresh();
        if (refreshed) {
          return this.upload<T>(path, formData, true);
        }
      }
      const body = await response.json().catch(() => ({}));
      throw new ApiError(response.status, body.error || "Upload failed");
    }

    return response.json();
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

/** Resolve a relative upload path (e.g. /uploads/avatars/x.png) to a full URL */
export function resolveUploadUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (path.startsWith("http")) return path;
  return `${api.getBaseUrl()}${path}`;
}
