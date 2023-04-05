import { Router } from 'itty-router';
import { json, missing, status, text } from 'itty-router-extras';
import { v4 as uuid } from 'uuid';
import { JsonKit } from '@kit-p/json-kit';

/* Global Variables */
const APP_NAME = 'Restaurant Picker';
const APP_ENDPOINT = 'https://slack-restaurant-picker.jacky-flow.workers.dev';
const SLACK_API_ROOT = 'https://slack.com/api';

/* Utility Functions */
async function send_slack_request(method, path, data) {
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

function pick_restaurant_get_pick_message_payload(
  conversation,
  choices,
  number_of_choices,
  is_ended = false,
  ended_by = null
) {
  const choices_to_show = choices.slice(0, number_of_choices);
  const fallback_text = `Pick a restaurant from one of [${choices_to_show
    .map(c => `"${c.name}"`)
    .join(', ')}]`;

  let total_votes = 0;
  let max_vote = 0;
  for (const choice of choices_to_show) {
    total_votes += choice.votes.length;
    max_vote = Math.max(max_vote, choice.votes.length);
  }
  let winners = choices_to_show.filter(
    choice => choice.votes.length === max_vote
  );
  winners = winners.map(winner => winner.id);

  const payload = {
    channel: conversation,
    metadata: {
      event_type: 'restaurant_picker-pick',
      event_payload: {
        conversation,
        choices,
        number_of_choices,
        winners,
        is_ended,
        ended_by,
        ts: Date.now(),
      },
    },
    text: fallback_text,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: 'Hey, I have picked these restaurants for you!',
        },
      },
      is_ended === true
        ? {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `Vote ended by ${
                ended_by != null ? `<@${ended_by}>` : 'an unknown user'
              }! There are *${total_votes}* votes in total. Check the results below.`,
            },
          }
        : {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `Vote for your restaurant! *Current Votes: ${total_votes}*\n_Note: Result breakdown will be shown after ending the vote._`,
            },
            accessory: {
              type: 'button',
              style: 'danger',
              text: {
                type: 'plain_text',
                text: 'End Vote',
                emoji: true,
              },
              action_id: 'pick_restaurant_pick_end-action',
              value: 'end_vote',
            },
          },
      {
        type: 'divider',
      },
      ...choices_to_show.flatMap(choice => {
        const blocks = [
          {
            block_id: `restaurant_${choice.id}-block`,
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `${
                is_ended === true && winners.includes(choice.id)
                  ? ':white_check_mark: '
                  : ''
              }:knife_fork_plate: *${choice.name}*`,
            },
            ...(is_ended === false && {
              accessory: {
                type: 'button',
                style: 'primary',
                text: {
                  type: 'plain_text',
                  text: 'Vote',
                  emoji: true,
                },
                action_id: 'pick_restaurant_pick_vote-action',
                value: choice.id,
              },
            }),
          },
        ];
        if (is_ended === true) {
          blocks.push({
            block_id: `votes_${choice.id}-block`,
            type: 'context',
            elements: [
              {
                type: 'plain_text',
                text: `Vote: ${choice.votes.length}`,
                emoji: true,
              },
            ],
          });
        }
        return blocks;
      }),
      {
        type: 'divider',
      },
    ],
  };

  if (is_ended === false) {
    payload.blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: 'Add 1 more choice :see_no_evil:',
            emoji: true,
          },
          action_id: 'pick_restaurant_pick_add_choice-action',
          value: `add_choice`,
        },
      ],
    });
  }

  return payload;
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

  bookmark.link = new URL(bookmark.link);
  return bookmark;
}

async function pick_restaurant_get_pick_message(conversation, message_ts) {
  const response = await send_slack_request('GET', '/conversations.history', {
    params: {
      channel: conversation,
      oldest: message_ts,
      inclusive: true,
      limit: 1,
      include_all_metadata: true,
    },
  });
  if (response.ok !== true || response.data.ok !== true) {
    console.error('Failed retrieving conversation pick message');
    console.log(JsonKit.stringify(response.data));
    return null;
  }

  if (response.data.messages == null || response.data.messages.length !== 1) {
    return null;
  }
  return response.data.messages[0];
}

async function pick_restaurant_setup(conversation, slient) {
  const initial_data = pick_restaurant_initialize_data(conversation);
  const data_str = JsonKit.stringify(initial_data, {
    extended: false,
    minify: false,
    compress: true,
  });
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

  if (slient === true) {
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
    return status(500);
  }
  return status(200);
}

