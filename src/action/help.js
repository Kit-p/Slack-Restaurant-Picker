import { status } from 'itty-router-extras';
import { JsonKit } from '@kit-p/json-kit';

import { send_slack_request } from '../util/request';

export function get_help_text() {
  return 'Available _*Slash Commands*_:\n*`/restaurant_picker list`*: :ledger: Lists all the added restaurants in a modal\n*`/restaurant_picker new`*: :memo: Opens a modal for adding new restaurants\n*`/restaurant_picker pick <N>`*: :game_die: Picks *N* items _(if exists)_ and let everyone vote _(anonymously)_\n*`/restaurant_picker help`*: :information_source: Shows this message _(just for you :smirk:)_';
}

export function get_help_block() {
  return {
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: get_help_text(),
    },
  };
}

export async function help_action(conversation, user_id) {
  const welcome_text = 'Thanks for using the *Restaurant Picker*!.';
  const fallback_text = `${welcome_text}\n\n${get_help_text()}`;
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
        get_help_block(),
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
