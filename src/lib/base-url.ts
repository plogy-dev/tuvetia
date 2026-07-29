/**
 * URL base absoluta de la app, para construir links en emails/WhatsApp.
 * Configura NEXT_PUBLIC_APP_URL en .env.local (dev: http://localhost:3002);
 * en Vercel cae a la URL del deployment.
 */
export function getAppBaseUrl(): string {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '');
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return 'http://localhost:3000';
}
