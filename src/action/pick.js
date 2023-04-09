import { status } from 'itty-router-extras';
import { JsonKit } from '@kit-p/json-kit';

import { initialize_conversation } from './init';

import { send_slack_request } from '../util/request';
import {
  retrieve_bookmark,
  update_bookmark,
  validate_data,
} from '../util/store';

export function get_pick_payload(
  conversation,
  choices,
  number_of_choices,
  is_ended = false,
  ended_by = null
) {
  const choices_to_show = choices.slice(0, number_of_choices);
  const fallback_text = `Pick a restaurant from one of [${choices_to_show
    .map((c) => `"${c.name}"`)
    .join(', ')}]`;

  let total_votes = 0;
  let max_vote = 0;
  for (const choice of choices_to_show) {
    total_votes += choice.votes.length;
    max_vote = Math.max(max_vote, choice.votes.length);
  }
  let winners = choices_to_show.filter(
    (choice) => choice.votes.length === max_vote
  );
  winners = winners.map((winner) => winner.id);

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
      ...choices_to_show.flatMap((choice) => {
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

export async function retrieve_pick_message(conversation, message_ts) {
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

export async function pick_action(conversation, number_of_choices) {
  const bookmark = await retrieve_bookmark(conversation);
  if (bookmark == null) {
    await initialize_conversation(conversation);
    return status(200);
  }

  const data = JsonKit.parse(bookmark.link.searchParams.get('data'));
  if (!validate_data(conversation, data)) {
    // TODO: call pick_restaurant_repair
    console.error('Invalid bookmark data');
    return status(200);
  }

  if (data.list.length <= 0) {
    await initialize_conversation(conversation);
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

  const message_payload = get_pick_payload(
    conversation,
    choices.map((c) => ({ ...c, votes: [] })),
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

  if (!(await update_bookmark(conversation, data))) {
    return status(500);
  }
  return status(200);
}

export async function pick_add_choice_action(
  conversation,
  message_ts,
  user_id
) {
  const pick_message = await retrieve_pick_message(conversation, message_ts);
  if (pick_message == null) {
    console.error('Failed retrieving action source pick message');
    return status(500);
  }

  const pick_metadata = pick_message.metadata;
  const last_choice = pick_metadata.event_payload.number_of_choices;
  if (last_choice >= pick_metadata.event_payload.choices.length) {
    const response = await send_slack_request('POST', '/chat.postEphemeral', {
      channel: conversation,
      text: 'No more restaurants to pick!',
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '*There are no more restaurants to pick.*\n\nPlease add new ones and start another pick!',
          },
        },
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

  pick_metadata.event_payload.choices[last_choice].shown_count++;
  pick_metadata.event_payload.number_of_choices = last_choice + 1;
  pick_metadata.event_payload.ts = Date.now();

  const message_payload = get_pick_payload(
    conversation,
    pick_metadata.event_payload.choices,
    pick_metadata.event_payload.number_of_choices
  );
  let response = await send_slack_request('POST', '/chat.update', {
    ts: message_ts,
    ...message_payload,
  });
  if (response.ok !== true || response.data.ok !== true) {
    console.error('Failed updating pick message to add choice in conversation');
    console.log(JsonKit.stringify(response.data));
    return status(500);
  }

  const bookmark = await retrieve_bookmark(conversation);
  if (bookmark != null) {
    const data = JsonKit.parse(bookmark.link.searchParams.get('data'));
    const restaurant = data.list.find(
      (restaurant) =>
        restaurant.id === pick_metadata.event_payload.choices[last_choice].id
    );
    if (restaurant != null) {
      restaurant.shown_count++;
    }

    await update_bookmark(conversation, data);
  }

  const voted_users = [
    ...new Set(
      pick_metadata.event_payload.choices.flatMap((c) =>
        c.votes.map((v) => v.user_id)
      )
    ),
  ];
  for (const user of voted_users) {
    response = await send_slack_request('POST', '/chat.postEphemeral', {
      channel: conversation,
      text: `<@${user}> A new choice has been added! You may consider changing your vote.`,
      user: user,
    });
    if (response.ok !== true || response.data.ok !== true) {
      console.error(
        `Failed sending new choice notification empheral (user: ${user}) message to conversation`
      );
      console.log(JsonKit.stringify(response.data));
    }
  }

  return status(200);
}

export async function pick_end_action(
  conversation,
  message_ts,
  user_id,
  trigger_id
) {
  const response = await send_slack_request('POST', '/views.open', {
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
        conversation: conversation,
        message_ts,
        user_id,
      }),
      callback_id: 'pick_restaurant-pick_end',
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: 'Are you sure you want to end the vote now?\n\n*This action is irreversible!*',
          },
        },
      ],
    },
  });
  if (response.ok !== true || response.data.ok !== true) {
    console.error('Failed opening end vote confirmation modal');
    console.log(JsonKit.stringify(response.data));
    return status(500);
  }
  return status(200);
}

export async function pick_end_action_submit(payload) {
  const { conversation, message_ts, user_id } = JsonKit.parse(
    payload.view.private_metadata
  );

  const pick_message = await retrieve_pick_message(conversation, message_ts);
  if (pick_message == null) {
    console.error('Failed retrieving action source pick message');
    return status(500);
  }

  const pick_metadata = pick_message.metadata;
  pick_metadata.event_payload.is_ended = true;
  pick_metadata.event_payload.ts = Date.now();

  const message_payload = get_pick_payload(
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
    console.error('Failed updating pick message to end vote in conversation');
    console.log(JsonKit.stringify(response.data));
    return status(500);
  }

  const bookmark = await retrieve_bookmark(conversation);
  if (bookmark != null) {
    const data = JsonKit.parse(bookmark.link.searchParams.get('data'));
    for (const restaurant of data.list) {
      if (
        message_payload.metadata.event_payload.winners.includes(restaurant.id)
      ) {
        restaurant.win_count++;
      }
    }

    await update_bookmark(conversation, data);
  }

  const voted_users = [
    ...new Set(
      pick_metadata.event_payload.choices.flatMap((c) =>
        c.votes.map((v) => v.user_id)
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
