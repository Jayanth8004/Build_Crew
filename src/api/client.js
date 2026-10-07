// Determine API base URL dynamically:
// 1. VITE_API_URL or VITE_API_BASE_URL from environment (e.g. deployed backend URL or custom API endpoint)
// 2. In local development (vite dev), default to 'http://localhost:5000/api'
// 3. In production, default to relative '/api' (for single-domain Vercel deployment with serverless rewrites)
const getApiBaseUrl = () => {
  const envUrl = import.meta.env.VITE_API_URL || import.meta.env.VITE_API_BASE_URL;
  if (envUrl) {
    return envUrl.endsWith('/api') ? envUrl : `${envUrl.replace(/\/+$/, '')}/api`;
  }
  return import.meta.env.DEV ? 'http://localhost:5000/api' : '/api';
};

export const API_BASE_URL = getApiBaseUrl();

export const getToken = () => {
  try {
    return localStorage.getItem('buildcrew_token');
  } catch {
    return null;
  }
};

export const setToken = (token) => {
  try {
    if (token) {
      localStorage.setItem('buildcrew_token', token);
    } else {
      localStorage.removeItem('buildcrew_token');
    }
  } catch (err) {
    console.warn('Failed to store auth token in localStorage', err);
  }
};

export const clearAuthSession = () => {
  try {
    localStorage.removeItem('buildcrew_token');
    localStorage.removeItem('buildcrew_user');
  } catch (err) {
    console.warn('Failed to clear auth session', err);
  }
};

export async function apiClient(endpoint, options = {}) {
  const url = `${API_BASE_URL}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
  const token = getToken();

  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const config = {
    ...options,
    headers,
    signal: options.signal || AbortSignal.timeout(15000),
  };

  if (options.body && typeof options.body === 'object' && !(options.body instanceof FormData)) {
    config.body = JSON.stringify(options.body);
  }

  try {
    const res = await fetch(url, config);
    const contentType = res.headers.get('content-type') || '';
    const isJson = contentType.includes('application/json');
    const data = isJson ? await res.json() : await res.text();

    if (!res.ok) {
      const errorMsg = (data && data.error) || (data && data.message) || `HTTP error ${res.status}`;
      const error = new Error(errorMsg);
      error.status = res.status;
      error.data = data;
      throw error;
    }

    return data;
  } catch (err) {
    // If unauthorized, clear cached token if 401
    if (err.status === 401 && endpoint !== '/auth/login' && endpoint !== '/auth/register') {
      clearAuthSession();
    }
    throw err;
  }
}
