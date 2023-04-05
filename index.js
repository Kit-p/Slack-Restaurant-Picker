import { Router } from 'itty-router';
import { missing, status, text } from 'itty-router-extras';
import { JsonKit } from '@kit-p/json-kit';

/* Global Variables */
const APP_NAME = 'Restaurant Picker';
const APP_ENDPOINT = 'https://slack-restaurant-picker.jacky-flow.workers.dev';
const SLACK_API_ROOT = 'https://slack.com/api';

/* Utility Functions */
function encode_base64_for_url(base64_str) {
  return base64_str
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/[=\s]/g, '');
}

function binary_search(arr, item, low, high) {
  if (low == null) {
    low = 0;
  }
  if (high == null) {
    high = arr.length - 1;
  }
  if (low >= high) {
    return item >= arr[low] ? low : high;
  }
  const mid = Math.floor((low + high) / 2);
  if (item === arr[mid]) {
    return mid;
  }
  if (item > arr[mid]) {
    return binary_search(arr, item, mid + 1, high);
  }
  return binary_search(arr, item, low, mid - 1);
}

async function send_slack_request(method, path, data) {
  const url = `${SLACK_API_ROOT}${path}`;
  console.log(`[${method}]: ${url}`);

  const response = await fetch(url, {
    method: method,
    body: JsonKit.stringify(data),
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

/* Core Logic Functions */
function pick_restaurant_initialize_data(conversation) {
  return {
    conversation_id: conversation,
    ts: Date.now(),
    list: [],
  };
}

function pick_restaurant_validate_data(conversation, data) {
  if (data.conversation_id !== conversation) {
    return false;
  }
  if (
    typeof data.ts !== 'number' ||
    data.ts > Date.now() ||
    data.ts <= 0 ||
    !Number.isSafeInteger(data.ts)
  ) {
    return false;
  }
  if (
    !Array.isArray(data.list) &&
    data.list.every(i => typeof i.id === 'string' && typeof i.name === 'string')
  ) {
    return false;
  }
  return true;
}

function pick_restaurant_get_help_text() {
  return 'Available _*Slash Commands*_:\n*`/restaurant_picker list`*: :ledger: Lists all the added restaurants in a modal\n*`/restaurant_picker new`*: :memo: Opens a modal for adding new restaurants\n*`/restaurant_picker pick <N>`*: :game_die: Picks *N* items _(if exists)_ and let everyone vote _(anonymously)_\n*`/restaurant_picker help`*: :information_source: Shows this message _(just for you :smirk:)_';
}

function pick_restaurant_get_help_block() {
  return {
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: pick_restaurant_get_help_text(),
    },
  };
}

async function pick_restaurant_setup(conversation) {
  const initial_data = pick_restaurant_initialize_data(conversation);
  const data_str = encode_base64_for_url(
    JsonKit.stringify(initial_data, {
      extended: false,
      minify: false,
      compress: true,
    })
  );
  let response = await send_slack_request('POST', '/bookmarks.add', {
    channel_id: conversation,
    type: 'link',
    title: APP_NAME,
    link: `${APP_ENDPOINT}/?conversation=${conversation}&data=${data_str}`,
  });
  if (response.ok !== true || response.data.ok !== true) {
    console.error('Failed adding bookmark to conversation');
    console.log(JsonKit.stringify(response.data));
    return;
  }

  const welcome_text =
    "Welcome to the *Restaurant Picker*!\n\nLooks like you haven't added any restaurant, maybe let's do that first? :wink:\n\nYou can then manually initiate the pick or configure a scheduled workflow to automatically run the pick.";
  const fallback_text = `${welcome_text}\n\n${pick_restaurant_get_help_text()}`;
  response = await send_slack_request('POST', '/chat.postMessage', {
    channel: conversation,
    text: fallback_text,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: welcome_text,
        },
      },
      pick_restaurant_get_help_block(),
    ],
  });
  if (response.ok !== true || response.data.ok !== true) {
    console.error('Failed sending setup message to conversation');
    console.log(JsonKit.stringify(response.data));
  }
}

async function pick_restaurant_help(conversation, user_id) {
  const welcome_text = 'Thanks for using the *Restaurant Picker*!.';
  const fallback_text = `${welcome_text}\n\n${pick_restaurant_get_help_text()}`;
  const response = await send_slack_request(
    'POST',
    user_id != null ? '/chat.postEphemeral' : '/chat.postMessage',
    {
      channel: conversation,
      text: fallback_text,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: welcome_text,
          },
        },
        pick_restaurant_get_help_block(),
      ],
      ...(user_id != null && { user: user_id }),
    }
  );
  if (response.ok !== true || response.data.ok !== true) {
    console.error(
      `Failed sending help${
        user_id != null ? ` empheral (user: ${user_id})` : ''
      } message to conversation`
    );
    console.log(JsonKit.stringify(response.data));
  }
}

