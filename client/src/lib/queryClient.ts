import { QueryClient, QueryFunction } from "@tanstack/react-query";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(method: string, url: string, data?: unknown): Promise<Response> {
  try {
    const baseUrl = import.meta.env.VITE_API_URL || "";
    const fullUrl = `${baseUrl}${url}`;

    console.log("🔎 apiRequest received URL:", url);
    if (url === "/login") {
      console.warn("❌ BAD PATH: /login detected. Should be /api/login!");
    }
    

    console.trace(`🔥 Attempting fetch to: ${fullUrl}`);


    const res = await fetch(fullUrl, {
      method,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: data ? JSON.stringify(data) : undefined,
      credentials: "include",
      mode: "cors",
    });

    console.log(`Response status: ${res.status}, ${res.statusText}`);
    await throwIfResNotOk(res);
    return res;
  } catch (error) {
    console.error("API request failed:", error);
    throw error;
  }
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    try {
      console.log(`Query fetching: ${queryKey[0]}`);
      const baseUrl = import.meta.env.VITE_API_URL || "";
const fullUrl = `${baseUrl}${queryKey[0] as string}`;
const res = await fetch(fullUrl, {

        method: 'GET',
        headers: {
          "Accept": "application/json",
        },
        credentials: "include",
        mode: "cors"
      });

      if (unauthorizedBehavior === "returnNull" && res.status === 401) {
        return null;
      }

      await throwIfResNotOk(res);
      return await res.json();
    } catch (error) {
      console.error("Query request failed:", error);
      throw error;
    }
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