async function pick_restaurant_list(conversation, trigger_id) {
  // TODO: render list and allow edit / remove
}

async function pick_restaurant_new(conversation, trigger_id) {
  const response = await send_slack_request('POST', '/views.open', {
    trigger_id,
    view: {
      type: 'modal',
      title: {
        type: 'plain_text',
        text: 'Add New Restarurant',
        emoji: true,
      },
      close: {
        type: 'plain_text',
        text: 'Cancel',
        emoji: true,
      },
      submit: {
        type: 'plain_text',
        text: 'Save',
        emoji: true,
      },
      private_metadata: JsonKit.stringify({
        conversation,
      }),
      callback_id: 'pick_restaurant-new',
      blocks: [
        {
          block_id: 'restaurant_name-block',
          type: 'input',
          element: {
            type: 'plain_text_input',
            action_id: 'restaurant_name-action',
            placeholder: {
              type: 'plain_text',
              text: 'Name of Restaurant',
            },
            min_length: 2,
            max_length: 30,
            focus_on_load: true,
          },
          label: {
            type: 'plain_text',
            text: 'Name',
          },
        },
        {
          block_id: 'restaurant_weight-block',
          type: 'input',
          element: {
            type: 'number_input',
            action_id: 'restaurant_weight-action',
            is_decimal_allowed: false,
            placeholder: {
              type: 'plain_text',
              text: 'Weight (0 [disabled] - 99)',
            },
            initial_value: '50',
            min_value: '0',
            max_value: '99',
          },
          label: {
            type: 'plain_text',
            text: 'Weight',
          },
        },
      ],
    },
  });
  if (response.ok !== true || response.data.ok !== true) {
    console.error('Failed opening new modal');
    console.log(JsonKit.stringify(response.data));
    return status(400);
  }
  return status(200);
}

async function pick_restaurant_pick(conversation, number_of_choices) {
  const bookmark = await pick_restaurant_get_url(conversation);
  if (bookmark == null) {
    await pick_restaurant_setup(conversation);
    return status(200);
  }

  const data = JsonKit.parse(bookmark.link.searchParams.get('data'));
  if (!pick_restaurant_validate_data(conversation, data)) {
    // TODO: call pick_restaurant_repair
    console.error('Invalid bookmark data');
    return status(200);
  }

  if (data.list.length <= 0) {
    await pick_restaurant_setup(conversation);
    return status(200);
  }

  const choices = [...data.list].sort((a, b) => {
    const aWeight =
      typeof a.weight === 'number' && a.weight >= 0 ? Math.floor(a.weight) : 1;
    const bWeight =
      typeof b.weight === 'number' && b.weight >= 0 ? Math.floor(b.weight) : 1;
    const pivot = Math.random() * (aWeight + bWeight);
    return pivot < aWeight ? -1 : 1;
  });

  const choices_to_show = choices.slice(0, number_of_choices);
  for (const choice of choices_to_show) {
    choice.shown_count++;
  }

  const message_payload = pick_restaurant_get_pick_message_payload(
    conversation,
    choices.map(c => ({ ...c, votes: [] })),
    number_of_choices
  );

  let response = await send_slack_request(
    'POST',
    '/chat.postMessage',
    message_payload
  );
  if (response.ok !== true || response.data.ok !== true) {
    console.error('Failed sending pick message to conversation');
    console.log(JsonKit.stringify(response.data));
    return status(500);
  }

  // update bookmark
  data.ts = Date.now();
  const data_str = JsonKit.stringify(data, {
    extended: false,
    minify: false,
    compress: true,
  });
  response = await send_slack_request('POST', '/bookmarks.edit', {
    channel_id: conversation,
    bookmark_id: bookmark.id,
    link: `${APP_ENDPOINT}/?conversation=${conversation}&data=${data_str}`,
  });
  if (response.ok !== true || response.data.ok !== true) {
    console.error('Failed editing bookmark in conversation after pick');
    console.log(JsonKit.stringify(response.data));
    return status(500);
  }
  return status(200);
}

