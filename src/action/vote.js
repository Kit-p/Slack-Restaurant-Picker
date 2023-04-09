import { status } from 'itty-router-extras';
import { JsonKit } from '@kit-p/json-kit';

import { get_pick_payload, retrieve_pick_message } from './pick';

import { send_slack_request } from '../util/request';

export async function vote_action(
  conversation,
  message_ts,
  user_id,
  restaurant_id,
  trigger_id
) {
  const pick_message = await retrieve_pick_message(conversation, message_ts);
  if (pick_message == null) {
    console.error('Failed retrieving action source pick message');
    return status(500);
  }

  const is_overwrite = trigger_id == null;
  const pick_metadata = pick_message.metadata;
  if (
    !is_overwrite &&
    pick_metadata.event_payload.choices.some((c) =>
      c.votes.some((v) => v.user_id === user_id)
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
              text: '*You have already voted!*\n\nDo you want to *overwrite* your previous vote?',
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
