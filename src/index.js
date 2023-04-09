import { Router } from 'itty-router';
import { missing, text } from 'itty-router-extras';
import { JsonKit } from '@kit-p/json-kit';

import { command_handler } from './handler/command';
import { event_handler } from './handler/event';
import { interaction_handler } from './handler/interaction';

/* Itty Router Configurations */
const router = Router();

/* Middleware */
const withData = async (req) => {
  const contentType = req.headers.get('content-type');
  req.data = undefined;

  try {
    if (contentType != null) {
      if (contentType.includes('application/json')) {
        req.data = await req.json();
      } else if (contentType.includes('application/x-www-form-urlencoded')) {
        req.data = Object.fromEntries((await req.formData()).entries());
      } else if (contentType.includes('text/')) {
        req.data = await req.text();
      }
    }
  } catch (err) {} // silently fail on error
};

/* API Endpoint Functions */
router.post('/api/command', withData, async (req) => {
  return await command_handler(req.data);
});

router.post('/api/event', withData, async (req, event) => {
  if (req.data.challenge) {
    return text(req.data.challenge, { status: 200 });
  }
  return await event_handler(req.data.event, event);
});

router.post('/api/interact', withData, async (req) => {
  if (typeof req.data.payload !== 'string') {
    return text('payload must be a string', { status: 400 });
  }
  return await interaction_handler(JsonKit.parse(req.data.payload));
});

/* Web Page Functions */
router.get('/', async (req) => {
  const url = new URL(req.url);
  const conversation = url.searchParams.get('conversation');
  const data = JsonKit.parse(url.searchParams.get('data'));

  if (data.conversation_id !== conversation) {
    return text('Unauthorized', { status: 401 });
  }

  return text(
    `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="ie=edge" />
  <title>Restaurant Picker</title>
  <style>
    table {
      border-collapse: collapse;
      width: 100%;
    }
    th, td {
      text-align: center;
      padding: 8px 32px;
    }
    th:first-child, td:first-child {
      text-align: left;
      width: 40%;
    }
    th, tr:nth-child(even) {
      background-color: #f2f2f2;
    }
  </style>
</head>
<body>
  <h1>Restaurant List</h1>
  <table>
    <thead>
      <tr>
        <th>Name</th>
        <th>Weight</th>
        <th>Shown Count</th>
        <th>Win Rate</th>
      </tr>
    </thead>
    <tbody>
      ${data.list
        .sort((a, b) => {
          if (a.win_count !== b.win_count) {
            return b.win_count - a.win_count;
          }
          if (a.shown_count !== b.shown_count) {
            return a.shown_count - b.shown_count;
          }
          return b.weight - a.weight;
        })
        .map(
          (restaurant) => `
          <tr>
            <td>${restaurant.name}</td>
            <td>${restaurant.weight}</td>
            <td>${restaurant.shown_count}</td>
            <td>${
              restaurant.shown_count > 0
                ? (
                    (restaurant.win_count / restaurant.shown_count) *
                    100
                  ).toFixed(0)
                : 0
            }%</td>
          </tr>
      `
        )
        .join('')}
    </tbody>
  </table>
</body>
</html>
  `,
    { status: 200, headers: { 'Content-Type': 'text/html' } }
  );
});

router.all('*', () => missing('Not Found'));

addEventListener('fetch', (e) => {
  e.respondWith(router.handle(e.request, e));
});