async function pick_restaurant_get_url(conversation) {
  const response = await send_slack_request('POST', '/bookmarks.list', {
    channel_id: conversation,
  });
  if (response.ok !== true || response.data.ok !== true) {
    console.error('Failed retrieving conversation bookmarks');
    console.log(JsonKit.stringify(response.data));
    return null;
  }

  const bookmarks = response.data.bookmarks;
  if (!Array.isArray(bookmarks)) {
    console.error('Failed parsing conversation bookmarks');
    console.log(JsonKit.stringify(response.data));
    return null;
  }

  const bookmark = bookmarks.find(
    b =>
      b.title === APP_NAME &&
      b.type === 'link' &&
      b.link != null &&
      b.link.startsWith(`${APP_ENDPOINT}/?conversation=${conversation}&data=`)
  );
  if (bookmark == null) {
    return null;
  }

  return new URL(bookmark.link);
}

async function pick_restaurant_new(conversation, new_items) {
  // TODO: get existing list, append new one
}

async function pick_restaurant_pick(conversation, number_of_choices) {
  const link = await pick_restaurant_get_url(conversation);
  if (link == null) {
    await pick_restaurant_setup(conversation);
    return;
  }

  const data = JsonKit.parse(link.searchParams.get('data'));
  if (!pick_restaurant_validate_data(conversation, data)) {
    // TODO: call pick_restaurant_repair
    return;
  }

  const cumulative_weights = [];
  for (const item of data.list) {
    const cumulative_weight = cumulative_weights.at(-1);
    const weight =
      typeof item.weight === 'number' && item.weight >= 0
        ? Math.floor(item.weight)
        : 1;
    cumulative_weights.push(cumulative_weight + weight);
  }

  const choices = [];
  while (choices.length < number_of_choices) {
    const pointer = Math.random() * cumulative_weights.at(-1);
    const idx = binary_search(cumulative_weights, pointer);
    const weight = cumulative_weights[idx];
    for (let i = idx; i < cumulative_weights.length; i++) {
      cumulative_weights[i] -= weight;
    }
    choices.push(data.list[idx]);
  }

  const fallback_text = `Pick a restaurant from one of [${choices
    .map(c => `"${c.name}"`)
    .join(', ')}]`;

  const response = await send_slack_request('POST', '/chat.postMessage', {
    channel: conversation,
    text: fallback_text,
    blocks: [
      // TODO
    ],
  });
  if (response.ok !== true || response.data.ok !== true) {
    console.error('Failed sending pick message to conversation');
    console.log(JsonKit.stringify(response.data));
    return;
  }
}

/* API Handler Functions */
async function handle_command(command) {
  // TODO: handle command
  console.log(JsonKit.stringify(command));
  return status(400);
}

async function handle_event(event) {
  console.log(JsonKit.stringify(event));
  const callback_id = event.callback_id;
  if (typeof callback_id !== 'string') {
    console.error('Received unknown event');
    console.log(JsonKit.stringify(event));
    return status(400);
  }

  switch (callback_id) {
    case 'pick_restaurant': {
      switch (event.type) {
        case 'workflow_step_execute': {
          try {
            const selected_conversation =
              event.workflow_step.inputs.selected_conversation.value;
            if (typeof selected_conversation !== 'string') {
              throw new Error(
                'No conversation is selected, please reconfigure the workflow step.'
              );
            }

            const number_of_choices =
              event.workflow_step.inputs.number_of_choices.value;
            if (
              typeof number_of_choices !== 'number' ||
              number_of_choices <= 0
            ) {
              throw new Error(
                'Missing number of choices, please reconfigure the workflow step.'
              );
            }

            await pick_restaurant_pick(
              selected_conversation,
              number_of_choices
            );

            await selected_conversation('POST', '/workflows.stepCompleted', {
              workflow_step_execute_id:
                event.workflow_step.workflow_step_execute_id,
            });
          } catch (err) {
            console.error(err);
            await send_slack_request('POST', '/workflows.stepFailed', {
              workflow_step_execute_id:
                event.workflow_step.workflow_step_execute_id,
              error: {
                message: err.message.toString(),
              },
            });
          }
          return status(200);
        }
        default: {
          console.error('Received unknown event type');
          console.log(JsonKit.stringify(event));
          break;
        }
      }
      break;
    }
    default: {
      console.error('Received unknown event callback_id');
      console.log(JsonKit.stringify(event));
      break;
    }
  }

  return status(400);
}

