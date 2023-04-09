import { JsonKit } from '@kit-p/json-kit';

export const SLACK_API_ROOT = 'https://slack.com/api';

export async function send_slack_request(method, path, data) {
  let url = `${SLACK_API_ROOT}${path}`;
  if (data.params != null) {
    url +=
      '?' +
      Object.entries(data.params)
        .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
        .join('&');
  }
  console.log(`[${method}]: ${url}`);

  const response = await fetch(url, {
    method: method,
    body:
      method !== 'GET' && method !== 'HEAD' && data.params === undefined
        ? JsonKit.stringify(data)
        : undefined,
    headers: {
      Authorization: `Bearer ${BOT_ACCESS_TOKEN}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
  });

  return {
    url: response.url,
    type: response.type,
    status: response.status,
    statusText: response.statusText,
    ok: response.ok,
    redirected: response.redirected,
    headers: response.headers,
    data: await response.json(),
  };
}
