import { status } from 'itty-router-extras';
import { JsonKit } from '@kit-p/json-kit';

import { create_action } from './create';
import { get_help_block, help_action } from './help';
import { list_action } from './list';
import { pick_action } from './pick';

import { send_slack_request } from '../util/request';

export async function action_handler(command) {
  const { text, trigger_id, channel_id, user_id } = command;
  const [action, args] = text.split(' ', 2);

  switch (action) {
    case 'help': {
      return await help_action(channel_id, user_id);
    }
    case 'list': {
      return await list_action(channel_id, trigger_id);
    }
    case 'new': {
      return await create_action(channel_id, trigger_id);
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
        return await pick_action(channel_id, number_of_choices);
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
              get_help_block(),
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
          get_help_block(),
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