async function handle_interaction(payload) {
  console.log(JsonKit.stringify(payload));
  const callback_id = payload.callback_id || payload.view.callback_id;
  if (typeof callback_id !== 'string') {
    console.error('Received unknown interaction payload');
    console.log(JsonKit.stringify(payload));
    return status(400);
  }

  switch (callback_id) {
    case 'pick_restaurant': {
      const conversations_select_block_id = 'conversations_select-block';
      const conversations_select_action_id = 'conversations_select-action';
      const number_input_block_id = 'number_input-block';
      const number_input_action_id = 'number_input-action';
      switch (payload.type) {
        case 'workflow_step_edit': {
          const has_selected_conversation =
            payload.workflow_step &&
            payload.workflow_step.inputs.selected_conversation;
          const has_number_of_choices =
            payload.workflow_step &&
            payload.workflow_step.inputs.number_of_choices;
          // open config modal
          const response = await send_slack_request('POST', '/views.open', {
            trigger_id: payload.trigger_id,
            view: {
              type: 'workflow_step',
              callback_id: payload.callback_id,
              submit_disabled: false,
              blocks: [
                {
                  block_id: conversations_select_block_id,
                  type: 'input',
                  element: {
                    type: 'conversations_select',
                    filter: {
                      include: ['public', 'private'],
                      exclude_external_shared_channels: true,
                      exclude_bot_users: true,
                    },
                    placeholder: {
                      type: 'plain_text',
                      text: 'Select a channel',
                      emoji: true,
                    },
                    action_id: conversations_select_action_id,
                    focus_on_load: true,
                    ...(has_selected_conversation && {
                      initial_conversation:
                        payload.workflow_step.inputs.selected_conversation
                          .value,
                    }),
                  },
                  label: {
                    type: 'plain_text',
                    text: 'Message Destination',
                    emoji: true,
                  },
                },
                {
                  type: 'section',
                  text: {
                    type: 'mrkdwn',
                    text:
                      '> :exclamation: For *private* channels, please first integrate this app.',
                  },
                },
                {
                  block_id: number_input_block_id,
                  type: 'input',
                  element: {
                    type: 'number_input',
                    is_decimal_allowed: false,
                    placeholder: {
                      type: 'plain_text',
                      text: 'Enter a number between 1-9',
                      emoji: true,
                    },
                    action_id: number_input_action_id,
                    min_value: '1',
                    max_value: '9',
                    focus_on_load: false,
                    initial_value: has_number_of_choices
                      ? payload.workflow_step.inputs.number_of_choices.value.toString()
                      : '1',
                  },
                  label: {
                    type: 'plain_text',
                    text: 'Number of Choices To Pick',
                    emoji: true,
                  },
                },
              ],
            },
          });
          if (response.ok !== true || response.data.ok !== true) {
            console.error('Failed opening config modal');
            console.log(JsonKit.stringify(response.data));
            return status(400);
          }
          return status(200);
        }
        case 'view_submission': {
          const selected_conversation =
            payload.view.state.values[conversations_select_block_id][
              conversations_select_action_id
            ].selected_conversation;
          if (typeof selected_conversation !== 'string') {
            console.error('Submitted invalid conversation ID');
            console.log(JsonKit.stringify(payload));
            return status(400);
          }
          const number_of_choices = Number.parseInt(
            payload.view.state.values[number_input_block_id][
              number_input_action_id
            ].value
          );
          if (typeof number_of_choices !== 'number' || number_of_choices <= 0) {
            console.error('Submitted invalid number of choices to pick');
            console.log(JsonKit.stringify(payload));
            return status(400);
          }

          // update payload
          const response = await send_slack_request(
            'POST',
            '/workflows.updateStep',
            {
              workflow_step_edit_id:
                payload.workflow_step.workflow_step_edit_id,
              inputs: {
                selected_conversation: {
                  type: 'plain_text',
                  value: selected_conversation,
                },
                number_of_choices: {
                  type: 'number',
                  value: number_of_choices,
                },
              },
            }
          );
          if (response.ok !== true || response.data.ok !== true) {
            console.error('Failed updating workflow step');
            console.log(JsonKit.stringify(response.data));
            return status(500);
          }
          return status(200);
        }
        default: {
          console.error('Received unknown interaction type');
          console.log(JsonKit.stringify(payload));
          break;
        }
      }
      break;
    }
    default: {
      console.error('Received unknown interaction callback_id');
      console.log(JsonKit.stringify(payload));
      break;
    }
  }
  return status(400);
}

/* Express Server Configurations */
const router = Router();

/* Middleware */
const withData = async req => {
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
router.post('/api/command', withData, async req => {
  await handle_command(req.data);
});

router.post('/api/event', withData, async req => {
  if (req.data.challenge) {
    return text(req.data.challenge, { status: 200 });
  }
  return await handle_event(req.data.event);
});

router.post('/api/interact', withData, async req => {
  if (typeof req.data.payload !== 'string') {
    return text('payload must be a string', { status: 400 });
  }
  return await handle_interaction(JsonKit.parse(req.data.payload));
});

/* Web Page Functions */
router.get('/', async req => {
  const conversation = req.params.conversation;
  const data = JsonKit.parse(req.params.data);

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
      ${data.list.map(
        restaurant => `
          <tr>
            <td>${restaurant.name}</td>
            <td>${restaurant.weight}</td>
            <td>${restaurant.shown_count}</td>
            <td>${(restaurant.win_rate * 100).toFixed(0)}%</td>
          </tr>
      `
      )}
    </tbody>
  </table>
</body>
</html>
  `,
    { status: 200, headers: { 'Content-Type': 'text/html' } }
  );
});

router.all('*', () => missing('Not Found'));

addEventListener('fetch', e => {
  e.respondWith(router.handle(e.request));
});
