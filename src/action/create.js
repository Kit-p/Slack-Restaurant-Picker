import { status } from 'itty-router-extras';
import { JsonKit } from '@kit-p/json-kit';

import { send_slack_request } from '../util/request';

export async function create_action(conversation, trigger_id) {
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
    return status(500);
  }
  return status(200);
}
