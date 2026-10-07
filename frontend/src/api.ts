const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8080';

export async function checkApiHealth(): Promise<void> {
  const response = await fetch(`${API_URL}/healthz`);
  if (!response.ok) {
    throw new Error(`API health check failed: ${response.status}`);
  }

  const body: unknown = await response.json();
  if (typeof body !== 'object' || body === null || !('status' in body) || body.status !== 'ok') {
    throw new Error('Unexpected API health response');
  }
}