async function pick_restaurant_pick_vote(
  conversation,
  message_ts,
  user_id,
  restaurant_id,
  trigger_id
) {
  const pick_message = await pick_restaurant_get_pick_message(
    conversation,
    message_ts
  );
  if (pick_message == null) {
    console.error('Failed retriving action source pick message');
    return status(500);
  }

  const is_overwrite = trigger_id == null;
  const pick_metadata = pick_message.metadata;
  if (
    !is_overwrite &&
    pick_metadata.event_payload.choices.some(c =>
      c.votes.some(v => v.user_id === user_id)
    )
  ) {
    // user already voted
    const response = await send_slack_request('POST', '/views.open', {
      trigger_id,
      view: {
        type: 'modal',
        title: {
          type: 'plain_text',
          text: 'Duplicated Vote',
          emoji: true,
        },
        close: {
          type: 'plain_text',
          text: 'No',
          emoji: true,
        },
        submit: {
          type: 'plain_text',
          text: 'Yes',
          emoji: true,
        },
        private_metadata: JsonKit.stringify({
          conversation,
          message_ts,
          user_id,
          restaurant_id,
        }),
        callback_id: 'pick_restaurant-pick_overwrite',
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text:
                '*You have already voted!*\n\nDo you want to *overwrite* your previous vote?',
            },
          },
        ],
      },
    });
    if (response.ok !== true || response.data.ok !== true) {
      console.error(
        'Failed opening duplicated vote overwrite confirmation modal'
      );
      console.log(JsonKit.stringify(response.data));
      return status(500);
    }
    return status(200);
  }

  let restaurant_name = null;
  for (const choice of pick_metadata.event_payload.choices) {
    if (is_overwrite) {
      for (let i = 0; i < choice.votes.length; i++) {
        if (choice.votes[i].user_id === user_id) {
          choice.votes.splice(i, 1);
          i--;
        }
      }
    }
    if (choice.id === restaurant_id) {
      restaurant_name = choice.name;
      choice.votes.push({
        user_id: user_id,
        ts: Date.now(),
      });
    }
  }
  pick_metadata.event_payload.ts = Date.now();

  const message_payload = pick_restaurant_get_pick_message_payload(
    conversation,
    pick_metadata.event_payload.choices,
    pick_metadata.event_payload.number_of_choices
  );
  let response = await send_slack_request('POST', '/chat.update', {
    ts: message_ts,
    ...message_payload,
  });
  if (response.ok !== true || response.data.ok !== true) {
    console.error('Failed updating pick message to add vote in conversation');
    console.log(JsonKit.stringify(response.data));
    return status(500);
  }

  response = await send_slack_request('POST', '/chat.postEphemeral', {
    channel: conversation,
    text: `<@${user_id}> You have voted for ${restaurant_name}!`,
    user: user_id,
  });
  if (response.ok !== true || response.data.ok !== true) {
    console.error(
      `Failed sending pick confirm empheral (user: ${user_id}) message to conversation`
    );
    console.log(JsonKit.stringify(response.data));
  }
  return status(200);
}

/* API Handler Functions */
async function handle_command(command) {
  console.log(JsonKit.stringify(command));
  const { trigger_id, channel_id, user_id } = command;
  const [action, args] = command.text.split(' ', 2);

  switch (action) {
    case 'help': {
      return await pick_restaurant_help(channel_id, user_id);
    }
    case 'list': {
      return await pick_restaurant_list(channel_id, trigger_id);
    }
    case 'new': {
      return await pick_restaurant_new(channel_id, trigger_id);
    }
    case 'pick': {
      try {
        const number_of_choices = Number.parseInt(args, 10);
        if (
          !Number.isSafeInteger(number_of_choices) ||
          number_of_choices <= 0
        ) {
          throw new Error('Invalid number of choices');
        }
        return await pick_restaurant_pick(channel_id, number_of_choices);
      } catch (err) {
        console.error(err);
        const fallback_text = `Invalid number of choices. Usage is \`pick <N>\` where <N> is a positive integer.`;
        const response = await send_slack_request(
          'POST',
          '/chat.postEphemeral',
          {
            channel: channel_id,
            text: fallback_text,
            blocks: [
              {
                type: 'section',
                text: {
                  type: 'mrkdwn',
                  text: fallback_text,
                },
              },
              pick_restaurant_get_help_block(),
            ],
            user: user_id,
          }
        );
        if (response.ok !== true || response.data.ok !== true) {
          console.error(
            `Failed sending error empheral (user: ${user_id}) message to conversation`
          );
          console.log(JsonKit.stringify(response.data));
          return status(500);
        }
        return status(200);
      }
    }
    default: {
      const fallback_text = `${action} is not a valid command. You can use \`help\` to check available commands.`;
      const response = await send_slack_request('POST', '/chat.postEphemeral', {
        channel: channel_id,
        text: fallback_text,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: fallback_text,
            },
          },
          pick_restaurant_get_help_block(),
        ],
        user: user_id,
      });
      if (response.ok !== true || response.data.ok !== true) {
        console.error(
          `Failed sending error empheral (user: ${user_id}) message to conversation`
        );
        console.log(JsonKit.stringify(response.data));
        return status(500);
      }
      return status(200);
    }
  }
}

async function handle_event(event, context) {
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
          context.waitUntil(
            (async () => {
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

                await send_slack_request('POST', '/workflows.stepCompleted', {
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
            })()
          );
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
  let callback_id = null;
  try {
    callback_id = payload.callback_id || payload.view.callback_id;
  } catch (ignored) {}

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
            return json(
              {
                response_action: 'errors',
                errors: {
                  [conversations_select_block_id]: 'Please select a channel!',
                },
              },
              { status: 200 }
            );
          }
          const number_of_choices = Number.parseInt(
            payload.view.state.values[number_input_block_id][
              number_input_action_id
            ].value,
            10
          );
          if (typeof number_of_choices !== 'number' || number_of_choices <= 0) {
            return json(
              {
                response_action: 'errors',
                errors: {
                  [number_input_block_id]: 'Please enter a positive integer!',
                },
              },
              { status: 200 }
            );
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
    case 'pick_restaurant-new': {
      switch (payload.type) {
        case 'view_submission': {
          const restaurant_name =
            payload.view.state.values['restaurant_name-block'][
              'restaurant_name-action'
            ].value;
          if (typeof restaurant_name !== 'string') {
            return json(
              {
                response_action: 'errors',
                errors: {
                  'restaurant_name-block': 'Name is invalid!',
                },
              },
              { status: 200 }
            );
          }
          const restaruant_weight = Number.parseInt(
            payload.view.state.values['restaurant_weight-block'][
              'restaurant_weight-action'
            ].value,
            10
          );
          if (typeof restaruant_weight !== 'number' || restaruant_weight < 0) {
            return json(
              {
                response_action: 'errors',
                errors: {
                  'restaurant_weight-block': 'Please enter a positive integer!',
                },
              },
              { status: 200 }
            );
          }

          const { conversation } = JsonKit.parse(payload.view.private_metadata);
          let bookmark = await pick_restaurant_get_url(conversation);
          if (bookmark == null) {
            await pick_restaurant_setup(conversation, true);
            bookmark = await pick_restaurant_get_url(conversation);
            if (bookmark == null) {
              console.error('Failed getting bookmark');
              console.log(JsonKit.stringify(payload));
              return status(500);
            }
          }

          const data = JsonKit.parse(bookmark.link.searchParams.get('data'));
          if (!pick_restaurant_validate_data(conversation, data)) {
            // TODO: call pick_restaurant_repair
            console.error('Invalid bookmark data');
            return status(500);
          }

          if (data.list.findIndex(r => r.name === restaurant_name) >= 0) {
            return json(
              {
                response_action: 'errors',
                errors: {
                  'restaurant_name-block': 'This restaurant has been added!',
                },
              },
              { status: 200 }
            );
          }

          data.list.push({
            id: uuid(),
            name: restaurant_name,
            weight: restaruant_weight,
            shown_count: 0,
            win_count: 0,
          });

          // update bookmark
          data.ts = Date.now();
          const data_str = JsonKit.stringify(data, {
            extended: false,
            minify: false,
            compress: true,
          });
          const response = await send_slack_request('POST', '/bookmarks.edit', {
            channel_id: conversation,
            bookmark_id: bookmark.id,
            link: `${APP_ENDPOINT}/?conversation=${conversation}&data=${data_str}`,
          });
          if (response.ok !== true || response.data.ok !== true) {
            console.error('Failed editing bookmark in conversation after new');
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
    }
    case 'pick_restaurant-pick_overwrite': {
      switch (payload.type) {
        case 'view_submission': {
          const {
            conversation,
            message_ts,
            user_id,
            restaurant_id,
          } = JsonKit.parse(payload.view.private_metadata);
          return await pick_restaurant_pick_vote(
            conversation,
            message_ts,
            user_id,
            restaurant_id
          );
        }
        default: {
          console.error('Received unknown interaction type');
          console.log(JsonKit.stringify(payload));
          break;
        }
      }
    }
    case 'pick_restaurant-pick_end': {
      switch (payload.type) {
        case 'view_submission': {
          const { conversation, message_ts, user_id } = JsonKit.parse(
            payload.view.private_metadata
          );

          const pick_message = await pick_restaurant_get_pick_message(
            conversation,
            message_ts
          );
          if (pick_message == null) {
            console.error('Failed retriving action source pick message');
            return status(500);
          }

          const pick_metadata = pick_message.metadata;
          pick_metadata.event_payload.is_ended = true;
          pick_metadata.event_payload.ts = Date.now();

          const message_payload = pick_restaurant_get_pick_message_payload(
            conversation,
            pick_metadata.event_payload.choices,
            pick_metadata.event_payload.number_of_choices,
            true,
            user_id
          );
          let response = await send_slack_request('POST', '/chat.update', {
            ts: message_ts,
            ...message_payload,
          });
          if (response.ok !== true || response.data.ok !== true) {
            console.error(
              'Failed updating pick message to end vote in conversation'
            );
            console.log(JsonKit.stringify(response.data));
            return status(500);
          }

          const bookmark = await pick_restaurant_get_url(conversation);
          if (bookmark != null) {
            const data = JsonKit.parse(bookmark.link.searchParams.get('data'));
            for (const restaurant of data.list) {
              if (
                message_payload.metadata.event_payload.winners.includes(
                  restaurant.id
                )
              ) {
                restaurant.win_count++;
              }
            }

            // update bookmark
            data.ts = Date.now();
            const data_str = JsonKit.stringify(data, {
              extended: false,
              minify: false,
              compress: true,
            });
            response = await send_slack_request('POST', '/bookmarks.edit', {
              channel_id: conversation,
              bookmark_id: bookmark.id,
              link: `${APP_ENDPOINT}/?conversation=${conversation}&data=${data_str}`,
            });
            if (response.ok !== true || response.data.ok !== true) {
              console.error(
                'Failed editing bookmark in conversation after pick end'
              );
              console.log(JsonKit.stringify(response.data));
            }
          }

          const voted_users = [
            ...new Set(
              pick_metadata.event_payload.choices.flatMap(c =>
                c.votes.map(v => v.user_id)
              )
            ),
          ];
          for (const user of voted_users) {
            response = await send_slack_request('POST', '/chat.postEphemeral', {
              channel: conversation,
              text: `<@${user}> Vote has ended! You may check the result.`,
              user: user,
            });
            if (response.ok !== true || response.data.ok !== true) {
              console.error(
                `Failed sending vote end empheral (user: ${user}) message to conversation`
              );
              console.log(JsonKit.stringify(response.data));
            }
          }

          return status(200);
        }
        default: {
          console.error('Received unknown interaction type');
          console.log(JsonKit.stringify(payload));
          break;
        }
      }
    }
    default: {
      switch (payload.type) {
        case 'block_actions': {
          const conversation_id = payload.channel.id;
          const message_ts = payload.message.ts;
          const user_id = payload.user.id;
          const trigger_id = payload.trigger_id;

          if (
            !Array.isArray(payload.actions) ||
            typeof conversation_id !== 'string' ||
            typeof message_ts !== 'string' ||
            typeof user_id !== 'string'
          ) {
            return status(400);
          }

          for (const action of payload.actions) {
            switch (action.action_id) {
              case 'pick_restaurant_pick_vote-action': {
                const restaurant_id = action.value;
                return await pick_restaurant_pick_vote(
                  conversation_id,
                  message_ts,
                  user_id,
                  restaurant_id,
                  trigger_id
                );
              }
              case 'pick_restaurant_pick_add_choice-action': {
                const pick_message = await pick_restaurant_get_pick_message(
                  conversation_id,
                  message_ts
                );
                if (pick_message == null) {
                  console.error('Failed retriving action source pick message');
                  return status(500);
                }

                const pick_metadata = pick_message.metadata;
                const last_choice =
                  pick_metadata.event_payload.number_of_choices;
                if (last_choice >= pick_metadata.event_payload.choices.length) {
                  const response = await send_slack_request(
                    'POST',
                    '/chat.postEphemeral',
                    {
                      channel: conversation_id,
                      text: 'No more restaurants to pick!',
                      blocks: [
                        {
                          type: 'section',
                          text: {
                            type: 'mrkdwn',
                            text:
                              '*There are no more restaurants to pick.*\n\nPlease add new ones and start another pick!',
                          },
                        },
                      ],
                      user: user_id,
                    }
                  );
                  if (response.ok !== true || response.data.ok !== true) {
                    console.error(
                      `Failed sending error empheral (user: ${user_id}) message to conversation`
                    );
                    console.log(JsonKit.stringify(response.data));
                    return status(500);
                  }
                  return status(200);
                }

                pick_metadata.event_payload.choices[last_choice].shown_count++;
                pick_metadata.event_payload.number_of_choices = last_choice + 1;
                pick_metadata.event_payload.ts = Date.now();

                const message_payload = pick_restaurant_get_pick_message_payload(
                  conversation_id,
                  pick_metadata.event_payload.choices,
                  pick_metadata.event_payload.number_of_choices
                );
                let response = await send_slack_request(
                  'POST',
                  '/chat.update',
                  {
                    ts: message_ts,
                    ...message_payload,
                  }
                );
                if (response.ok !== true || response.data.ok !== true) {
                  console.error(
                    'Failed updating pick message to add choice in conversation'
                  );
                  console.log(JsonKit.stringify(response.data));
                  return status(500);
                }

                const bookmark = await pick_restaurant_get_url(conversation_id);
                if (bookmark != null) {
                  const data = JsonKit.parse(
                    bookmark.link.searchParams.get('data')
                  );
                  const restaurant = data.list.find(
                    restaurant =>
                      restaurant.id ===
                      pick_metadata.event_payload.choices[last_choice].id
                  );
                  if (restaurant != null) {
                    restaurant.shown_count++;
                  }

                  // update bookmark
                  data.ts = Date.now();
                  const data_str = JsonKit.stringify(data, {
                    extended: false,
                    minify: false,
                    compress: true,
                  });
                  response = await send_slack_request(
                    'POST',
                    '/bookmarks.edit',
                    {
                      channel_id: conversation_id,
                      bookmark_id: bookmark.id,
                      link: `${APP_ENDPOINT}/?conversation=${conversation_id}&data=${data_str}`,
                    }
                  );
                  if (response.ok !== true || response.data.ok !== true) {
                    console.error(
                      'Failed editing bookmark in conversation after pick'
                    );
                    console.log(JsonKit.stringify(response.data));
                  }
                }
                return status(200);
              }
              case 'pick_restaurant_pick_end-action': {
                const response = await send_slack_request(
                  'POST',
                  '/views.open',
                  {
                    trigger_id,
                    view: {
                      type: 'modal',
                      title: {
                        type: 'plain_text',
                        text: 'End Vote',
                        emoji: true,
                      },
                      close: {
                        type: 'plain_text',
                        text: 'No',
                        emoji: true,
                      },
                      submit: {
                        type: 'plain_text',
                        text: 'Yes',
                        emoji: true,
                      },
                      private_metadata: JsonKit.stringify({
                        conversation: conversation_id,
                        message_ts,
                        user_id,
                      }),
                      callback_id: 'pick_restaurant-pick_end',
                      blocks: [
                        {
                          type: 'section',
                          text: {
                            type: 'mrkdwn',
                            text:
                              'Are you sure you want to end the vote now?\n\n*This action is irreversible!*',
                          },
                        },
                      ],
                    },
                  }
                );
                if (response.ok !== true || response.data.ok !== true) {
                  console.error('Failed opening end vote confirmation modal');
                  console.log(JsonKit.stringify(response.data));
                  return status(500);
                }
                return status(200);
              }
              default: {
                console.error(
                  'Received unknown block action interaction payload'
                );
                console.log(JsonKit.stringify(payload));
                return status(400);
              }
            }
          }
          return status(200);
        }
        default: {
          console.error('Received unknown interaction payload');
          console.log(JsonKit.stringify(payload));
          break;
        }
      }
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
  return await handle_command(req.data);
});

router.post('/api/event', withData, async (req, event) => {
  if (req.data.challenge) {
    return text(req.data.challenge, { status: 200 });
  }
  return await handle_event(req.data.event, event);
});

router.post('/api/interact', withData, async req => {
  if (typeof req.data.payload !== 'string') {
    return text('payload must be a string', { status: 400 });
  }
  return await handle_interaction(JsonKit.parse(req.data.payload));
});

/* Web Page Functions */
router.get('/', async req => {
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
          return a.shown_count - b.shown_count;
        })
        .map(
          restaurant => `
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

addEventListener('fetch', e => {
  e.respondWith(router.handle(e.request, e));
});
